# DSH 主题移植

DSH 插件源码位于仓库的 [`plugins/dsh-closure-codex-theme`](https://github.com/OndoP3901/Closure-Codex/tree/main/plugins/dsh-closure-codex-theme)，包名 `dsh-closure-codex-theme`，版本 `0.1.2`。总安装包中的安装文件位于 `plugins/dsh-theme`。它独立复刻本仓库当前 Codex 主题，不依赖原版 DSH 主题或桌宠。

## 外观对应

| Codex 外观 | DSH 实现 |
| --- | --- |
| `#0a0b16` / `#eef0ff` / `#ff3ea5` | 映射 132 个 DSH 颜色变量，含会话、菜单、设置、差异和状态 |
| 紫蓝网格顶栏 | 绘制到 DSH 现有 Windows 标题行，保留原生高度和拖动区域 |
| 左侧应用导航网格 | 全局导航、新建会话、工作区、会话列表和底部账户区共享连续网格 |
| 洋红细线 | 顶部菜单与导航区域边界；不增加占用布局的边框 |
| 工作区环境光 | 同样的两层紫色径向渐变，应用于实际对话背景 |
| CRT | 同样的 3 px 扫描线、透明度、暗角和 `pointer-events:none` |
| 字体 | 同样的 Cascadia Mono / 等线 / 微软雅黑回退；不改变字号 |

DSH 的功能导航位于侧栏上部，并没有 Codex 那条常驻的独立应用竖栏；插件保留其原有布局，没有复制 Codex 的页面结构或替换 DSH 图标。

## 实现与生命周期

Host 入口仅声明插件，实际实现使用 DSH 原生 `ctx.theme.register`、`theme.setTheme` 和 Cordis 生命周期。DSH 的主题初始化会异步采用持久化偏好，插件对此重申临时主题选择，并在停用时恢复最新原生偏好；不写入第三方主题 id，不改原生字号与字体配置。

DOM 绑定从 `[data-shell-overlay]`、`[data-sidebar-toggle]`、`[data-rightbar-col]` 和 `data-slot` 识别实际布局，跳过 `display:contents` 插槽包装层；不依赖打包后的 CSS 类名。使用 MutationObserver / ResizeObserver 同步重建和折叠；React 重写 class 后在微任务重新绑定。停用会移除样式、类、测量变量和观察器。

菜单背景统一绘制在框架上，避免独立背景在左上角产生接缝；顶部分隔线从侧栏右边缘开始。0.1.2 移除工作区和会话列表的深色遮罩，滚动淡出区同步透明，整列共享网格；侧栏文字及半透明悬停、选中底色保持清晰。背景宽度跟随侧栏列的实际尺寸，折叠过程中无需测量菜单和页脚位置。DSH Windows preload 有专门的隐藏颜色探针，插件只将该探针的背景改为透明，并通过原有样式变化通知让 preload 同步到原生标题栏；系统按钮因此透出页面背景，停用自动恢复。

## 构建与验证

```powershell
node plugins/dsh-closure-codex-theme/tools/build.mjs
node --test tests/dsh-theme.test.cjs
& ./tools/Build-Dsh-Theme.ps1
```

`npm pack` 生成可安装的 `.tgz`，包中包含完整源码和已构建客户端，无构建依赖或运行时依赖。发行目录另附使用说明、SHA-256 和可用的预览/验收报告。

集成测试需要独立解包的 DSH Node 运行时和随项目 Electron，通过 `CLOSURE_DSH_RUNTIME`、`CLOSURE_ELECTRON_EXE` 指定；本机默认使用 `work/dsh-theme/host` 和 `work/companion-runtime/electron`。不读取用户账号、会话或 profile。测试 runner 会建立独立 profile，加入待测插件及仅测试用探针：

```powershell
node tools/test-dsh-theme.cjs
```

Windows 布局验证在实际 DSH `0.2.2-rc.5`（commit `3f85d88`）Web Host 中加载正式插件，使用标题栏标记验证桌面布局；不是静态 HTML 样例。覆盖三个窗口尺寸、输入命中、侧栏折叠、设置页、插件页、逐帧主题连续性、刷新、原生 Cordis 停用/重启以及浅色外观恢复。

0.1.1 曾在本机已安装的 DSH 桌面窗口中检查左上角接缝和原生按钮区透明网格。0.1.2 使用隐藏、不可聚焦的离屏窗口在后台验证，新增工作区标题、实际工作区和会话行、列表空白处的像素检查，检查每层背景均能透出网格；同时检查转角连续性、窗口缩放、设置切换及停用后的完整恢复。测试先停用插件记录原生布局基线，DSH 在 600 px 宽侧栏展开时自身会产生一条 ResizeObserver 通知，报告保留并与基线核对，其他错误仍使测试失败。测试使用独立 profile，不操作用户当前窗口。macOS / Linux 尚未实测。
