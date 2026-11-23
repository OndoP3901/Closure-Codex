param(
    [string] $PackagePath = (Join-Path $PSScriptRoot '../dist/v0.6.0/Closure-Codex-v0.6.0-win-x64.zip'),
    [string] $OutputDirectory = (Join-Path $PSScriptRoot '../work/release-clean-install')
)
$ErrorActionPreference = 'Stop'
$output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
$runRoot = (New-Item -ItemType Directory -Path (Join-Path $output ('全新安装 & 空格-' + [guid]::NewGuid().ToString('N')))).FullName
$extract = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'extracted')).FullName
$startup = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'startup')).FullName
$report = [ordered]@{ passed=$false; version='0.6.0'; scope='Same Windows host, isolated extraction and empty profiles; private Startup folder; external Node excluded from PATH'; installScope='Setup.ps1 with private StartupFolder and SkipStart; actual Windows login was not exercised'; os=[Environment]::OSVersion.VersionString; runRoot=$runRoot; checks=@() }
$original = @{}
foreach ($name in 'PATH','ELECTRON_RUN_AS_NODE','CLOSURE_STATE_DIR','CLOSURE_BUBBLE_PNG','CODEX_HOME','LOCALAPPDATA','CLOSURE_TEST_PACKAGE_ROOT','CLOSURE_TEST_OUTPUT') {
    $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$realStartup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Closure Codex Lifecycle.lnk'
$startupHash = if (Test-Path -LiteralPath $realStartup) { (Get-FileHash -LiteralPath $realStartup).Hash } else { $null }
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
function Assert-Check($condition, [string] $label) {
    if (!$condition) { throw $label }
    $script:report.checks += $label
}
function Run-Child([string] $label, [string] $executable, [string] $arguments, [int] $timeout = 30000) {
    $stdout = Join-Path $runRoot ($label + '.stdout.log')
    $stderr = Join-Path $runRoot ($label + '.stderr.log')
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $runRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (!$process.WaitForExit($timeout)) { $process.Kill(); throw ($label + ' timed out; see ' + $stderr) }
    if ($process.ExitCode -ne 0) { throw ($label + ' failed: ' + [IO.File]::ReadAllText($stderr)) }
    $script:report.checks += $label
    return [IO.File]::ReadAllText($stdout)
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $resolvedZip = (Resolve-Path -LiteralPath $PackagePath).Path
    $report.package = $resolvedZip
    $report.sha256 = (Get-FileHash -LiteralPath $resolvedZip).Hash.ToLowerInvariant()
    [IO.Compression.ZipFile]::ExtractToDirectory($resolvedZip, $extract)
    $package = Join-Path $extract 'Closure-Codex-v0.6.0-win-x64'
    $runtime = Join-Path $package 'work/companion-runtime/electron/electron.exe'
    $profile = Join-Path $package 'work/companion-profile'
    Assert-Check (!(Test-Path -LiteralPath $profile)) 'archive has no preexisting pet profile'
    Assert-Check (Test-Path -LiteralPath $runtime -PathType Leaf) 'archive supplies its Electron runtime'
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0;$env:SystemRoot\System32\Wbem"
    $env:CODEX_HOME = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'empty-codex-home')).FullName
    $env:LOCALAPPDATA = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'local-app-data')).FullName
    Assert-Check (!(Get-Command node.exe -ErrorAction SilentlyContinue)) 'external Node is unavailable in test PATH'
    $setup = Join-Path $package 'Setup.ps1'
    $configure = Join-Path $package 'outputs/closure-autostart/Configure.ps1'
    $watcher = Join-Path $package 'outputs/closure-autostart/Watch-Codex.ps1'
    $common = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '
    $null = Run-Child 'fresh-install-registration' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -SkipStart')
    $linkPath = Join-Path $startup 'Closure Codex Lifecycle.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    Assert-Check ((Test-Path -LiteralPath $linkPath) -and $link.TargetPath -eq $powershell -and $link.Arguments.Contains('"' + $watcher + '"') -and $link.WorkingDirectory -eq (Split-Path $watcher)) 'real Startup shortcut targets the extracted package'
    $probe = Join-Path $runRoot 'probe.cjs'
    $modulePath = ConvertTo-Json (Join-Path $package 'outputs/closure-companion/runtime-settings.cjs') -Compress
    $profileJson = ConvertTo-Json $profile -Compress
    [IO.File]::WriteAllText($probe, @"
const assert=require('node:assert/strict');const{readRuntimeSettings}=require($modulePath);
readRuntimeSettings($profileJson).then(s=>{assert.deepEqual(s,{codexLinked:false,showOutsideCodex:true,startAtLogin:true});console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,defaults:s}))}).catch(e=>{console.error(e);process.exitCode=1})
"@, [Text.UTF8Encoding]::new($false))
    $env:ELECTRON_RUN_AS_NODE = '1'
    $report.runtime = (Run-Child 'bundled-runtime-and-fresh-defaults' $runtime ('"' + $probe + '"')) | ConvertFrom-Json
    $env:ELECTRON_RUN_AS_NODE = $null
    $env:CLOSURE_STATE_DIR = $profile
    $env:CLOSURE_BUBBLE_PNG = Join-Path $runRoot 'packaged-webgl.png'
    $webgl = Run-Child 'packaged-webgl-interaction-and-settings' $runtime ('"' + (Join-Path $package 'outputs/closure-companion') + '" --smoke --mute-audio')
    Assert-Check ($webgl.Contains('"bubbleAppearance"') -and $webgl.Contains('"persisted":true') -and $webgl.Contains('"rightClickExit":true')) 'new bubble controls persist and right-click quit completes'
    $env:CLOSURE_STATE_DIR = Join-Path $runRoot 'fresh-canvas-profile'
    $env:CLOSURE_BUBBLE_PNG = Join-Path $runRoot 'packaged-canvas.png'
    $null = Run-Child 'packaged-canvas-fallback' $runtime ('"' + (Join-Path $package 'outputs/closure-companion') + '" --smoke --canvas --mute-audio')
    $env:CLOSURE_STATE_DIR = $null
    $theme = Join-Path $package 'outputs/closure-decoration/Theme.ps1'
    $themeRoot = Join-Path $runRoot 'fresh-theme-state'
    $null = Run-Child 'theme-powershell-without-node' $powershell ($common + '"' + $theme + '" -Mode status -StateRoot "' + $themeRoot + '" -NoShortcuts')
    $request = Get-ChildItem -LiteralPath $themeRoot -Filter 'request-*.json' | Select-Object -First 1
    Assert-Check (($request | Get-Content -Raw | ConvertFrom-Json).ok) 'theme entry uses the bundled runtime successfully'
    $null = Run-Child 'fresh-theme-restore-vbs' (Join-Path $env:SystemRoot 'System32/cscript.exe') ('//B //Nologo "' + (Join-Path $package 'Restore-Codex-Appearance.vbs') + '"')
    $null = Run-Child 'upgrade-preserves-disabled-startup' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -SkipStart')
    Assert-Check (!(Test-Path -LiteralPath $linkPath)) 'upgrade preserves the saved disabled startup choice'
    $null = Run-Child 'enable-startup-registration' $powershell ($common + '"' + $configure + '" -StartupFolder "' + $startup + '" -RegistrationOnly')
    Assert-Check (Test-Path -LiteralPath $linkPath) 'startup can be enabled again'
    $null = Run-Child 'uninstall-registration' $powershell ($common + '"' + $setup + '" -StartupFolder "' + $startup + '" -Uninstall -SkipStart')
    Assert-Check (!(Test-Path -LiteralPath $linkPath)) 'uninstall removes the test Startup link'
    Assert-Check (Test-Path -LiteralPath (Join-Path $profile 'runtime-settings.json')) 'uninstall retains saved pet settings'
    $env:CLOSURE_TEST_PACKAGE_ROOT = $package
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-decoration'
    $null = Run-Child 'packaged-page-decoration' $runtime ('"' + (Join-Path $PSScriptRoot 'decoration-cdp.cjs') + '" --mute-audio')
    $env:CLOSURE_TEST_OUTPUT = Join-Path $runRoot 'packaged-official-theme'
    $env:ELECTRON_RUN_AS_NODE = '1'
    $null = Run-Child 'packaged-official-theme-lifecycle' $runtime ('"' + (Join-Path $PSScriptRoot 'theme-entry-official.cjs') + '"') 180000
    $afterHash = if (Test-Path -LiteralPath $realStartup) { (Get-FileHash -LiteralPath $realStartup).Hash } else { $null }
    Assert-Check ($afterHash -eq $startupHash) 'the current user Startup link is unchanged'
    $report.passed = $true
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    # Clean up only helpers whose command line refers to this unique test directory.
    Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($runRoot) -and
        $_.Name -in @('powershell.exe','cscript.exe','electron.exe')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($name in $original.Keys) { [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process') }
    $report.completedAt = [DateTimeOffset]::Now.ToString('o')
    $json = $report | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $output 'report.json'), $json, [Text.UTF8Encoding]::new($false))
    $json
}
