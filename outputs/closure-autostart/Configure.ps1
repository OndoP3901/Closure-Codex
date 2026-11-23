param(
    [switch] $Disable,
    [switch] $NoActivity,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [switch] $SkipStart,
    [switch] $RegistrationOnly,
    [switch] $Status
)

$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$watcher = Join-Path $PSScriptRoot 'Watch-Codex.ps1'
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'

if ($Status) {
    $enabled = $false
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        $shell = New-Object -ComObject WScript.Shell
        $existing = $shell.CreateShortcut($shortcutPath)
        $enabled = $existing.Arguments -like ('*"' + [WildcardPattern]::Escape($watcher) + '"*')
    }
    @{ startAtLogin = [bool]$enabled } | ConvertTo-Json -Compress
    return
}

if ($Disable) {
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        Remove-Item -LiteralPath $shortcutPath
    }
    if (!$SkipStart -and !$RegistrationOnly) { & $watcher -Stop }
    return
}

$outputs = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $outputs
foreach ($item in (Join-Path $outputs 'closure-companion/main.cjs'), (Join-Path $workspace 'work/companion-runtime/electron/electron.exe')) {
    if (!(Test-Path -LiteralPath $item -PathType Leaf)) { throw "Missing Closure component: $item" }
}

$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watcher + '"'
# Accept the old switch for upgrade callers, but runtime-settings.json now owns linkage.
$startAtLogin = $true
$settingsPath = Join-Path $workspace 'work/companion-profile/runtime-settings.json'
if (!$RegistrationOnly -and (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($settings.startAtLogin -is [bool]) { $startAtLogin = $settings.startAtLogin }
}
if ($startAtLogin) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Start the Closure desktop pet at Windows login; follow Codex when enabled.'
    $shortcut.Save()
} elseif (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    Remove-Item -LiteralPath $shortcutPath
}
if (!$SkipStart -and !$RegistrationOnly) { Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden }
