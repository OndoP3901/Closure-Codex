param(
    [switch] $Uninstall,
    [ValidateSet('Dark', 'Light')] [string] $CopyTheme,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [string] $ShortcutFolder = [Environment]::GetFolderPath('Desktop'),
    [switch] $SkipShortcut,
    [switch] $SkipStart
)

$ErrorActionPreference = 'Stop'
if ($CopyTheme) {
    $theme = Join-Path $PSScriptRoot ('outputs/closure-theme/closure-' + $CopyTheme.ToLowerInvariant() + '.txt')
    Set-Clipboard -Value ([IO.File]::ReadAllText($theme).Trim())
    return
}

$autostart = Join-Path $PSScriptRoot 'outputs/closure-autostart'
$config = Join-Path $autostart 'Configure.ps1'
$watcher = Join-Path $autostart 'Watch-Codex.ps1'
$shortcutPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$petApp = Join-Path $PSScriptRoot 'outputs/closure-companion'
$electronExe = Join-Path $PSScriptRoot 'work/companion-runtime/electron/electron.exe'
$petIcon = Join-Path $petApp 'upstream/icon.ico'
$petShortcutPath = if ($ShortcutFolder) { Join-Path $ShortcutFolder '可露希尔桌宠.lnk' }
$shell = New-Object -ComObject WScript.Shell
$previous = if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) { $shell.CreateShortcut($shortcutPath) }
$registration = @{ StartupFolder = $StartupFolder; SkipStart = $SkipStart }

function Remove-PetShortcut {
    if (!$petShortcutPath -or !(Test-Path -LiteralPath $petShortcutPath -PathType Leaf)) { return }
    $shortcut = $shell.CreateShortcut($petShortcutPath)
    if ($shortcut.TargetPath -ne $electronExe) { return }
    Remove-Item -LiteralPath $petShortcutPath -Force
}

function Install-PetShortcut {
    if ($SkipShortcut -or !$petShortcutPath) { return }
    if (!(Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw "Missing Closure component: $electronExe" }
    New-Item -ItemType Directory -Path $ShortcutFolder -Force | Out-Null
    $shortcut = $shell.CreateShortcut($petShortcutPath)
    $shortcut.TargetPath = $electronExe
    $shortcut.Arguments = '"' + $petApp + '" --standalone'
    $shortcut.WorkingDirectory = $petApp
    $shortcut.WindowStyle = 1
    $shortcut.IconLocation = if (Test-Path -LiteralPath $petIcon -PathType Leaf) { "$petIcon,0" } else { "$electronExe,0" }
    $shortcut.Description = 'Start the Closure desktop pet in standalone mode.'
    $shortcut.Save()
}

if ($Uninstall) {
    Remove-PetShortcut
    if ($previous -and $previous.Arguments -like ('*"' + [WildcardPattern]::Escape($watcher) + '"*')) {
        & $config @registration -Disable
    }
    return
}

if ([Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE') -ne 'AMD64' -and
    [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432') -ne 'AMD64') {
    throw 'This release requires Windows x64.'
}

$preserveNoActivity = [bool]($previous.Arguments -match ' -NoActivity(?:\s|$)')
if ($previous -and !$SkipStart) {
    & $watcher -Stop
    $lifecycle = [Threading.Mutex]::new($false, 'Local\ClosureCodexLifecycle.v1')
    try {
        try { $released = $lifecycle.WaitOne(7000) }
        catch [Threading.AbandonedMutexException] { $released = $true }
        if (!$released) { throw 'The previous Closure Codex watcher is still exiting. Run Install.cmd again.' }
        $lifecycle.ReleaseMutex()
    } finally {
        $lifecycle.Dispose()
    }
}
try {
    & $config @registration -NoActivity:$preserveNoActivity
} catch {
    if ($previous -and !$SkipStart) {
        Start-Process -FilePath $previous.TargetPath -ArgumentList $previous.Arguments -WorkingDirectory $previous.WorkingDirectory -WindowStyle Hidden
    }
    throw
}
try {
    Install-PetShortcut
} catch {
    Write-Warning "Could not create the desktop shortcut: $($_.Exception.Message)"
}
Write-Output 'Closure desktop pet is registered for this Windows user.'
