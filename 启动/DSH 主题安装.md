# DSH 主题

安装包生成后会出现在本目录。首次生成或更新主题时，在仓库根目录打开 PowerShell 并运行：

```powershell
npm pack .\themes\dsh --pack-destination .\启动
```

在 DSH 自带的终端运行以下命令，将引号内替换成安装包的实际路径：

```powershell
dsh plugin --profile desktop add "C:\可露希尔的Codex\启动\dsh-closure-codex-theme-0.1.4.tgz"
```

安装或更新插件后，从系统托盘退出 DSH 一次，再从桌宠菜单启动。以后点击 DSH 旁的「启动」时，桌宠顶部的「启用主题」也会应用到已经打开的窗口。
