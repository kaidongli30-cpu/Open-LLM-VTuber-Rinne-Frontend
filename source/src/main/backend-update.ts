import { app, dialog, type BrowserWindow } from "electron";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
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

function pairedVersionFile(): string {
  return join(app.getPath("userData"), "rinne-paired-backend-version.json");
}

async function readPairedVersion(): Promise<string | null> {
  try {
    const saved = JSON.parse(await readFile(pairedVersionFile(), "utf8")) as {
      version?: unknown;
    };
    return typeof saved.version === "string" ? saved.version : null;
  } catch {
    return null;
  }
}

async function recordPairedVersion(version: string): Promise<void> {
  const target = pairedVersionFile();
  const temporary = `${target}.writing`;
  await writeFile(temporary, JSON.stringify({ version }), "utf8");
  await rename(temporary, target);
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
  extra: string[],
): Promise<string> {
  return await new Promise<string>((resolveResult, reject) => {
    const child = spawn(
      "uv",
      [
        "run",
        "--no-sync",
        "python",
        "-",
        "--release",
        `rinne-app-v${version}`,
        ...extra,
      ],
      {
        cwd: folder,
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let oversized = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (oversized) return;
      stdout += chunk;
      if (stdout.length > 4_000_000) {
        oversized = true;
        child.kill();
      }
    });
    child.stderr.resume();
    child.on("error", () =>
      reject(new Error("无法启动 uv。请确认已按 README 安装 uv。")),
    );
    child.on("close", (code) => {
      if (oversized) reject(new Error("更新检查结果过大，未继续更新。"));
      else if (code === 0) resolveResult(stdout.trim());
      else
        reject(
          new Error(stdout.trim() || "后端更新未完成，请检查网络和项目文件。"),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}

type UpdateConflict = {
  id: string;
  file: string;
  section: string;
  mine: string;
  new: string;
};

type UpdatePlan = {
  message: string;
  snapshot: string;
  target: string;
  conflicts: UpdateConflict[];
};

function parseUpdatePlan(raw: string): UpdatePlan {
  const plan = JSON.parse(raw) as UpdatePlan;
  if (
    !plan ||
    !Array.isArray(plan.conflicts) ||
    typeof plan.snapshot !== "string" ||
    typeof plan.target !== "string" ||
    !/^[a-f0-9]{64}$/.test(plan.snapshot) ||
    !/^[a-f0-9]{40}$/.test(plan.target) ||
    typeof plan.message !== "string" ||
    plan.conflicts.some(
      (item) =>
        !item ||
        !/^[a-f0-9]{64}$/.test(item.id) ||
        [item.file, item.section, item.mine, item.new].some(
          (value) => typeof value !== "string",
        ),
    )
  ) {
    throw new Error("更新检查结果无效，未继续修改文件。");
  }
  if (
    new Set(plan.conflicts.map((item) => item.id)).size !==
    plan.conflicts.length
  ) {
    throw new Error("更新选择编号重复，未继续修改文件。");
  }
  return plan;
}

async function reviewUpdate(
  window: BrowserWindow,
  plan: UpdatePlan,
): Promise<Record<string, "mine" | "new"> | null> {
  const choices: Record<string, "mine" | "new"> = {};
  for (const [index, item] of plan.conflicts.entries()) {
    if (window.isDestroyed()) return null;
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      title:
        "选择保留的内容（" + (index + 1) + "/" + plan.conflicts.length + "）",
      message: item.file + "\n" + item.section,
      detail:
        "你的内容：\n" +
        item.mine +
        "\n\n新版内容：\n" +
        item.new +
        "\n\n" +
        "仅选择这一处，其余可合并的改动仍会更新。保留旧代码可能与新版不兼容。" +
        "取消会放弃本次全部选择，此时尚未修改项目文件。",
      buttons: ["取消本次更新", "保留我的", "采用新版"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 0) return null;
    choices[item.id] = response === 1 ? "mine" : "new";
  }
  if (plan.conflicts.length) {
    const mine = Object.values(choices).filter(
      (value) => value === "mine",
    ).length;
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      title: "确认更新选择",
      message: "所有冲突已选择，是否备份并开始更新？",
      detail:
        "保留你的内容：" +
        mine +
        " 处；采用新版：" +
        (plan.conflicts.length - mine) +
        " 处。\n" +
        "密钥、语音目录和原有记忆会保留。更新文件会先备份；程序会再次检查文件是否变化。",
      buttons: ["取消本次更新", "备份并更新"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1) return null;
  }
  return choices;
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

async function runningBackendVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      "http://127.0.0.1:12393/api/rinne-app-version",
      {
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (!response.ok) return null;
    const info = (await response.json()) as {
      product?: unknown;
      version?: unknown;
    };
    return info.product === "Open-LLM-VTuber-Rinne" &&
      typeof info.version === "string"
      ? info.version
      : null;
  } catch {
    return null;
  }
}

async function folderAlreadyCurrent(
  folder: string,
  version: string,
): Promise<boolean> {
  const tag = `refs/tags/rinne-app-v${version}`;
  const remoteTag = await git(folder, "ls-remote", "origin", tag);
  const target = remoteTag.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(target)) {
    throw new Error("找不到与客户端配套的后端正式版本，请稍后重试。");
  }
  const head = await git(folder, "rev-parse", "HEAD");
  if (head !== target) return false;
  try {
    await access(join(folder, "conf.local.yaml"));
    return false;
  } catch {
    return true;
  }
}

export async function ensureBackendForInstalledClient(
  window: BrowserWindow,
  version: string,
): Promise<boolean> {
  const runningVersion = await runningBackendVersion();
  if (runningVersion === version) {
    await recordPairedVersion(version);
    return true;
  }
  if (runningVersion === null && (await readPairedVersion()) === version) {
    return true;
  }
  const introduction = await dialog.showMessageBox(window, {
    type: "info",
    title: "确认凛祢后端版本",
    message: "请确认这个客户端连接的是配套的凛祢后端",
    detail:
      "从旧版升级时，选择原来运行 run_server.py 的项目文件夹；" +
      "全新安装时，选择刚按 README 下载的项目文件夹。" +
      "已有的聊天和日记会留在原处。",
    buttons: ["稍后", "选择后端文件夹"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  if (introduction.response !== 1) return false;
  try {
    const folder = await chooseBackendFolder(window);
    if (!folder) return false;
    if (await folderAlreadyCurrent(folder, version)) {
      await recordPairedVersion(version);
      return true;
    }
    if (!(await updateBackend(window, version))) return false;
    await dialog.showMessageBox(window, {
      type: "info",
      title: "后端升级完成",
      message: "凛祢后端已升级到配套版本",
      detail: "请按原来的方式重新启动后端和桌面客户端。聊天与日记仍在原位置。",
      buttons: ["知道了"],
    });
    return true;
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "后端版本尚未确认",
      message: error instanceof Error ? error.message : "后端版本检查失败。",
      detail: "原有后端和资料没有被修改。请处理问题后重新打开客户端。",
      buttons: ["知道了"],
    });
    return false;
  }
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
      const plan = parseUpdatePlan(
        await runUpdater(folder, script, version, ["--plan-json"]),
      );
      window.setProgressBar(-1);
      const choices = await reviewUpdate(window, plan);
      if (choices === null || window.isDestroyed()) return false;
      const temporary = await mkdtemp(
        join(app.getPath("userData"), "rinne-update-choices-"),
      );
      try {
        const decisions = join(temporary, "choices.json");
        await writeFile(
          decisions,
          JSON.stringify({ snapshot: plan.snapshot, choices }),
          "utf8",
        );
        window.setProgressBar(2);
        await runUpdater(folder, script, version, [
          "--apply",
          "--choices-file",
          decisions,
        ]);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      await syncDependencies(folder);
      await recordPairedVersion(version);
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
