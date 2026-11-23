param(
    [switch] $Uninstall,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [switch] $SkipStart
)

$ErrorActionPreference = 'Stop'
$autostart = Join-Path $PSScriptRoot 'outputs/closure-autostart'
$config = Join-Path $autostart 'Configure.ps1'
$watcher = Join-Path $autostart 'Watch-Codex.ps1'
$shortcutPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$shell = New-Object -ComObject WScript.Shell
$previous = if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) { $shell.CreateShortcut($shortcutPath) }
$registration = @{ StartupFolder = $StartupFolder; SkipStart = $SkipStart }

if ($Uninstall) {
    if (!$previous -or $previous.Arguments -like ('*"' + [WildcardPattern]::Escape($watcher) + '"*')) {
        & $config @registration -Disable
    }
    return
}

if ([Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE') -ne 'AMD64' -and
    [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432') -ne 'AMD64') {
    throw 'This release requires Windows x64.'
}

if (!$SkipStart) {
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
    & $config @registration
} catch {
    if ($previous -and !$SkipStart) {
        Start-Process -FilePath $previous.TargetPath -ArgumentList $previous.Arguments -WorkingDirectory $previous.WorkingDirectory -WindowStyle Hidden
    }
    throw
}
Write-Output 'Closure Codex is ready for this Windows user.'
