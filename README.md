# 可露希尔的 Codex

让《明日方舟》的可露希尔陪你使用 Codex：可互动的桌宠、57 条游戏原声，以及紫蓝与洋红配色的深色主题。

**桌宠和主题可以分别使用。** 桌宠可独立陪伴，也可跟随 Codex 的任务播放动作和语音。

[下载 v0.6.1](https://github.com/OndoP3901/Closure-Codex/releases/tag/v0.6.1) · [更新日志](CHANGELOG.md) · [详细使用指南](docs/USAGE.md)

## 下载与安装

适用于 **Windows 64 位（x64）**。使用主题或 Codex 联动时，需要安装 Microsoft Store 版 Codex。

1. 在发布页下载 **`Closure-Codex-v0.6.1-win-x64.zip`**。
2. 完整解压到准备长期保留的文件夹。不要在压缩包里直接运行，也不要只复制其中的启动文件。
3. 双击 **`Install.cmd`**，桌宠就会出现。

安装包已包含运行所需组件，无需另装 Node.js。首次安装默认开启桌宠的开机自启；右键桌宠可以关闭。

**只想用主题？** 解压后直接按下面的步骤操作即可，无需安装桌宠。

## 启用 Codex 深色主题

**第一次使用：**

1. 正常打开 Codex，等待主界面出现，并保存正在编辑的内容。
2. 双击解压文件夹里的 **`Enable-Codex-Theme.vbs`**。
3. Codex 会重启一次并加载主题，账号和聊天记录会保留，无需手动导入配色。

**以后使用：** 双击桌面或开始菜单中的 **「Codex - 可露希尔深色主题」** 快捷方式。即使 Codex 已完全退出，也可以直接启动。

| 想做什么 | 打开什么 |
| --- | --- |
| 启用主题，或重新创建主题快捷方式 | `Enable-Codex-Theme.vbs` |
| 关闭主题，恢复原外观和普通启动 | `Restore-Codex-Appearance.vbs` |

关闭主题会移除主题快捷方式，但保留已识别的 Codex 配置。**再次启用时直接打开 `Enable-Codex-Theme.vbs`，无需提前启动 Codex。** 只有配置目录丢失或失效时，才需要先正常打开 Codex，再启用主题。

这两个入口成功时不会弹出提示，失败时会显示错误和日志位置。恢复外观时如 Codex 正在使用主题，会重启该窗口；操作前请保存工作。

## 使用桌宠

**左键点击**角色可互动，**按住拖动**可移动位置，**右键点击**可打开设置。设置会自动保存。

| 常用设置 | 作用 |
| --- | --- |
| Codex 联动 | 开启任务动作、场景语音和额度提醒；首次安装默认关闭。 |
| 在桌面和其他软件中显示 | 默认开启；关闭后，只有 Codex 主窗口在前台时才显示桌宠。 |
| 开机自启 | 控制是否随 Windows 登录启动，与上面两个选项分别设置。 |
| 大小、透明度、镜像 | 调整角色的显示效果。 |
| 对话字号、气泡大小 | 分别调整文字和气泡。 |
| 配音、音量、语音队列 | 选择语言、调节声音，或自定义各场景的台词。 |
| 退出桌宠 | 位于右键菜单底部，退出后不会自动重新出现。 |

退出后想重新打开，双击 **`outputs/Start-Closure.cmd`**。更多设置见[详细使用指南](docs/USAGE.md)。

## 升级与卸载

**升级到新版：**

1. 右键退出旧桌宠，将新版完整解压到新文件夹。
2. 将旧文件夹中的 **`work/companion-profile`** 复制到新版的相同位置，以保留个人设置。
3. 双击新版 **`Install.cmd`**。使用主题的用户，再打开新版 **`Enable-Codex-Theme.vbs`**，更新主题快捷方式。

**卸载：** 先运行 **`Restore-Codex-Appearance.vbs`** 关闭主题，再运行 **`Uninstall.cmd`** 停止桌宠并移除开机自启。两项操作都会保留个人配置；确认不再需要后，可自行删除解压文件夹。

## 常见问题

- **找不到桌宠？** 如果关闭了「在桌面和其他软件中显示」，请先切回 Codex 主窗口。主动退出过桌宠时，运行 `outputs/Start-Closure.cmd` 重新打开。
- **主题没有生效？** 请使用「可露希尔深色主题」快捷方式；从原版 Codex 快捷方式启动后，可再运行 `Enable-Codex-Theme.vbs` 加载主题。
- **Restore 后还是原来的深色配色？** 恢复的是启用前的外观；之前手动导入的配色会保留，账号和聊天记录也不会删除。
- **启动时报错？** 保留弹窗中的错误和日志，查看[排错说明](docs/USAGE.md#排错)。Codex 更新后，主题可能需要适配。

## 来源与许可

本项目为非官方移植。感谢 [dsh-closure-skin](https://github.com/fengshiyangrouguan/dsh-closure-skin) 和 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) 提供主题方案、模型、动作与音效。

游戏素材的权利归各自权利人，使用及分发请遵守随附声明。[主题许可](outputs/closure-theme/LICENSE) · [桌宠代码许可](outputs/closure-companion/upstream/LICENSE) · [素材与第三方声明](outputs/closure-companion/upstream/NOTICE.md) · [字体许可](outputs/closure-companion/upstream/assets/fonts/OFL.txt)

源码构建与验证方法见[开发说明](docs/USAGE.md#从源码构建与验证)。
