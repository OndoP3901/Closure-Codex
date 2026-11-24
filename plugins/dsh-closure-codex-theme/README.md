# 可露希尔 · Codex 深色主题（DSH 插件）

独立复刻「可露希尔的 Codex」当前深色外观。无需安装 Codex，也不依赖 `dsh-closure-skin`、桌宠或外部主题注入器。

- 深蓝黑底色 `#0a0b16`、冷白文字 `#eef0ff`、洋红强调 `#ff3ea5`。
- 紫蓝渐变菜单、8 px 细网格和 1 px 洋红分隔线。
- Windows 顶栏与整个左侧栏共用连续网格，覆盖导航、工作区、会话列表及底部账户菜单。
- 左上角不再被横线切断；右上角原生窗口按钮区透出同一套网格。
- 工作区紫色环境光、3 px 周期扫描线及暗角，强度与当前 Codex 主题一致。
- Cascadia Mono 界面及代码字体，中文回退到等线和微软雅黑。
- 对话、输入框、菜单、设置、工具反馈、文件差异和滚动条统一配色。

保留 DSH 原有布局、图标、圆角、字号、窗口拖动及缩放行为。DSH 与 Codex 的导航布局不同，本插件把相同视觉语言映射到 DSH 原有区域，不把聊天列表改成 Codex 的结构。

## 安装

需要支持 `ctx.theme.register` 和当前客户端模块协议的 DSH。首版针对 Windows x64、DSH `0.2.2-rc.5` 开发。

先打开 **DSH 自带终端**，然后从托盘完全退出 DSH，再运行下面的命令。文件路径替换为实际下载位置：

```powershell
dsh plugin --profile desktop add "C:\Downloads\dsh-closure-codex-theme-0.1.2.tgz"
```

安装后重新打开 DSH；主题会作为 profile 插件加载。可在插件管理中启用或停用 **dsh-closure-codex-theme**。

Web profile 改用：

```powershell
dsh plugin --profile web add "C:\Downloads\dsh-closure-codex-theme-0.1.2.tgz"
```

启用前请停用其他会改变全局外观的主题插件，尤其是原版 `dsh-closure-skin`，避免叠加样式。无需卸载桌宠。

本包本身也是可独立托管的 DSH 插件源码目录；插件管理器使用 Git 仓库地址安装时，仓库根目录必须是本包目录。

## 停用与卸载

在 DSH 插件管理中停用本插件，即撤销配色、字体及装饰，恢复启用前的主题选择。插件运行期间使用固定深色外观；DSH 原生浅色、深色和跟随系统的选择会在停用时恢复。

彻底卸载可运行：

```powershell
dsh plugin --profile desktop remove dsh-closure-codex-theme
```

只使用 DSH 的主题服务、插件生命周期和页面样式，不修改 DSH 安装目录、账号、会话或模型配置，不读取聊天内容，也不加载网络素材。

## 字体与平台

字体使用系统已安装字体，不附带字体文件。未安装 Cascadia Mono 时自动回退，不影响使用。

Windows 原生标题栏高度由 DSH 决定（本次版本为 40 px，Codex 为 36 px）；最小化、最大化、关闭按钮及系统弹出菜单仍由原生窗口绘制。插件通过 DSH 自带的颜色探针让窗口按钮底色透明，背景网格从页面透出，不替换按钮或改动安装包。Web 版没有桌面菜单栏，装饰应用于原有侧栏导航。macOS 与 Linux 尚未实机验证。

## 构建

源码在 `src/`，`lib/client.js` 是 DSH 模块工厂格式的生成文件。无需安装构建依赖：

```powershell
node tools/build.mjs
npm pack
```

安装使用包内已编译文件，无需用户自行构建。独立插件入口与构建脚本均在本包内，其他主题仓库的更新不会替换本实现。

代码和样式采用 MIT；原始配色的许可署名保留在 LICENSE。包中不包含游戏美术、声音和字体资源。
