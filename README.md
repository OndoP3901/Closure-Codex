# 可露希尔的 Codex

让可露希尔待在 Windows 桌面上。你可以拖动她、点击互动，也可以让她在 Codex、WorkBuddy 或 DSH 开始和完成任务时做动作、说台词。三个应用各有独立的可露希尔深色主题，桌宠和主题可以分别使用。

[快速上手](#快速上手) · [连接你的工具](#连接你的工具) · [安装深色主题](#安装深色主题) · [开发指南](#开发指南) · [更新日志](CHANGELOG.md)

## 快速上手

桌宠支持 Windows 10 和 11 的 64 位系统，需要 Microsoft Edge WebView2 Runtime。Windows 11 通常已自带，缺少时可从微软安装。[WebView2 下载](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)

1. 下载并完整解压 Windows x64 完整 ZIP，包内带有桌宠和三套主题。当前工作区的发行文件在 `tauri/dist/`。[GitHub Releases](https://github.com/OndoP3901/Closure-Codex/releases)
2. 双击 `closure-companion-tauri.exe`，桌宠就会出现在桌面上。
3. **左键点击**触发互动，**按住左键拖动**可以换位置，**右键**打开设置或退出。连接应用后，**按一下鼠标滚轮**查看支持的额度或余额。

右键菜单可以调整角色大小、透明度、气泡、配音语言和音量。取消「在桌面和其他软件中显示」，可让桌宠只跟随前台的联动应用。开机自启默认关闭。开启前请把程序放到长期使用的目录，因为 Windows 会记住它的完整路径。

## 连接你的工具

### Codex

打开 Microsoft Store 版 Codex，然后在桌宠的右键菜单勾选「Codex 联动」。

### WorkBuddy

先保存工作并从系统托盘退出普通启动的 WorkBuddy。通过下文的 [WorkBuddy 主题入口](#workbuddy-主题) 打开应用，再勾选「WorkBuddy 联动」。

### DSH

从桌宠 ZIP 的 `plugins/dsh-companion/` 取出 `dsh-closure-companion-bridge-0.1.2.tgz`。打开 DSH 自带的终端，从系统托盘退出 DSH，然后执行下面的命令。将引号内的路径换成你解压后的实际路径。

```powershell
dsh plugin --profile desktop add "C:\解压目录\plugins\dsh-companion\dsh-closure-companion-bridge-0.1.2.tgz"
```

重新打开 DSH，勾选「DSH 联动」。桌宠可以跟随任务，按下鼠标滚轮可查看 DSH 钱包的充值和赠送余额。关闭联动开关可暂停读取，在 DSH 插件管理中移除 `dsh-closure-companion-bridge` 可卸载插件。

## 安装深色主题

### Codex 主题

安装 Node.js 22 或更新版本，先正常打开 Microsoft Store 版 Codex 并保存工作，再双击启用脚本。首次启用可能重启 Codex 一次，之后可以用桌面或开始菜单里的主题快捷方式启动。要恢复原外观，保存工作后双击恢复脚本。[启用主题](themes/codex/Enable-Codex-Theme.vbs) · [恢复原外观](themes/codex/Restore-Codex-Appearance.vbs)

### WorkBuddy 主题

已适配 Windows x64 的 WorkBuddy 5.11.3。安装 Node.js 22 或更新版本，保存工作并从托盘退出 WorkBuddy，再双击启用脚本。恢复脚本会在当前窗口撤销主题。下次可以用原来的 WorkBuddy 图标启动。[启用主题](themes/workbuddy/Enable-Theme.vbs) · [恢复原外观](themes/workbuddy/Restore-Theme.vbs)

### DSH 主题

已适配 DSH `0.2.2-rc.5`。主题包在完整 ZIP 的 `themes/dsh/` 目录。先在 DSH 中停用其他全局主题，打开 DSH 自带的终端并从托盘退出 DSH，再运行以下命令。将路径换成你本机主题包的位置。

```powershell
dsh plugin --profile desktop add "C:\解压目录\themes\dsh\dsh-closure-codex-theme-0.1.2.tgz"
```

重新打开 DSH 即可看到主题。在插件管理中停用或移除 `dsh-closure-codex-theme` 可恢复原外观。网页版安装时将 `--profile desktop` 换成 `--profile web`。

## 开发指南

### 目录结构

| 目录 | 职责 |
| --- | --- |
| [tauri/src/](tauri/src/) | Rust 宿主、Windows 窗口与鼠标穿透、设置与自启、音频、应用联动以及测试。 |
| [tauri/frontend/](tauri/frontend/) | WebView2 页面入口、Tauri 命令桥接和界面冒烟测试。 |
| [shared/companion/](shared/companion/) | 桌宠前端、Spine 模型与动画、Fusion Pixel 字体、语音和 WorkBuddy 状态观察脚本。 |
| [shared/plugins/](shared/plugins/) | DSH 桌宠联动桥，负责向桌宠提供任务和账户状态。 |
| [themes/](themes/) | `codex/`、`workbuddy/` 和 `dsh/` 分别维护各自的主题。主题测试位于 `themes/tests/`。 |
| `tauri/dist/` | 本地完整发行 ZIP、桌宠 EXE 和 SHA-256 校验文件。 |
| `production/`、`archive/` | 本地宣传片工程与历史验证资料。 |

### 技术结构

- **Rust 宿主**使用 Tauri 2、WebView2 和 Windows API 管理透明窗、鼠标穿透和进程。Rust 使用 Rodio 与 Lewton 播放配音。联动和自启设置写入 `%LOCALAPPDATA%\ClosureCompanionTauri\profile.json`，外观与位置使用同目录下的 WebView2 配置。[宿主入口](tauri/src/main.rs) · [设置读写](tauri/src/settings.rs)
- **桌宠前端**使用 HTML、CSS 和原生 JavaScript。Spine 动画优先用 WebGL，初始化不可用时切换到 Canvas 2D。Cargo 构建时，`build.rs` 把页面和素材组装进 `tauri/.generated/frontend/`，由 Tauri 嵌入 EXE。[构建脚本](tauri/build.rs) · [渲染入口](shared/companion/upstream/assets/src/main.js)
- **应用联动**由 Rust 汇总后通过 Tauri 命令传给前端。Codex 适配器读取本地会话事件并查询账户额度，WorkBuddy 适配器使用宿主的本机连接和账户接口，DSH 插件通过 `%LOCALAPPDATA%\ClosureCompanion\bridges` 交换任务状态、用量与余额。[联动状态](tauri/src/linked.rs) · [DSH 插件入口](shared/plugins/dsh-closure-companion-bridge/lib/index.js)
- **主题**由各宿主加载。Codex 和 WorkBuddy 使用 PowerShell 与 Node.js 启动器，通过本机 Chrome DevTools Protocol 加载样式。DSH 通过自身的插件机制加载主题，主题和桌宠联动桥各有一个包。[Codex 配色和样式](themes/codex/) · [WorkBuddy 主题源码](themes/workbuddy/src/) · [DSH 主题源码](themes/dsh/src/)

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
