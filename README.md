# 可露希尔的 Codex

让《明日方舟》的可露希尔陪你使用 **Codex、DSH 和 WorkBuddy**：可互动的桌宠、57 条游戏原声，以及紫蓝网格、洋红细线与 CRT 扫描线组成的深色主题。

**桌宠和主题可以分别使用。** 桌宠既可独立陪伴，也可跟随三款软件的任务播放动作和台词。当前版本 **v0.7.0**，适用于 Windows 64 位（x64）。

[下载发行包](https://github.com/OndoP3901/Closure-Codex/releases) · [更新日志](CHANGELOG.md) · [详细使用指南](docs/USAGE.md) · [三软件联动说明](docs/COMPANION-INTEGRATIONS.md)

## 下载与安装

1. 在发布页下载 **`Closure-Codex-v0.7.0-win-x64.zip`**。
2. 完整解压到准备长期保留的文件夹，不要在压缩包内直接运行。
3. 双击 **`Install.cmd`**，启动桌宠。首次安装默认开启开机自启、关闭三款软件的联动。

总安装包包含运行时、三款软件的主题和 DSH 联动插件，无需另装 Node.js。主题可直接从对应入口启用，无需先安装桌宠；DSH 插件需要在 DSH 中安装。

## 启用主题

| 软件 | 启用 | 恢复原外观 |
| --- | --- | --- |
| Codex | `Enable-Codex-Theme.vbs` | `Restore-Codex-Appearance.vbs` |
| DSH | 安装 `plugins/dsh-theme` 内的 `.tgz` 主题插件并启用 | 在 DSH 插件管理中停用主题插件 |
| WorkBuddy | `Enable-WorkBuddy-Theme.vbs` | `Restore-WorkBuddy-Appearance.vbs` |

**Codex：** 需要 Microsoft Store 版。首次先正常打开 Codex，再运行启用入口；普通窗口会重启一次，保留账号、聊天记录和配置。以后使用自动创建的「Codex - 可露希尔深色主题」快捷方式，即使 Codex 已完全退出也能启动。

**DSH：** 主题是原生插件，不依赖上游主题。覆盖顶栏、窗口按钮区、完整工作区与会话侧栏、设置页和插件页；停用后恢复原有外观。安装方法见 [DSH 主题说明](docs/DSH-THEME.md)。

**WorkBuddy：** 首次保存工作并从托盘退出，再运行启用入口；以后也使用此入口启动。主题通过启动连接加载，不修改安装包。独立设置窗口使用纯深色顶部，不显示装饰条；恢复时保留当前窗口和草稿。详见 [WorkBuddy 主题说明](docs/WORKBUDDY-THEME.md)。

## 使用桌宠

**左键点击**角色可互动，**按住拖动**移动位置，**中键点击**查看已连接工具的账户余额，**右键点击**打开设置。余额不自动弹出。

| 常用设置 | 作用 |
| --- | --- |
| Codex 联动 | 跟随本机 Codex 任务，并查询账户余额或额度。 |
| DSH 联动 | 安装 `plugins/dsh-companion` 内的 `.tgz` 联动插件后，读取任务和官方钱包。 |
| WorkBuddy 联动 | 使用主题或联动入口启动，读取任务和软件内账号积分。 |
| 在桌面和其他软件中显示 | 默认开启；关闭后只在已勾选联动软件的主窗口前台显示。 |
| 开机自启 | 控制随 Windows 登录启动，独立于联动与显示范围。 |
| 大小、透明度、镜像、帧率 | 调整角色外观与流畅度，帧率范围 30–60 FPS。 |
| 对话字号、气泡大小、配音和语音队列 | 使用默认台词或个人队列，分别调整显示与声音。 |

三款软件的联动开关可以同时启用，共用原 Codex 联动语音队列。提示、动画和台词以所有已连接工具中最近有真实活动的对话为准，同一工具内的多个对话也独立比较。任务开始、输出、工具执行、提问、回答和结束都算活动；余额刷新与心跳不改变优先来源。切换不补播旧提示，语音轮换进度保留。

中键查看时会分别标明每款已连接工具：DSH 显示官方充值钱包与赠送钱包，WorkBuddy 显示软件账号剩余积分，Codex 沿用已有账户查询。未连接项不显示。DSH、WorkBuddy 的第三方模型和中转站余额查询暂未实现。

设置会自动保存到 `work/companion-profile`。退出后运行 `outputs/Start-Closure.cmd` 重新打开。更多说明见[使用指南](docs/USAGE.md)。

## 升级、卸载与排错

升级时复制旧版 `work/companion-profile` 到新版相同位置，再运行 `Install.cmd`；联动开关、个人队列、位置和显示范围会保留。旧自动余额提醒会迁移为中键手动查看。卸载前恢复各软件主题，再运行 `Uninstall.cmd`。如果没有余额显示，确认对应联动已勾选并使用支持联动的入口启动软件。

## 来源与许可

本项目为非官方移植。感谢 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin) 和 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) 提供主题方案、模型、动作与音效。

游戏素材权利归各自权利人。[主题许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材与第三方声明](outputs/closure-companion/upstream/NOTICE.md) · [字体许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)

源码构建与后台验证方法见[开发说明](docs/USAGE.md#从源码构建与验证)。当前适配 Windows x64 的 Codex、DSH 0.2.2-rc.5 与 WorkBuddy 5.11.3。
