# 可露希尔桌宠 · DSH 联动桥

安装到 DSH 桌面配置后，在独立桌宠的右键菜单中勾选「DSH 联动」。无需开启 DSH 主题，也不会在 DSH 窗口内生成第二只桌宠。

插件订阅 DSH 原生任务、工具、提问事件，通过本机状态文件传给桌宠；对话和语音共用 Codex 的联动队列。官方余额调用 DSH 自己的 `deepseekAccount.getBalance`，分别显示充值钱包与赠送钱包；第三方模型余额暂不查询。

状态目录：`%LOCALAPPDATA%\ClosureCompanion\bridges`。只有桌宠开启联动并保持心跳时才查询余额，每分钟刷新，轮次结束后补刷。关闭联动或退出桌宠后停止查询。文件只包含归一化的事件计数、任务状态、Token 用量和余额，不包含对话正文或登录凭据。

适配版本：DSH 0.2.2-rc.5。使用 DSH 的插件管理界面安装本目录打包生成的 `.tgz`，或执行 `dsh plugin --profile desktop add <包路径>`。如当前 DSH 尚未加载新插件，退出并重新打开 DSH。

开发：在项目根目录执行 `node plugins/dsh-closure-companion-bridge/tools/build.mjs`，再执行 `npm pack ./plugins/dsh-closure-companion-bridge`。
