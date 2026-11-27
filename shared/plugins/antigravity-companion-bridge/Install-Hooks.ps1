param(
    [string]$CompanionExe = (Join-Path $PSScriptRoot '../../closure-companion-tauri.exe'),
    [string]$Config = (Join-Path $env:USERPROFILE '.gemini/config/hooks.json'),
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$name = 'closure-companion'
$configPath = [IO.Path]::GetFullPath($Config)

function New-Handler([string]$EventName, [string]$EncodedPath) {
    $response = if ($EventName -eq 'stop') { '{"decision":"allow"}' } else { '{}' }
    $script = @"
`$ErrorActionPreference = 'Stop'
try {
    `$OutputEncoding = [Text.UTF8Encoding]::new(`$false)
    [Console]::InputEncoding = `$OutputEncoding
    `$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$EncodedPath'))
    if (Test-Path -LiteralPath `$exe -PathType Leaf) {
        `$payload = [Console]::In.ReadToEnd()
        `$payload | & `$exe --antigravity-hook $EventName | Out-Null
    }
} catch {}
[Console]::WriteLine('$response')
"@
    $command = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    @{
        type = 'command'
        command = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $command"
        timeout = 5
    }
}

function Test-Handler($Handlers, [string]$EventName) {
    if (@($Handlers).Count -ne 1 -or $Handlers[0].type -ne 'command') { return $false }
    if ($Handlers[0].command -notmatch '^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$') {
        return $false
    }
    try {
        $source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
        return $source.Contains("--antigravity-hook $EventName | Out-Null")
    } catch { return $false }
}

$exists = Test-Path -LiteralPath $configPath -PathType Leaf
if ($exists) {
    $settings = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settings -isnot [pscustomobject]) { throw 'hooks.json must contain a JSON object.' }
} else {
    $settings = [pscustomobject]@{}
}
$current = $settings.PSObject.Properties[$name]
if ($current -and (!(Test-Handler $current.Value.PreInvocation 'start') -or !(Test-Handler $current.Value.Stop 'stop'))) {
    throw "The hook group '$name' is already in use."
}
if ($Remove) {
    if (-not $current) { return }
    $settings.PSObject.Properties.Remove($name)
} else {
    $executable = (Resolve-Path -LiteralPath $CompanionExe).ProviderPath
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Desktop pet EXE expected.' }
    $encodedPath = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($executable))
    $group = [ordered]@{
        enabled = -not $current -or $current.Value.enabled -ne $false
        PreInvocation = @(New-Handler 'start' $encodedPath)
        Stop = @(New-Handler 'stop' $encodedPath)
    }
    $settings | Add-Member -NotePropertyName $name -NotePropertyValue $group -Force
}

$directory = Split-Path -LiteralPath $configPath
[IO.Directory]::CreateDirectory($directory) | Out-Null
$temporary = Join-Path $directory ('.closure-hooks-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    [IO.File]::WriteAllText($temporary, ($settings | ConvertTo-Json -Depth 100) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    if ($exists) {
        $backup = $configPath + '.closure-' + [guid]::NewGuid().ToString('N') + '.bak'
        [IO.File]::Replace($temporary, $configPath, $backup)
        Write-Output "Previous configuration: $backup"
    } else {
        [IO.File]::Move($temporary, $configPath)
    }
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
Write-Output $configPath
