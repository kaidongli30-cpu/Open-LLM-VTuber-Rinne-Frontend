# Open-LLM-VTuber-Rinne 桌面客户端

这是凛祢的桌面客户端仓库。正常使用不需要自己编译，下载安装程序即可。

## 安装和启动

1. 先按[主项目安装指南](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne/blob/main/README.md)配置语音服务和后端。
2. 打开 [Windows 客户端下载页](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne-Frontend/releases/tag/rinne-desktop-v2.1.0-20260926)。
3. 下载 `open-llm-vtuber-2.1.0-setup.exe`，双击安装。可以选择安装到其他磁盘。
4. 先启动 Ollama、语音服务和后端，再双击桌面客户端快捷方式。

客户端只是操作界面。要收到凛祢的回复，后端和语音服务也需要运行。

## 从旧版更新

请按[旧版升级说明](https://github.com/kaidongli30-cpu/Open-LLM-VTuber-Rinne/blob/main/README.md#upgrade)操作，同时更新后端和客户端。

1.2.1 用户需要先手动安装新版客户端，再用新版客户端更新原有后端。不要删除旧项目和聊天记录。

2.1.0 客户端支持在更新时逐项选择“保留我的”或“采用新版”。如果旧客户端提示存在需要选择的改动，请先手动安装新版，再继续更新后端。

## 想修改客户端代码

- `source`：桌面客户端源码，开发方法见 [source/README.md](source/README.md)。
- 根目录的 `index.html` 等文件：供后端使用的前端构建文件。

本项目基于 [Open-LLM-VTuber-Web](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web)。许可证见 [LICENSE](LICENSE)。
