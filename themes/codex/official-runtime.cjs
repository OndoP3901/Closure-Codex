const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

async function powershellJson(source, env = {}, step = '运行 Windows PowerShell') {
  const script = `
    $ErrorActionPreference = 'Stop'
    try {
      $value = & { ${source} }
      if ($null -eq $value) { $value = $null }
      $reply = @{ ok = $true; value = $value }
    } catch {
      $reply = @{ ok = $false; message = $_.Exception.Message }
    }
    $json = ConvertTo-Json -InputObject $reply -Depth 8 -Compress
    [Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
  `
  let reply
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20000, env: { ...process.env, ...env } })
    reply = JSON.parse(Buffer.from(stdout.trim(), 'base64').toString('utf8'))
  } catch (error) {
    const reason = error.killed ? '等待 PowerShell 超时' : error.code === 'ENOENT' ? '找不到 Windows PowerShell' :
      error.code ? 'PowerShell 退出代码 ' + error.code : 'PowerShell 未返回有效结果'
    throw new Error(step + '失败：' + reason)
  }
  if (!reply.ok) throw new Error(step + '失败：' + reply.message.replace(/\s+/g, ' ').trim())
  return reply.value
}

async function findPackage() {
  return powershellJson(`
    $p = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if (!$p) { throw '未找到当前用户注册的 Microsoft Store 版 Codex。' }
    $manifest=Get-AppxPackageManifest -Package $p.PackageFullName
    $app=@($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq 'App' } | Select-Object -First 1
    if(!$app) { $app=@($manifest.Package.Applications.Application) | Select-Object -First 1 }
    $executable=Join-Path $p.InstallLocation ([string]$app.Executable)
    if(!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw '安装清单中的 Codex 程序不存在。' }
    [pscustomobject]@{ executable=$executable; version=[string]$p.Version; family=$p.PackageFamilyName; appId=[string]$app.Id }
  `, {}, '识别 Codex 安装包')
}

function hasProfile(command, profile) {
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return new RegExp(`(?:^|\\s)(?:"--user-data-dir=${escaped}"|--user-data-dir="${escaped}"|--user-data-dir=${escaped})(?=\\s|$)`,'i').test(command || '')
}

async function verifyOwner(port, executable, profile) {
  if(!Number.isInteger(port) || port < 1024 || port > 65535)throw new Error('Invalid port')
  const result = await powershellJson(`
    @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | ForEach-Object {
      $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)
      [pscustomobject]@{ address=$_.LocalAddress; pid=$_.OwningProcess; executable=$p.ExecutablePath; command=$p.CommandLine }
    })
  `, {}, '确认 Codex 主题端口')
  const owners = [result].flat().filter(Boolean)
  if(!owners.length || owners.some(owner => !['127.0.0.1','::1'].includes(owner.address) ||
    owner.executable?.toLowerCase() !== executable.toLowerCase() || !hasProfile(owner.command,profile))) {
    throw new Error('CDP listener does not belong to this isolated official Codex profile')
  }
  return owners.map(({address,pid,executable})=>({address,pid,executable}))
}

async function terminateOwners(owners, executable, profile) {
  const ids=owners.map(owner=>owner.pid)
  if(!ids.length || ids.some(id=>!Number.isInteger(id)||id<=0))throw new Error('Invalid process identity')
  return powershellJson(`
    $escaped=[regex]::Escape($env:CLOSURE_EXPECT_PROFILE)
    $pattern='(?:^|\\s)(?:"--user-data-dir=' + $escaped + '"|--user-data-dir="' + $escaped + '"|--user-data-dir=' + $escaped + ')(?=\\s|$)'
    foreach($id in @(${ids.join(',')})) {
      $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id)
      if(!$p) { continue }
      if($p.ExecutablePath -ne $env:CLOSURE_EXPECT_EXE -or ![regex]::IsMatch($p.CommandLine,$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)) { throw 'Refusing to stop a process with changed identity' }
      Stop-Process -Id $id -ErrorAction Stop
    }
    $true
  `,{CLOSURE_EXPECT_EXE:executable,CLOSURE_EXPECT_PROFILE:profile})
}

module.exports = { findPackage,verifyOwner,hasProfile,terminateOwners,powershellJson }
