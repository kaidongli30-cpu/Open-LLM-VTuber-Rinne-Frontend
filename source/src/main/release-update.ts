import { app, dialog, shell, type BrowserWindow } from "electron";
import {
  ensureBackendForInstalledClient,
  updateBackend,
} from "./backend-update";

const RELEASE_API =
  "https://api.github.com/repos/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/latest";
const BACKEND_RELEASES_API =
  "https://api.github.com/repos/kaidongli30-cpu/Open-LLM-VTuber-Rinne/releases?per_page=30";
const RELEASE_PAGE =
  "https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/tag/";
const RELEASE_TAG = /^rinne-desktop-v(\d+)\.(\d+)\.(\d+)(?:-|$)/;

type Release = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: Array<{ name?: unknown }>;
};

function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate: string, installed: string): boolean {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

export function startReleaseChecks(
  getWindow: () => BrowserWindow | null,
): () => void {
  if (!app.isPackaged || process.platform !== "win32") return () => {};

  let notifiedTag: string | null = null;
  let checking = false;
  let stopped = false;

  const check = async (): Promise<void> => {
    if (stopped || checking) return;
    checking = true;
    try {
      const window = getWindow();
      if (!window || window.isDestroyed()) return;
      if (!(await ensureBackendForInstalledClient(window, app.getVersion())))
        return;
      const response = await fetch(RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Rinne-Desktop",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const release = (await response.json()) as Release;
      if (
        release.draft ||
        release.prerelease ||
        typeof release.tag_name !== "string"
      )
        return;
      const match = RELEASE_TAG.exec(release.tag_name);
      if (!match) return;
      const version = `${match[1]}.${match[2]}.${match[3]}`;
      if (
        !isNewer(version, app.getVersion()) ||
        release.tag_name === notifiedTag
      )
        return;
      const installerName = `open-llm-vtuber-${version}-setup.exe`;
      if (!release.assets?.some((asset) => asset.name === installerName))
        return;
      const backendResponse = await fetch(BACKEND_RELEASES_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Rinne-Desktop",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!backendResponse.ok) return;
      const backendReleases = (await backendResponse.json()) as Release[];
      if (
        !Array.isArray(backendReleases) ||
        !backendReleases.some(
          (candidate) =>
            candidate.tag_name === `rinne-app-v${version}` &&
            !candidate.draft &&
            !candidate.prerelease,
        )
      )
        return;
      if (window.isDestroyed() || stopped) return;
      notifiedTag = release.tag_name;
      const { response: choice } = await dialog.showMessageBox(window, {
        type: "info",
        title: "凛祢有新版本",
        message: `凛祢桌面客户端 ${version} 已发布`,
        detail:
          "点击更新后先更新后端，再打开新版客户端安装包页面。安装时可以选择原来的安装位置。",
        buttons: ["稍后", "更新"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (choice === 1) {
        if (!(await updateBackend(window, version))) return;
        await dialog.showMessageBox(window, {
          type: "info",
          title: "后端已更新",
          message: "接下来下载并安装新版凛祢客户端",
          detail:
            "浏览器将打开正式版本页面。下载安装包后，关闭旧客户端并运行安装包；然后按原来的方式启动后端和客户端。",
          buttons: ["打开下载页面"],
        });
        await shell.openExternal(
          `${RELEASE_PAGE}${encodeURIComponent(release.tag_name)}`,
        );
      }
    } catch (error) {
      console.warn(
        "Rinne release check unavailable:",
        error instanceof Error ? error.name : "unknown",
      );
    } finally {
      checking = false;
    }
  };

  const firstCheck = setTimeout(() => void check(), 10_000);
  const interval = setInterval(() => void check(), 12 * 60 * 60 * 1000);
  return () => {
    stopped = true;
    clearTimeout(firstCheck);
    clearInterval(interval);
  };
}
