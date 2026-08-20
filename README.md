# Open-LLM-VTuber-Rinne Frontend Build

这里存放 [Open-LLM-VTuber-Rinne](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne) 运行所需的网页端编译文件，不包含前端源代码。

本构建基于 [Open-LLM-VTuber-Web](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web)，并包含 Rinne 桌宠使用中验证过的交互修复：

- 麦克风启动、停止与初始化状态恢复；
- 麦克风、打断和发送按钮点击；
- 拖拽结束、取消和窗口失焦后的状态清理；
- Live2D 最终表情保持与无语音片段的表情应用。

桌面 Pet mode 的透明区域鼠标穿透修复位于 Electron 主进程中，因此请同时使用主仓库 GitHub Releases 提供的 Rinne 桌面客户端安装包。

构建来源：Rinne 前端修复提交 `bbd0ffee11a6f2ac8c8cff6a4b919c160480e4dd`。

许可证见 [LICENSE](LICENSE)。
