param(
    [switch] $Disable,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [string] $ElectronExe = $env:CLOSURE_ELECTRON_EXE
)

$ErrorActionPreference = 'Stop'
$petApp = $PSScriptRoot
if (!$ElectronExe) {
    $root = Split-Path -Parent (Split-Path -Parent $petApp)
    $ElectronExe = Join-Path $root 'work/companion-runtime/electron/electron.exe'
}
$shortcutPath = Join-Path $StartupFolder '可露希尔桌宠.lnk'
$legacyPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$shell = New-Object -ComObject WScript.Shell

function Remove-LegacyShortcut {
    if (!(Test-Path -LiteralPath $legacyPath -PathType Leaf)) { return }
    $legacy = $shell.CreateShortcut($legacyPath)
    if ($legacy.Arguments -like '*closure-autostart*Watch-Codex.ps1*') {
        Remove-Item -LiteralPath $legacyPath -Force
    }
}

if ($Disable) {
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $expected = '*"' + [WildcardPattern]::Escape($petApp) + '"*--standalone*'
        if ($shortcut.TargetPath -eq $ElectronExe -and $shortcut.Arguments -like $expected) {
            Remove-Item -LiteralPath $shortcutPath -Force
        }
    }
    Remove-LegacyShortcut
    return
}

if (!(Test-Path -LiteralPath $ElectronExe -PathType Leaf)) { throw "Missing Electron: $ElectronExe" }
if (!(Test-Path -LiteralPath (Join-Path $petApp 'main.cjs') -PathType Leaf)) { throw "Missing pet app: $petApp" }

New-Item -ItemType Directory -Path $StartupFolder -Force | Out-Null
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $ElectronExe
$shortcut.Arguments = '"' + $petApp + '" --standalone'
$shortcut.WorkingDirectory = $petApp
$shortcut.WindowStyle = 1
$icon = Join-Path $petApp 'upstream/icon.ico'
$shortcut.IconLocation = if (Test-Path -LiteralPath $icon -PathType Leaf) { "$icon,0" } else { "$ElectronExe,0" }
$shortcut.Description = 'Start the Closure desktop pet in standalone mode.'
$shortcut.Save()
Remove-LegacyShortcut
