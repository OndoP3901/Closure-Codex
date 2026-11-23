param(
    [switch] $Disable,
    [switch] $Autostart,
    [switch] $NoActivity,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [switch] $SkipStart
)

$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$watcher = Join-Path $PSScriptRoot 'Watch-Codex.ps1'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'

if ($Disable) {
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        Remove-Item -LiteralPath $shortcutPath
    }
    if (!$SkipStart) { & $watcher -Stop }
    return
}

$outputs = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $outputs
foreach ($item in (Join-Path $outputs 'closure-companion/main.cjs'), (Join-Path $workspace 'work/companion-runtime/electron/electron.exe')) {
    if (!(Test-Path -LiteralPath $item -PathType Leaf)) { throw "Missing Closure component: $item" }
}

$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watcher + '"'
if ($NoActivity) { $arguments += ' -NoActivity' }
$shell = New-Object -ComObject WScript.Shell
if ($Autostart) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Start the Closure desktop pet. Codex themes and windows are not modified.'
    $shortcut.Save()
} elseif (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.Arguments -like ('*"' + [WildcardPattern]::Escape($watcher) + '"*')) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
}
if (!$SkipStart) { Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden }
