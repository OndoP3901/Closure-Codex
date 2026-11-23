$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('closure-startup-' + [guid]::NewGuid().ToString('N'))
$fixturePath = [IO.Path]::GetFullPath($fixture)
function Assert-Test($condition, $message) { if (!$condition) { throw $message } }
try {
    $autostart = New-Item -ItemType Directory -Path (Join-Path $fixturePath 'outputs/closure-autostart') -Force
    $startup = New-Item -ItemType Directory -Path (Join-Path $fixturePath 'startup')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../outputs/closure-autostart/Configure.ps1') -Destination $autostart.FullName
    $config = Join-Path $autostart.FullName 'Configure.ps1'
    Set-Content -LiteralPath (Join-Path $autostart.FullName 'Watch-Codex.ps1') -Value "throw 'Registration must not start or stop helpers.'"
    foreach ($file in 'outputs/closure-companion/main.cjs', 'work/companion-runtime/electron/electron.exe') {
        $target = Join-Path $fixturePath $file
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force)
        [IO.File]::WriteAllText($target, '')
    }
    $shortcut = Join-Path $startup.FullName 'Closure Codex Lifecycle.lnk'
    & $config -StartupFolder $startup.FullName -SkipStart
    Assert-Test (Test-Path -LiteralPath $shortcut) 'Fresh installation must register login startup.'
    $status = & $config -StartupFolder $startup.FullName -Status | ConvertFrom-Json
    Assert-Test ($status.startAtLogin) 'Status must report the registered shortcut.'
    & $config -StartupFolder $startup.FullName -SkipStart -NoActivity
    $shell = New-Object -ComObject WScript.Shell
    Assert-Test ($shell.CreateShortcut($shortcut).Arguments -notmatch ' -NoActivity(?:\s|$)') 'Legacy standalone flags must not override the new linkage checkbox.'
    & $config -StartupFolder $startup.FullName -Disable -RegistrationOnly
    Assert-Test (!(Test-Path -LiteralPath $shortcut)) 'Unchecking startup must remove the shortcut without stopping helpers.'
    $status = & $config -StartupFolder $startup.FullName -Status | ConvertFrom-Json
    Assert-Test (!$status.startAtLogin) 'Status must report disabled startup.'
    $profile = New-Item -ItemType Directory -Path (Join-Path $fixturePath 'work/companion-profile')
    Set-Content -LiteralPath (Join-Path $profile.FullName 'runtime-settings.json') -Value '{"codexLinked":true,"startAtLogin":false}'
    & $config -StartupFolder $startup.FullName -SkipStart
    Assert-Test (!(Test-Path -LiteralPath $shortcut)) 'Upgrades must preserve an explicit disabled startup choice.'
    & $config -StartupFolder $startup.FullName -RegistrationOnly
    Assert-Test (Test-Path -LiteralPath $shortcut) 'Checking startup must register immediately.'
    & $config -StartupFolder $startup.FullName -Disable -SkipStart
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../Setup.ps1') -Destination $fixturePath
    Set-Content -LiteralPath $config -Value @'
param([switch] $Disable, [string] $StartupFolder, [switch] $SkipStart)
if (!$Disable) { throw 'Uninstall must disable lifecycle registration.' }
[IO.File]::WriteAllText((Join-Path $StartupFolder 'uninstall-called.txt'), 'disabled')
'@
    & (Join-Path $fixturePath 'Setup.ps1') -Uninstall -StartupFolder $startup.FullName -SkipStart
    Assert-Test (Test-Path -LiteralPath (Join-Path $startup.FullName 'uninstall-called.txt')) 'Uninstall must clean up even when startup was unchecked.'
    'Startup registration, status and upgrade preferences passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixturePath)
    if ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and
        [IO.Path]::GetFileName($resolved).StartsWith('closure-startup-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
