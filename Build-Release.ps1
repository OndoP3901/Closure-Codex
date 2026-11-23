param(
    [string] $Version = '0.5.0',
    [string] $ElectronZip = (Join-Path $PSScriptRoot 'work/companion-runtime/electron-mirror.zip'),
    [string] $Destination = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric version such as 0.2.0.' }
$runtimeHash = '2BA6223AFA9121F42831FEFE92C434334907540165294FC56697449D12E7CFE9'
if (!(Test-Path -LiteralPath $ElectronZip -PathType Leaf) -or (Get-FileHash -LiteralPath $ElectronZip).Hash -ne $runtimeHash) {
    throw 'Supply the official electron-v45.4.1-win32-x64.zip using -ElectronZip.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$destinationPath = (New-Item -ItemType Directory -Path $Destination -Force).FullName
$name = "Closure-Codex-v$Version-win-x64"
$staging = Join-Path $destinationPath ($name + '-' + [Guid]::NewGuid().ToString('N'))
$package = New-Item -ItemType Directory -Path (Join-Path $staging $name)
$packagePath = $package.FullName
try {
    foreach ($file in 'Install.cmd','Uninstall.cmd','Copy-Dark-Theme.cmd','Copy-Light-Theme.cmd','Start-Pet.cmd','Setup.ps1','README.md','CHANGELOG.md') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $packagePath
    }
    $outputPath = New-Item -ItemType Directory -Path (Join-Path $packagePath 'outputs')
    foreach ($component in 'closure-autostart','closure-companion','closure-crt','closure-pet','closure-theme') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "outputs/$component") -Destination $outputPath.FullName -Recurse
    }
    foreach ($file in 'Start-Closure.cmd',([string][char]0x4F7F + [char]0x7528 + [char]0x8BF4 + [char]0x660E + '.txt')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "outputs/$file") -Destination $outputPath.FullName
    }
    & (Join-Path $outputPath.FullName 'closure-crt/Build.ps1')
    $runtimePath = New-Item -ItemType Directory -Path (Join-Path $packagePath 'work/companion-runtime/electron') -Force
    [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $ElectronZip).Path, $runtimePath.FullName)

    $zip = Join-Path $destinationPath "$name.zip"
    $temporaryZip = Join-Path $staging "$name.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($packagePath, $temporaryZip, [IO.Compression.CompressionLevel]::Optimal, $true)
    Move-Item -LiteralPath $temporaryZip -Destination $zip -Force
    $hash = (Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $destinationPath 'SHA256SUMS.txt') -Value "$hash *$name.zip" -Encoding Ascii
    Get-Item -LiteralPath $zip
} finally {
    $resolved = (Resolve-Path -LiteralPath $staging).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $destinationPath -and [IO.Path]::GetFileName($resolved).StartsWith("$name-")) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
