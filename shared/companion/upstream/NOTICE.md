# NOTICE

本插件的**代码**整体可按 MIT 使用，但随包的资源带有各自的来源与限制，分发前请逐项确认。

## 游戏素材

- `assets/spine/ac_s_closur_spine.{json,atlas,png}` —— 《明日方舟》可露希尔自走棋皮肤（Spine 3.8），版权归上海鹰角网络所有
- `assets/audio/*.ogg` —— 由游戏内 `autochess_b_ui_*` 音效转码而来，版权归上海鹰角网络所有
- `assets/audio/voice/{zh,ja,en,ko}/*.ogg` —— 可露希尔的干员语音及卫戍协议终端语音，版权归游戏权利人所有。[Arknights Terra Wiki 配音记录](https://arknights.wiki.gg/wiki/Closure/Dialogue)

「可露希尔的 Codex」已取得这些素材随本项目公开发行的单独授权。上游对素材的默认使用范围为个人本机自用。其他项目若要公开分发这些素材，应另行取得权利人许可，或由使用者从自己的游戏安装中提取后在本机使用。

## Spine 运行时

- `assets/vendor/spine-webgl.js` 和 `assets/vendor/spine-canvas.js` 使用 Esoteric Software Spine Runtimes 3.8，随附该版本的许可全文。[Spine Runtimes License](assets/vendor/Spine-Runtimes-LICENSE.txt)

## 字体

- `assets/fonts/fusion-pixel-12px-zh_hans.woff2` 来自 [Fusion Pixel Font 2026.11.10](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.11.10) 的 12px 简体中文比例版。作者 TakWolf，SIL Open Font License 1.1。许可证见 `assets/fonts/OFL.txt` 和 `assets/fonts/LICENSES/`。

## 设置与数据文件

Windows 桌宠将联动与自启设置保存在 `%LOCALAPPDATA%\ClosureCompanionTauri\profile.json`。外观和位置保存在同目录的 `webview\` 中。
