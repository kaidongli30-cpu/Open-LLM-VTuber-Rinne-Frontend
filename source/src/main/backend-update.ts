import { app, dialog, type BrowserWindow } from "electron";
import { execFile, spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OFFICIAL_REMOTES = new Set([
  "https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne",
  "git@github.com:kaidongli30-cpu/Open-LLM-VTuber-Rinne",
  "ssh://git@github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne",
]);

function locationFile(): string {
  return join(app.getPath("userData"), "rinne-backend-location.json");
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  return stdout.trim();
}

async function validateBackendFolder(folder: string): Promise<string> {
  const selected = resolve(folder);
  const root = resolve(await git(selected, "rev-parse", "--show-toplevel"));
  if (root.toLowerCase() !== selected.toLowerCase()) {
    throw new Error(
      "请选择含 conf.yaml 的凛祢后端项目文件夹，不要选择其中的子文件夹。",
    );
  }
  const origin = (await git(selected, "remote", "get-url", "origin"))
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (!OFFICIAL_REMOTES.has(origin)) {
    throw new Error("所选文件夹不是从凛祢官方仓库克隆的后端项目。");
  }
  if ((await git(selected, "symbolic-ref", "--short", "HEAD")) !== "main") {
    throw new Error("所选后端不在 main 分支，自动更新没有修改它。");
  }
  await readFile(join(selected, "conf.yaml"));
  return selected;
}

async function savedFolder(): Promise<string | null> {
  try {
    const saved = JSON.parse(await readFile(locationFile(), "utf8")) as {
      path?: unknown;
    };
    if (typeof saved.path !== "string") return null;
    return await validateBackendFolder(saved.path);
  } catch {
    return null;
  }
}

async function chooseBackendFolder(
  window: BrowserWindow,
  chooseAgain = false,
): Promise<string | null> {
  const saved = chooseAgain ? null : await savedFolder();
  if (saved) return saved;
  const selected = await dialog.showOpenDialog(window, {
    title: "选择凛祢后端项目文件夹",
    buttonLabel: "使用这个文件夹",
    properties: ["openDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return null;
  const folder = await validateBackendFolder(selected.filePaths[0]);
  const target = locationFile();
  const temporary = `${target}.writing`;
  await writeFile(temporary, JSON.stringify({ path: folder }), "utf8");
  await rename(temporary, target);
  return folder;
}

async function releasedUpdater(version: string): Promise<string> {
  const tag = `rinne-app-v${version}`;
  const url =
    `https://raw.githubusercontent.com/kaidongli30-cpu/` +
    `Open-LLM-VTuber-Rinne/${tag}/tools/rinne_safe_update.py`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok)
    throw new Error("无法取得配套的正式后端更新程序，请稍后重试。");
  const script = await response.text();
  if (script.length > 200_000 || !script.includes("def run_update(")) {
    throw new Error("正式后端更新程序内容异常，更新已停止。");
  }
  return script;
}

async function runUpdater(
  folder: string,
  script: string,
  version: string,
): Promise<string> {
  return await new Promise<string>((resolveResult, reject) => {
    const child = spawn(
      "uv",
      [
        "run",
        "--no-sync",
        "python",
        "-",
        "--apply",
        "--release",
        `rinne-app-v${version}`,
      ],
      {
        cwd: folder,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-4096);
    });
    child.stderr.resume();
    child.on("error", () =>
      reject(new Error("无法启动 uv。请确认已按 README 安装 uv。")),
    );
    child.on("close", (code) => {
      if (code === 0) resolveResult(stdout.trim());
      else
        reject(
          new Error(stdout.trim() || "后端更新未完成，请检查网络和项目文件。"),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}

async function syncDependencies(folder: string): Promise<void> {
  await new Promise<void>((resolveResult, reject) => {
    const child = spawn("uv", ["sync"], {
      cwd: folder,
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    });
    child.on("error", () =>
      reject(new Error("后端代码已更新，但无法启动 uv 安装依赖。")),
    );
    child.on("close", (code) => {
      if (code === 0) resolveResult();
      else
        reject(
          new Error(
            "后端代码已更新，但依赖安装未完成。请在后端项目目录运行 uv sync，然后重试。",
          ),
        );
    });
  });
}

export async function updateBackend(
  window: BrowserWindow,
  version: string,
): Promise<boolean> {
  try {
    let folder = await chooseBackendFolder(window);
    if (!folder) return false;
    for (;;) {
      const confirmation = await dialog.showMessageBox(window, {
        type: "info",
        title: "更新凛祢后端",
        message: "先关闭正在运行的凛祢后端，再开始更新",
        detail:
          `当前后端文件夹：${folder}\n` +
          "更新会保留聊天记录、日记和个人配置。下载可能需要一些时间。",
        buttons: ["取消", "开始更新", "更换文件夹"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response === 0) return false;
      if (confirmation.response === 1) break;
      folder = await chooseBackendFolder(window, true);
      if (!folder) return false;
    }
    const script = await releasedUpdater(version);
    window.setProgressBar(2);
    try {
      await runUpdater(folder, script, version);
      await syncDependencies(folder);
    } finally {
      window.setProgressBar(-1);
    }
    return true;
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "后端更新未完成",
      message: error instanceof Error ? error.message : "后端更新未完成。",
      detail: "新版客户端尚未安装。请处理问题后重试更新。",
      buttons: ["知道了"],
    });
    return false;
  }
}
