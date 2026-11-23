param(
    [ValidateSet('enable','disable','status','inspect')] [string] $Mode = 'enable',
    [string] $StateRoot = (Join-Path $env:LOCALAPPDATA 'ClosureCodexTheme'),
    [switch] $NoShortcuts,
    [switch] $Silent
)
$ErrorActionPreference = 'Stop'
function Report-Failure([string] $Message) {
    Write-Host $Message -ForegroundColor Red
    if ($Silent) {
        try {
            Add-Type -AssemblyName PresentationFramework
            [void][System.Windows.MessageBox]::Show($Message, 'Codex theme', 'OK', 'Error')
        } catch { }
    }
}
try {
    $bundled = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/companion-runtime/electron/electron.exe'))
    if (Test-Path -LiteralPath $bundled -PathType Leaf) {
        $runtime = $bundled
        $env:ELECTRON_RUN_AS_NODE = '1'
    } else {
        $runtime = (Get-Command node.exe -ErrorAction Stop).Source
        $env:ELECTRON_RUN_AS_NODE = $null
    }
    New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
    $request = Join-Path $StateRoot ('request-' + [Guid]::NewGuid().ToString('N'))
    $resultPath = $request + '.json'
    $entry = Join-Path $PSScriptRoot 'theme-launcher.cjs'
    $arguments = '"' + $entry + '" --mode ' + $Mode + ' --state-root "' + $StateRoot + '" --result "' + $resultPath + '"'
    if ($NoShortcuts) { $arguments += ' --no-shortcuts' }
    $worker = Start-Process -FilePath $runtime -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput ($request + '.stdout.log') -RedirectStandardError ($request + '.stderr.log')
    Write-Host 'Preparing Codex theme. First setup needs a running Codex; later launches use the saved profile directly.'
    for ($attempt=0; $attempt -lt 240; $attempt++) {
        if (Test-Path -LiteralPath $resultPath) {
            $result = [IO.File]::ReadAllText($resultPath) | ConvertFrom-Json
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            Write-Host $result.message
            if (!$result.ok) { Report-Failure ($result.message + [Environment]::NewLine + 'Log: ' + $request + '.stderr.log'); exit 1 }
            exit 0
        }
        $worker.Refresh()
        if ($worker.HasExited) { throw ('Theme worker exited. See ' + $request + '.stderr.log') }
        Start-Sleep -Milliseconds 500
    }
    throw ('Theme startup is still pending. See ' + $request + '.stdout.log')
} catch {
    Report-Failure $_.Exception.Message
    exit 1
}
