# 可露希尔的 Codex

让可露希尔待在 Windows 桌面上。你可以拖动她、点击互动，也可以让她在 Codex、WorkBuddy、DSH 或 Antigravity 开始和完成任务时做动作、说台词。桌宠菜单可以启动这四款应用并开启可露希尔深色主题。

[快速上手](#快速上手) · [连接你的工具](#连接你的工具) · [安装深色主题](#安装深色主题) · [开发指南](#开发指南) · [更新日志](CHANGELOG.md)

## 快速上手

桌宠支持 Windows 10 和 11 的 64 位系统，需要 Microsoft Edge WebView2 Runtime。Windows 11 通常已自带，缺少时可从微软安装。[WebView2 下载](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)

1. 下载 v0.11.0 的 Windows x64 便携版。单独使用桌宠可下载 EXE。需要 DSH 主题、联动桥或 Antigravity Hooks 安装脚本时，请下载完整 ZIP，解压到常用目录。[桌宠 EXE](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.11.0/closure-companion-tauri.exe) · [完整 ZIP](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.11.0/Closure-Codex-v0.11.0-win-x64.zip) · [SHA-256 校验值](https://github.com/OndoP3901/Closure-Codex/releases/download/v0.11.0/SHA256SUMS-v0.11.0.txt)
2. 双击 `closure-companion-tauri.exe`，桌宠就会出现在桌面上。
3. **左键点击**触发互动，**按住左键拖动**可以换位置，**右键**打开设置或退出。**按一下鼠标滚轮**可查看已连接账户的额度或余额，以及当前对话已上报的本轮和累计 Token 用量。

从旧版升级时，先在桌宠右键菜单选择「退出桌宠」，再用新 EXE 替换原文件。沿用原路径可以继续使用已有的开机自启和 Antigravity Hooks 配置。

右键菜单可以调整角色大小、透明度、气泡、配音语言和音量。取消「在桌面和其他软件中显示」，可让桌宠只跟随前台的联动应用。开机自启默认关闭。开启前请把程序放到长期使用的目录，因为 Windows 会记住它的完整路径。

找不到角色时，在 Windows 系统托盘右键点击桌宠图标，选择「显示桌宠」，角色会出现在鼠标所在的屏幕。再次双击 EXE 也能唤回桌宠。托盘的另一项「退出」会关闭程序。要开关工具报错时的反馈，可在桌宠右键菜单中选择「提醒与播报 → 工具失败提示」。

### 首次配置

使用桌宠的动画、语音和菜单只需满足上面的 WebView2 要求。使用主题或联动前，请先安装相应的桌面客户端，并在需要时登录。

- **Node.js 22 或更新版本**。使用 Codex 主题，或从桌宠菜单启动 WorkBuddy、Antigravity 时，需要单独安装 Node.js。在新开的终端运行 `node --version` 确认版本，再启动桌宠。[Node.js 官方下载](https://nodejs.org/zh-cn/download)
- **DSH**。使用主题前安装主题插件 0.1.4，使用任务联动和余额显示前安装桌宠联动桥。安装或更新插件后，从系统托盘退出 DSH，再从桌宠菜单启动。[主题插件安装](#dsh-主题) · [联动桥安装](#dsh)
- **Antigravity**。首次启用任务联动时，先把桌宠 EXE 放在长期使用的目录，再运行一次 Hooks 安装脚本。[Hooks 安装步骤](#antigravity)

## 连接你的工具

右键打开桌宠菜单，在各应用连接状态右侧点击「启动」。顶部的「启用主题」默认开启，会记住选择，并在从菜单启动应用时生效。关闭后仍可使用联动。DSH 主题插件 0.1.4 起支持在从菜单启动时更新已打开的 DSH 窗口。

WorkBuddy 和 DSH 安装在自定义目录时，桌宠会从 Windows 安装记录和运行中的客户端查找程序。如果「启动」时弹出文件选择框，选中安装目录里的 `WorkBuddy.exe` 或 `DeepSeek Harness.exe`，以后启动会沿用这个位置。

### Codex

安装 Microsoft Store 版 Codex 后，从桌宠菜单启动。首次加载主题会先识别原有配置，并可能重启一次 Codex。启动前请保存工作。

桌宠会记住首次识别的配置。如果提示普通 Codex 仍在运行，请完整退出 Codex，再从桌宠点击「启动」。菜单会显示失败步骤，完整报错保存在 `%LOCALAPPDATA%\ClosureCodexTheme\last-error.txt`。

启用 Codex 联动后，按下鼠标滚轮可查看官方账号提供的额度和积分。使用 HeJu 中转站时，气泡会单独显示 HeJu 余额。若认证失败、查询超时或受到限流，气泡会提示对应原因。

### WorkBuddy

普通 WorkBuddy 已打开时，请先保存工作并从系统托盘退出，再从桌宠菜单启动 WorkBuddy 并开启联动。登录 WorkBuddy 官方账号后，按下鼠标滚轮可查看剩余积分，包括零积分和不限量状态。退出账号后，气泡会显示「未登录官方账号」。积分接口已按正式版 5.11.3 核对，并在灰度版 5.12.1 实机验证。

### DSH

从桌宠 ZIP 的 `plugins/dsh-companion/` 取出 `dsh-closure-companion-bridge-0.1.2.tgz`。打开 DSH 自带的终端，从系统托盘退出 DSH，然后执行下面的命令。将引号内的路径换成你解压后的实际路径。

```powershell
dsh plugin --profile desktop add "C:\解压目录\plugins\dsh-companion\dsh-closure-companion-bridge-0.1.2.tgz"
```

从桌宠菜单点击 DSH 旁的「启动」。桌宠可以跟随任务，按下鼠标滚轮可查看 DSH 钱包的充值和赠送余额。关闭联动开关可暂停读取，在 DSH 插件管理中移除 `dsh-closure-companion-bridge` 可卸载插件。

### Antigravity

适用于 Windows 上独立的 Google Antigravity App。将桌宠 EXE 放在长期使用的目录，再运行完整 ZIP 中的 Hooks 安装脚本。下面的命令从 ZIP 解压后的根目录执行，把 EXE 路径换成实际位置。从源码配置时，脚本在 `shared/plugins/antigravity-companion-bridge/`。

```powershell
& '.\plugins\antigravity-companion-bridge\Install-Hooks.ps1' -CompanionExe 'C:\桌宠\closure-companion-tauri.exe'
```

重新打开 Antigravity，在桌宠右键菜单勾选「Antigravity 联动」，再在 Antigravity 中运行一次任务。桌宠收到任务事件或连上额度来源后，菜单会显示「已连接」。当前提供任务开始、完成、失败和中断状态。关闭联动开关可暂停接收，使用同一脚本加 `-Remove` 可移除可露希尔的 Hooks。安装器会备份原有全局 Hooks 文件。 [Google Hooks 文档](https://antigravity.google/docs/hooks)

通过桌宠菜单启动 Antigravity 后，在桌宠上按下鼠标滚轮，可查看当前模型所属额度池提供的剩余额度。已适配 2.36.0 的模型选择器，包括带独立思考档位的模型。气泡按额度池实际提供的周期显示，例如 5 小时或 7 天。

## 安装深色主题

### Codex 主题

在桌宠菜单点击 Codex 右侧的「启动」。开启或关闭主题时，可能需要重新启动 Codex，请先保存工作。

### WorkBuddy 主题

支持 Windows x64 的 WorkBuddy 5.11.3（正式版）和 5.12.1（灰度版）。在桌宠菜单点击 WorkBuddy 右侧的「启动」。[官方版本记录](https://www.codebuddy.cn/docs/workbuddy/Download-History)

### DSH 主题

已适配 DSH `0.2.2-rc.5`。在完整 ZIP 的 `themes/dsh/` 中获取 0.1.4 主题包。从源码构建时可在仓库的「启动」目录生成安装包。先在 DSH 中停用其他全局主题，然后执行下面的命令。将路径换成你本机主题包的位置。[从源码生成主题包](启动/DSH%20主题安装.md)

```powershell
dsh plugin --profile desktop add "C:\解压目录\themes\dsh\dsh-closure-codex-theme-0.1.4.tgz"
```

安装后，从系统托盘退出 DSH，再从桌宠菜单启动。在插件管理中停用或移除 `dsh-closure-codex-theme` 可恢复原外观。网页版安装时将 `--profile desktop` 换成 `--profile web`。

### Antigravity 主题

普通 Antigravity 已打开时，先保存工作并退出，再在桌宠菜单点击 Antigravity 右侧的「启动」。退出 Antigravity 时本机调试端口随之关闭。

主题沿用 Codex、WorkBuddy 和 DSH 的深色配色、紫蓝网格顶栏、洋红强调色和 Cascadia Mono 字体栈。

## 开发指南

源码仓库的桌宠启动入口会选取最近一次本地 Release 构建。若尚未构建，可将发行版 EXE 放在 `tauri/dist/` 后使用同一入口。[启动桌宠.vbs](启动/启动桌宠.vbs) · [生成并安装 DSH 主题](启动/DSH%20主题安装.md) · [下一步开发建议](下一步开发建议.md)

### 目录结构

| 目录 | 职责 |
| --- | --- |
| [启动/](启动/) | 桌宠启动入口和 DSH 主题安装说明。 |
| [tauri/src/](tauri/src/) | Rust 宿主、Windows 窗口与鼠标穿透、设置与自启、音频、应用联动以及测试。 |
| [tauri/frontend/](tauri/frontend/) | WebView2 页面入口、Tauri 命令桥接和界面冒烟测试。 |
| [shared/companion/](shared/companion/) | 桌宠前端、Spine 模型与动画、Fusion Pixel 字体、语音和 WorkBuddy 状态观察脚本。 |
| [shared/plugins/](shared/plugins/) | DSH 桌宠联动桥和 Antigravity 任务 Hooks 安装器。 |
| [themes/](themes/) | Codex、WorkBuddy、DSH 和 Antigravity 的独立主题。主题测试位于 `themes/tests/`。 |
| `tauri/dist/` | 本地完整发行 ZIP、桌宠 EXE 和 SHA-256 校验文件。 |
| `production/`、`archive/` | 本地宣传片工程与历史验证资料。 |

### 技术结构

- **Rust 宿主**使用 Tauri 2、WebView2 和 Windows API 管理透明窗、鼠标穿透和进程。Rust 使用 Rodio 与 Lewton 播放配音。联动和自启设置写入 `%LOCALAPPDATA%\ClosureCompanionTauri\profile.json`，外观与位置使用同目录下的 WebView2 配置。[宿主入口](tauri/src/main.rs) · [设置读写](tauri/src/settings.rs)
- **桌宠前端**使用 HTML、CSS 和原生 JavaScript。Spine 动画优先用 WebGL，初始化不可用时切换到 Canvas 2D。Cargo 构建时，`build.rs` 把页面和素材组装进 `tauri/.generated/frontend/`，由 Tauri 嵌入 EXE。[构建脚本](tauri/build.rs) · [渲染入口](shared/companion/upstream/assets/src/main.js)
- **应用联动**由 Rust 汇总后通过 Tauri 命令传给前端。Codex 读取会话事件并查询额度，WorkBuddy 使用宿主的本机连接，DSH 插件写入任务和账户状态，Antigravity 官方 Hooks 写入任务事件。后两者的桥接文件在 `%LOCALAPPDATA%\ClosureCompanion\bridges`。[联动状态](tauri/src/linked.rs) · [Antigravity 适配器](tauri/src/antigravity.rs)
- **主题**由各宿主加载。桌宠 EXE 内置 Codex、WorkBuddy 和 Antigravity 的主题文件，通过 Node.js 启动器和本机 Chrome DevTools Protocol 加载样式。DSH 通过自身的插件机制加载主题。[Codex 配色和样式](themes/codex/) · [WorkBuddy 主题源码](themes/workbuddy/src/) · [DSH 主题源码](themes/dsh/src/) · [Antigravity 主题源码](themes/antigravity/)

### 构建与测试桌宠

在 Windows 上准备 Rust MSVC 工具链、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。在仓库根目录执行以下命令。两次冒烟测试使用临时配置，验证动画、鼠标穿透、菜单和设置保存。

```powershell
Set-Location tauri
cargo build --locked
cargo test --locked
.\target\debug\closure-companion-tauri.exe --smoke
.\target\debug\closure-companion-tauri.exe --smoke --canvas
cargo build --locked --release
```

默认的 Release EXE 位于 `tauri/target/release/`。设置了 `CARGO_TARGET_DIR` 时，产物会写入指定目录。

### 构建主题与插件

在仓库根目录使用 Node.js 22+ 生成主题资源并运行测试。Codex 主题启动器直接加载目录内的样式与配色。

```powershell
node themes/workbuddy/tools/build.mjs
node themes/dsh/tools/build.mjs
node --test themes/tests/*.test.cjs
```

需要生成 DSH 安装包时，在 `themes/dsh/` 或 `shared/plugins/dsh-closure-companion-bridge/` 中运行 `npm pack`。各自的 `prepack` 脚本会生成打包所需的文件。

主题启动日志分别位于 `%LOCALAPPDATA%\ClosureCodexTheme` 和 `%LOCALAPPDATA%\ClosureWorkBuddyTheme\launcher.log`。

### 授权

角色、声音、字体和主题分别按随附文件授权。[桌宠素材声明](shared/companion/upstream/NOTICE.md) · [桌宠代码许可](shared/companion/upstream/LICENSE) · [字体许可](shared/companion/upstream/assets/fonts/OFL.txt) · [Codex 主题](themes/codex/palette/LICENSE) · [WorkBuddy 主题](themes/workbuddy/LICENSE) · [DSH 主题](themes/dsh/LICENSE) · [DSH 联动桥](shared/plugins/dsh-closure-companion-bridge/LICENSE)
