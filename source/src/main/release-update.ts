import { app, dialog, shell, type BrowserWindow } from "electron";

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
      const window = getWindow();
      if (!window || window.isDestroyed() || stopped) return;
      notifiedTag = release.tag_name;
      const { response: choice } = await dialog.showMessageBox(window, {
        type: "info",
        title: "凛祢有新版本",
        message: `凛祢桌面客户端 ${version} 已发布`,
        detail:
          "可以下载新版安装包，安装时选择原来的安装位置。更新后，你的对话记录与后端配置不会因此被删除。",
        buttons: ["稍后", "查看安装包"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (choice === 1) {
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
