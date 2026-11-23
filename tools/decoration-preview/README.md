# 深色装饰开发预览

双击 `Preview.cmd`，使用项目 `work/companion-runtime/electron` 中的运行时显示独立样例页面。它不读取 Codex 账号，也不发送聊天。样式和挂载器引用 `outputs/closure-decoration` 的当前实现，预览文件不随正式安装包分发。

后台检查：以 Electron 运行项目根目录的 `tests/decoration-preview.cjs`，窗口保持隐藏，验证尺寸、输入、开关及撤销；结果写入 `work/decoration-preview`。
