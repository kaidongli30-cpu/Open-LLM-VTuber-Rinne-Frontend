# 桌面客户端更新日志

## [2.1.2] - 2026-10-20

### 改进与修复

- 修正“关于”页面的版本号，使其与安装版本一致。
- 配套后端改进旧事回忆的日期判断、资料库文件查找与读取反馈，以及重复回复和对话打断处理。详见[完整更新日志](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne/blob/main/CHANGELOG.md#212---2026-10-20)。

### 安装与升级

- [下载 Windows 2.1.2 安装程序](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/download/rinne-desktop-v2.1.2-20261020/open-llm-vtuber-2.1.2-setup.exe)，完全退出旧客户端后安装，可以选择原来的安装位置。
- 1.2.2 及之后的客户端在联网检查成功后会提示新版本；点击“更新”，先完成后端更新，再下载安装程序。
- 1.2.1 客户端不会提示更新。请先手动安装新版，再选择原来的后端项目目录更新。
- 详细操作见[旧版升级指南](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne#upgrade)。更新前备份个人配置和聊天记录，不要删除原项目。

## [2.1.1] - 2026-09-30

### 改进与修复

- 检查更新时使用 Windows 系统代理，改善需要代理时无法取得版本信息的问题。
- 直接下载后端更新工具失败时，改用 Git 下载。
- 配套后端修复从 1.2.1 首次升级失败、大量误报选择框和更新后文件被误标为“已修改”的问题，并改善密钥与个人设置的保留。
- 配套后端还改进周记、月记、长期记忆和重复回复处理。详见[完整更新日志](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne/blob/main/CHANGELOG.md#211---2026-09-30)。

### 安装与升级

- 1.2.1 用户需要先手动安装 2.1.1 或之后的客户端，再选择原来的后端项目目录更新；不要用 2.1.0 客户端从 1.2.1 升级。
- 旧客户端提示需要逐项选择、或无法取得更新工具时，也请先手动安装新版客户端。
- 现在建议直接安装[最新 Windows 客户端](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/latest)，原来的聊天记录和日记保留在后端项目中。

[2.1.2]: https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/tag/rinne-desktop-v2.1.2-20261020
[2.1.1]: https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/tag/rinne-desktop-v2.1.1-20260929
