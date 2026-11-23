# Explicit local cleanup for the 0.6.0 migration. Uses the Windows Recycle Bin.
param([switch] $IncludeOldReleases)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$workRoot = Join-Path $projectRoot 'work'
$reportPath = Join-Path $workRoot 'release-0.6.0/cleanup.json'
[void](New-Item -ItemType Directory -Path (Split-Path $reportPath) -Force)
$relativePaths = @(
    'Copy-Dark-Theme.cmd', 'Copy-Light-Theme.cmd',
    'outputs/closure-crt',
    'work/部署说明.txt', 'work/crt-settings.ini',
    'work/release-theme-smoke', 'work/cdp-launcher-test', 'work/cdp-integration',
    'work/inline-theme-probe', 'work/theme-entry-test', 'work/refresh-theme-release.ps1'
)
$temporaryPrefixes = @('bubble-follow-canvas-','bubble-follow-smoke-','display-scope-smoke-','no-tray-smoke-','retired-crt-smoke-','runtime-smoke-')
foreach ($directory in Get-ChildItem -LiteralPath $workRoot -Directory) {
    if (@($temporaryPrefixes | Where-Object { $directory.Name.StartsWith($_) }).Count) { $relativePaths += 'work/' + $directory.Name }
}
if ($IncludeOldReleases) {
    $relativePaths += @('dist/Closure-Codex-v0.2.0-win-x64.zip','dist/Closure-Codex-v0.3.0-win-x64.zip','dist/v0.4.1','dist/v0.5.0','dist/SHA256SUMS.txt')
}
$processes = @(Get-CimInstance Win32_Process)
$protected = @('work/companion-profile','work/companion-runtime','work/decorated-codex','work/current-codex-decoration','production')
$candidates = @()
foreach ($relative in $relativePaths | Select-Object -Unique) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (!$absolute.StartsWith($projectRoot + '\',[StringComparison]::OrdinalIgnoreCase) -or $relative -in $protected) { throw ('Cleanup path is outside its allowed scope: ' + $relative) }
    if (!(Test-Path -LiteralPath $absolute)) { continue }
    $item = Get-Item -LiteralPath $absolute -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('Cleanup refuses a reparse point: ' + $relative) }
    $users = @($processes | Where-Object {
        $_.ExecutablePath -and ($_.ExecutablePath -eq $absolute -or $_.ExecutablePath.StartsWith($absolute + '\',[StringComparison]::OrdinalIgnoreCase)) -or
        $_.CommandLine -and $_.CommandLine.IndexOf($absolute,[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($users.Count) { throw ('Cleanup path is still in use: ' + $relative) }
    $bytes = if ($item.PSIsContainer) { (Get-ChildItem -LiteralPath $absolute -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum } else { $item.Length }
    $candidates += [pscustomobject]@{ Relative=$relative; Absolute=$absolute; Directory=[bool]$item.PSIsContainer; Bytes=[long]$bytes }
}
if ($IncludeOldReleases) {
    $newRelease = Join-Path $projectRoot 'dist/v0.6.0/Closure-Codex-v0.6.0-win-x64.zip'
    $sum = Join-Path (Split-Path $newRelease) 'SHA256SUMS.txt'
    if (!(Test-Path -LiteralPath $newRelease) -or !(Test-Path -LiteralPath $sum)) { throw 'Build and verify v0.6.0 before removing old releases.' }
    $expected = (Get-Content -LiteralPath $sum -Raw).Split(' ')[0].Trim()
    if ((Get-FileHash -LiteralPath $newRelease).Hash -ne $expected) { throw 'The new release checksum does not match.' }
}
Add-Type -AssemblyName Microsoft.VisualBasic
$completed = @()
foreach ($candidate in $candidates) {
    if ($candidate.Directory) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($candidate.Absolute,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($candidate.Absolute,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    }
    $completed += $candidate
}
$report = [ordered]@{ version='0.6.0'; method='Windows Recycle Bin'; cleaned=$completed; protected=$protected; totalBytes=[long](($completed | Measure-Object -Property Bytes -Sum).Sum) }
[IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Depth 5
