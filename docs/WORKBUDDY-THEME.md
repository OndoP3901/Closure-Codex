# WorkBuddy 主题适配

源码在 [`plugins/workbuddy-closure-codex-theme`](../plugins/workbuddy-closure-codex-theme/README.md)，版本 `0.1.1`。延续 Codex 与 DSH 的配色、网格、分隔线、环境光及 CRT 效果，覆盖整个左侧任务和工作区。独立设置窗口顶部使用纯深色背景，不绘制网格装饰条。

## 桌面与 Web 的区别

本机 WorkBuddy 桌面版本是 `5.11.3`。其安装包包含 CBC Web 的外观 Mod 模板及 `theme.register` 示例，但桌面实际渲染器没有接入相同的 Mod 客户端加载入口。桌面内置皮肤加载器使用在线资源及独立的 SkinManager，未发现公开的本地主题导入接口。因此本版交付独立桌面主题包，附启用和恢复入口；不将 CBC Web manifest 当作已支持的桌面插件。

主题通过现有 `WORKBUDDY_REMOTE_DEBUGGING_PORT` 启动能力连接，保留原安装程序与配置。助手校验回环监听、WorkBuddy 可执行文件及精确的渲染器路径，仅在该应用页面插入自己的样式和控制器。独立设置窗口使用同一渲染器入口，可自动覆盖。网页、登录外链、文档预览和其他应用不在目标内。

首次启用建议先保存工作并从托盘退出 WorkBuddy；入口会重新启动应用。已经运行时只请求正常关闭，驻留或拒绝关闭会中止，不强制杀进程。当前开发测试始终在隐藏窗口进行，未重启用户正在使用的 WorkBuddy。

## 实现

`src/palette.mjs` 映射 316 个 `wb`、`cb`、聊天组件 `cr-internal` 和 VS Code 变量。`src/theme.css` 使用原生侧栏和菜单布局绘制背景；整个导航、任务列表、工作区及页脚透出同一套以视口为坐标的网格。扫描线使用指针透明的页面伪元素。

控制器临时固定深色类及 `data-theme-source`，原生 preload 因此可同步窗口按钮符号颜色；不写入持久化主题偏好。记录原生外观水合/切换后的状态，撤销时恢复自己接管的类、属性、内联变量及样式。ResizeObserver 只跟踪侧栏尺寸，更新在动画帧中执行。页面更新或独立窗口出现时，助手只为精确匹配的页面加载控制器。撤销通过助手的控制文件完成，移除预加载脚本及当前页面装饰，保留原有窗口与输入。

## 后台验证

需要本机安装 WorkBuddy，及项目已有 Electron 测试运行时。runner 只读解包应用的 renderer 到忽略跟踪的 `work/`，不提取用户数据库。使用测试专用宿主桥和合成任务/工作区记录启动真实 React 界面；网络请求全部阻断，窗口 `show:false`、`focusable:false`、`offscreen:true`。

```powershell
node plugins/workbuddy-closure-codex-theme/tools/build.mjs
node --test tests/workbuddy-theme.test.cjs
node tools/test-workbuddy-theme.cjs
& ./tools/Build-WorkBuddy-Theme.ps1
```

集成测试运行正式 CDP 助手，覆盖 1400×900、1000×720、800×650，顶栏右端及侧栏上下区域的像素检查、真实任务/分组行、输入命中、不改变几何、菜单弹出、侧栏折叠、独立设置窗口、未发送草稿保留、原外观恢复与深色重新接管。报告、截图在 `work/workbuddy-theme/verification/`。测试报告区分渲染错误和 WorkBuddy 自带的性能诊断日志。

验证边界是原安装包渲染器加隔离的合成宿主数据；实际账号、后台任务、完整桌面启动链和 macOS/Linux 不在本次已验收范围。

## 分发

完整 ZIP 包包含主题源码、已编译脚本、启用/恢复入口、Node.js 运行时及许可、截图与验收报告。Node 运行时取自本机 WorkBuddy 自带的 `resources/vendor/node.zip`，无需网络下载；不打包 WorkBuddy 自身代码。ZIP 旁附 SHA-256。

目录可以独立解压使用，不依赖 Codex、DSH、上游主题仓库或桌宠。更新主题包后再次运行启用入口，会替换原主题助手；停止后仍保留用户配置。
