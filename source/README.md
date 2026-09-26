# 桌面客户端开发

这里只供需要修改客户端代码的人使用。

如果只是安装凛祢，请直接下载[桌面安装包](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/tag/rinne-desktop-v2.1.0-20260926)，不用执行下面的命令。

客户端使用 Electron、React 和 TypeScript。Electron 把界面打包成桌面程序，React 负责界面，TypeScript 用来编写代码。

## 1. 安装依赖

先准备 Node.js 和 npm，然后在本 `source` 文件夹打开命令窗口。以下命令都在这里执行。

检查工具：

```text
node --version
npm --version
```

安装依赖：

```text
npm install
```

## 2. 启动开发界面

```text
npm run dev
```

需要实际对话时，仍要按[后端安装指南](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne/blob/main/README.md)启动后端和语音服务。

## 3. 构建 Windows 安装包

```text
npm run build:win
```

构建产物保存在 `source\release\<版本号>`，相对于前端仓库根目录。当前版本的安装程序是 `open-llm-vtuber-2.1.0-setup.exe`。

## 其他构建命令

这些是源码中的构建入口，不代表对应平台已经完成凛祢功能验收。

| 目标 | 命令 |
| --- | --- |
| macOS | `npm run build:mac` |
| Linux | `npm run build:linux` |
| 供后端使用的网页文件 | `npm run build:web` |

日常用户仍使用桌面安装程序，不需要构建网页文件。
