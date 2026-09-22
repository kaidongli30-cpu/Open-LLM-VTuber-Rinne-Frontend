import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      setIgnoreMouseEvents: (ignore: boolean) => void;
      toggleForceIgnoreMouse: () => void;
      onForceIgnoreMouseChanged: (
        callback: (isForced: boolean) => void,
      ) => void;
      onModeChanged: (callback: (mode: "pet" | "window") => void) => void;
      showContextMenu: (x: number, y: number) => void;
      onMicToggle: (callback: () => void) => void;
      onInterrupt: (callback: () => void) => void;
      updateComponentHover: (componentId: string, isHovering: boolean) => void;
      onToggleInputSubtitle: (callback: () => void) => void;
      onToggleScrollToResize: (callback: () => void) => void;
      onSwitchCharacter: (callback: (filename: string) => void) => void;
      setMode: (mode: "window" | "pet") => void;
      getConfigFiles: () => Promise<any>;
      updateConfigFiles: (files: any[]) => void;
      rinneLegacy: {
        getStatus: () => Promise<{
          available: boolean;
          reason: "ready" | "not_enabled" | "not_configured" | "invalid_bundle";
          defaultPortraitId?: number;
          outfitDisplayName?: string;
          runtimeKind?: "outfit" | "spirit";
          portraitCount?: number;
          canvasSize?: number;
          offlineAcceptance?: boolean;
          error?: string;
        }>;
        loadCatalog: () => Promise<{
          outfitManifestJson?: Uint8Array;
          firstOutfitManifestJson?: Uint8Array;
          spiritExpressionManifestJson?: Uint8Array;
        }>;
        loadPortrait: (
          portraitId: number,
        ) => Promise<Record<string, number | Uint8Array>>;
        loadOverlay: (overlayId: string) => Promise<Uint8Array>;
        loadCustomOutfit: () => Promise<unknown>;
        refresh: (emotion?: string) => Promise<{
          available: boolean;
          reason: "ready" | "not_enabled" | "not_configured" | "invalid_bundle";
          defaultPortraitId?: number;
          outfitDisplayName?: string;
          runtimeKind?: "outfit" | "spirit";
          portraitCount?: number;
          canvasSize?: number;
          offlineAcceptance?: boolean;
          error?: string;
        }>;
      };
    };
  }
}

interface IpcRenderer {
  on(
    channel: "mode-changed",
    func: (_event: any, mode: "pet" | "window") => void,
  ): void;
  send(channel: string, ...args: any[]): void;
}
