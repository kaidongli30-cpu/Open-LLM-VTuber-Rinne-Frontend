/* eslint-disable no-shadow */
import {
  app,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  type BrowserWindow,
} from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { WindowManager } from "./window-manager";
import { MenuManager } from "./menu-manager";
import { registerRinneLegacyIpc } from "./rinne-legacy-loader";

let windowManager: WindowManager;
let menuManager: MenuManager;
let isQuitting = false;
let unregisterRinneLegacyIpc = () => {};
let unregisterManualAudioShortcut = () => {};

const MANUAL_AUDIO_ACCELERATOR = "F8";
const MANUAL_AUDIO_RETRY_INTERVAL_MS = 5_000;
const isolatedUserDataDir = process.env.RINNE_CLIENT_USER_DATA_DIR?.trim();
if (isolatedUserDataDir) {
  if (!isAbsolute(isolatedUserDataDir)) {
    throw new Error("RINNE_CLIENT_USER_DATA_DIR must be an absolute path");
  }
  const userDataDir = resolve(isolatedUserDataDir);
  mkdirSync(userDataDir, { recursive: true });
  app.setPath("userData", userDataDir);
}
const singleInstanceLockAcquired = app.requestSingleInstanceLock();

if (!singleInstanceLockAcquired) {
  app.quit();
}

function setupIPC(): void {
  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.setIgnoreMouseEvents(ignore);
    }
  });

  ipcMain.on("get-current-mode", (event) => {
    event.returnValue = windowManager.getCurrentMode();
  });

  ipcMain.on("pre-mode-changed", (_event, newMode) => {
    if (newMode === 'window' || newMode === 'pet') {
      menuManager.setMode(newMode);
    }
  });

  ipcMain.on("window-minimize", () => {
    windowManager.getWindow()?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.maximizeWindow();
    }
  });

  ipcMain.on("window-close", () => {
    const window = windowManager.getWindow();
    if (window) {
      if (process.platform === "darwin") {
        window.hide();
      } else {
        window.close();
      }
    }
  });

  ipcMain.on(
    "update-component-hover",
    (_event, componentId: string, isHovering: boolean) => {
      windowManager.updateComponentHover(componentId, isHovering);
    },
  );

  ipcMain.handle("get-config-files", () => {
    const configFiles = JSON.parse(localStorage.getItem("configFiles") || "[]");
    menuManager.updateConfigFiles(configFiles);
    return configFiles;
  });

  ipcMain.on("update-config-files", (_event, files) => {
    menuManager.updateConfigFiles(files);
  });

  ipcMain.handle("get-screen-capture", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    const source = sources[0];
    if (!source) {
      throw new Error("No desktop screen capture source is available");
    }

    const display = screen
      .getAllDisplays()
      .find((candidate) => String(candidate.id) === source.display_id);
    const fallbackDisplay = screen.getPrimaryDisplay();
    const selectedDisplay = display ?? fallbackDisplay;

    return {
      id: source.id,
      width: Math.round(selectedDisplay.size.width * selectedDisplay.scaleFactor),
      height: Math.round(
        selectedDisplay.size.height * selectedDisplay.scaleFactor,
      ),
    };
  });
}

function setupManualAudioShortcut(window: BrowserWindow): () => void {
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let registrationFailureWasReported = false;

  const sendManualAudioToggle = (): void => {
    const window = windowManager.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send("manual-audio-toggle");
  };

  const stopRetryTimer = (): void => {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
  };

  const ensureGlobalRegistration = (): boolean => {
    if (isQuitting) return false;

    if (globalShortcut.isRegistered(MANUAL_AUDIO_ACCELERATOR)) {
      stopRetryTimer();
      return true;
    }

    const registered = globalShortcut.register(
      MANUAL_AUDIO_ACCELERATOR,
      sendManualAudioToggle,
    );

    if (registered) {
      stopRetryTimer();
      if (registrationFailureWasReported) {
        console.info("Global F8 manual audio shortcut registered after retry");
      }
      return true;
    }

    if (!registrationFailureWasReported) {
      registrationFailureWasReported = true;
      console.warn(
        "Unable to register global F8 manual audio shortcut; retrying while Rinne is running",
      );
    }

    if (!retryTimer) {
      retryTimer = setInterval(
        ensureGlobalRegistration,
        MANUAL_AUDIO_RETRY_INTERVAL_MS,
      );
      retryTimer.unref();
    }

    return false;
  };

  const handleWindowFocus = (): void => {
    ensureGlobalRegistration();
  };

  const handleForegroundInput = (
    event: Electron.Event,
    input: Electron.Input,
  ): void => {
    const isUnmodifiedF8 =
      input.type === "keyDown" &&
      (input.key === MANUAL_AUDIO_ACCELERATOR ||
        input.code === MANUAL_AUDIO_ACCELERATOR) &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift;

    if (
      !isUnmodifiedF8 ||
      input.isAutoRepeat ||
      globalShortcut.isRegistered(MANUAL_AUDIO_ACCELERATOR)
    ) {
      return;
    }

    // This fallback is active only while the global shortcut is unavailable,
    // so one F8 press cannot arrive through both paths.
    event.preventDefault();
    sendManualAudioToggle();
  };

  app.on("activate", handleWindowFocus);
  window.on("focus", handleWindowFocus);
  window.webContents.on("before-input-event", handleForegroundInput);
  ensureGlobalRegistration();

  return () => {
    stopRetryTimer();
    app.off("activate", handleWindowFocus);
    window.off("focus", handleWindowFocus);
    if (!window.webContents.isDestroyed()) {
      window.webContents.off("before-input-event", handleForegroundInput);
    }
    globalShortcut.unregister(MANUAL_AUDIO_ACCELERATOR);
  };
}

function showExistingWindow(): void {
  const window = windowManager?.getWindow();
  if (!window || window.isDestroyed()) return;

  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function startPrimaryApplication(): void {
  electronApp.setAppUserModelId("com.electron");

  windowManager = new WindowManager();
  menuManager = new MenuManager((mode) => windowManager.setWindowMode(mode));

  const window = windowManager.createWindow({
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#FFFFFF",
      height: 30,
    },
  });
  menuManager.createTray();

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
    return false;
  });

  // if (process.env.NODE_ENV === "development") {
  //   globalShortcut.register("F12", () => {
  //     const window = windowManager.getWindow();
  //     if (!window) return;

  //     if (window.webContents.isDevToolsOpened()) {
  //       window.webContents.closeDevTools();
  //     } else {
  //       window.webContents.openDevTools();
  //     }
  //   });
  // }

  setupIPC();
  unregisterRinneLegacyIpc = registerRinneLegacyIpc(window.webContents);
  unregisterManualAudioShortcut = setupManualAudioShortcut(window);

  app.on("activate", showExistingWindow);

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('web-contents-created', (_, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    });
  });
}

if (singleInstanceLockAcquired) {
  app.on("second-instance", showExistingWindow);
  void app.whenReady().then(startPrimaryApplication);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    unregisterManualAudioShortcut();
    unregisterRinneLegacyIpc();
    menuManager.destroy();
    globalShortcut.unregisterAll();
  });
}
