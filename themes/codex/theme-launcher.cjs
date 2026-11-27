const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { parseArgs } = require('node:util')
const { findPackage,verifyOwner,powershellJson } = require('./official-runtime.cjs')
const { connect,evaluate } = require('./cdp.cjs')
const { buildPayload } = require('./renderer-payload.cjs')
const project = __dirname
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms))
const equalPath = (a,b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const readJson = file => fs.readFile(file,'utf8').then(text=>JSON.parse(text.replace(/^\uFEFF/,''))).catch(()=>null)
async function writeJson(file,value) {
  await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2),'utf8')
  await fs.rename(file+'.tmp',file)
}
function parseProfile(command) {
  const match=/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s]+))(?=\s|$)/i.exec(command || '')
  return match ? match[1] || match[2] || match[3] : null
}
function selectTarget(processes, remembered, projectRoot=project) {
  const experimental=path.join(projectRoot,'work').toLowerCase()+path.sep
  const ordinary=processes.filter(item=>item.profile && !item.headless && !path.resolve(item.profile).toLowerCase().startsWith(experimental))
  if(remembered?.profile) {
    const known=ordinary.filter(item=>equalPath(item.profile,remembered.profile))
    if(known.length===1)return known[0]
  }
  const defaults=ordinary.filter(item=>!item.explicitProfile)
  if(defaults.length===1)return defaults[0]
  if(ordinary.length===1)return ordinary[0]
  if(ordinary.length>1)throw new Error('检测到多个不同配置的 Codex 实例，请关闭多余实例后重试。')
  return null
}
async function getProcesses(pkg) {
  const value=await powershellJson(`
    $all=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CLOSURE_THEME_EXE })
    @($all | Where-Object { $_.CommandLine -notmatch '\\s--type=' } | ForEach-Object {
      $main=$_
      $renderer=$all | Where-Object { $_.ParentProcessId -eq $main.ProcessId -and $_.CommandLine -match '--user-data-dir=' } | Select-Object -First 1
      [pscustomobject]@{pid=$main.ProcessId;created=$main.CreationDate.ToString('o');command=$main.CommandLine;renderer=$renderer.CommandLine}
    })
  `,{CLOSURE_THEME_EXE:pkg.executable})
  return [value].flat().filter(Boolean).map(item=>({pid:item.pid,created:item.created,profile:parseProfile(item.renderer)||parseProfile(item.command),
    explicitProfile:!!parseProfile(item.command),headless:/--headless(?:=|\s|$)/.test(item.command),
    port:Number(/--remote-debugging-port=(\d+)(?:\s|$)/.exec(item.command)?.[1]) || null}))
}
async function startPackaged(pkg,profile,codexHome,port) {
  const args=[...(port ? ['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`] : []),
    ...(profile ? [`--user-data-dir="${profile}"`] : [])].join(' ')
  return powershellJson(`
    $env:ELECTRON_RUN_AS_NODE=$null
    $env:CODEX_ELECTRON_START_IN_BACKGROUND=$null
    $env:CODEX_ELECTRON_USER_DATA_PATH=$env:CLOSURE_THEME_PROFILE
    $env:CODEX_HOME=$env:CLOSURE_THEME_HOME
    Invoke-CommandInDesktopPackage -PackageFamilyName $env:CLOSURE_THEME_FAMILY -AppId $env:CLOSURE_THEME_APP_ID -Command $env:CLOSURE_THEME_EXE -Args $env:CLOSURE_THEME_ARGS
    $true
  `,{CLOSURE_THEME_PROFILE:profile || '',CLOSURE_THEME_HOME:codexHome,CLOSURE_THEME_FAMILY:pkg.family,
    CLOSURE_THEME_APP_ID:pkg.appId,CLOSURE_THEME_EXE:pkg.executable,CLOSURE_THEME_ARGS:args})
}
async function closeTarget(pkg,target) {
  await powershellJson(`
    $expected=ConvertFrom-Json $env:CLOSURE_THEME_TARGET
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $expected.pid)
    if(!$p) { return $true }
    if($p.ExecutablePath -ne $env:CLOSURE_THEME_EXE -or $p.CreationDate.ToString('o') -ne $expected.created) { throw 'Codex process identity changed' }
    [void](Get-Process -Id $expected.pid).CloseMainWindow()
    for($i=0;$i -lt 24;$i++) {
      if(!(Get-Process -Id $expected.pid -ErrorAction SilentlyContinue)) { return $true }
      Start-Sleep -Milliseconds 250
    }
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $expected.pid)
    if($p -and $p.ExecutablePath -eq $env:CLOSURE_THEME_EXE -and $p.CreationDate.ToString('o') -eq $expected.created) { throw 'Codex is still open. Save your work and quit Codex before trying again.' }
    $true
  `,{CLOSURE_THEME_EXE:pkg.executable,CLOSURE_THEME_TARGET:JSON.stringify(target)})
  await delay(500)
}
async function openStoreCodex(pkg) {
  await powershellJson(`
    Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('shell:AppsFolder\\'+$env:CLOSURE_THEME_APP)
    $true
  `,{CLOSURE_THEME_APP:pkg.family+'!'+pkg.appId})
}
async function choosePort() {
  for(let port=19338;port<19358;port++) {
    const free=await new Promise(resolve=>{
      const server=net.createServer()
      server.once('error',()=>resolve(false))
      server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)))
    })
    if(free)return port
  }
  throw new Error('主题启动端口均被占用，请关闭之前的主题实例后重试。')
}
async function version(port) {
  const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1200)})
  if(!response.ok)throw new Error('调试入口没有响应。')
  return response.json()
}
async function waitBrowser(pkg,profile,port) {
  for(let attempt=0;attempt<50;attempt++) {
    try {
      await verifyOwner(port,pkg.executable,profile)
      return (await version(port)).webSocketDebuggerUrl
    } catch(error) {
      if(attempt===49)throw new Error('当前 Codex 版本未能开启主题入口，已准备恢复普通启动。',{cause:error})
      await delay(400)
    }
  }
}
async function stopInjector(record) {
  if(!record?.injectorPid)return
  if(record.control) {
    await writeJson(record.control,{stop:record.browser})
    for(let n=0;n<20;n++) {
      const state=await readJson(record.injectorState)
      if(state?.injectorPid===record.injectorPid && !state.running)return
      await delay(200)
    }
  }
  // Migration of the earlier project injector, or recovery of an unresponsive helper.
  await powershellJson(`
    $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $env:CLOSURE_INJECTOR_PID)
    if($p -and $p.ExecutablePath -and $p.CommandLine.Contains($env:CLOSURE_INJECTOR_ENTRY) -and $p.CommandLine.Contains($env:CLOSURE_INJECTOR_BROWSER)) { Stop-Process -Id $p.ProcessId }
    $true
  `,{CLOSURE_INJECTOR_PID:String(record.injectorPid),CLOSURE_INJECTOR_ENTRY:record.injectorEntry || path.join(__dirname,'attach.cjs'),CLOSURE_INJECTOR_BROWSER:record.browser})
}
async function stopProjectInjectors(browser) {
  await powershellJson(`
    $entry=[regex]::Escape($env:CLOSURE_INJECTOR_ENTRY)
    $endpoint=[regex]::Escape($env:CLOSURE_INJECTOR_BROWSER)
    $scriptPattern='(?:^|\\s)"?'+$entry+'"?(?=\\s|$)'
    $browserPattern='(?:^|\\s)"?'+$endpoint+'"?(?=\\s|$)'
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -match $scriptPattern -and $_.CommandLine -match $browserPattern
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    $true
  `,{CLOSURE_INJECTOR_ENTRY:path.join(__dirname,'attach.cjs'),CLOSURE_INJECTOR_BROWSER:browser})
}
async function waitInjection(stateFile,pid) {
  let state
  for(let n=0;n<60;n++) {
    state=await readJson(stateFile)
    if(state?.injectorPid===pid && state.running && state.targets?.some(target=>target.shellReady))return state
    if(state?.injectorPid===pid && !state.running)throw new Error('主题加载助手已退出，请查看日志。')
    await delay(250)
  }
  if(state?.injectorPid!==pid || !state.targets?.some(target=>target.installed))throw new Error('没有找到可加载主题的 Codex 页面。')
  return state
}
async function checkProfile(profile) {
  if(typeof profile!=='string' || !path.isAbsolute(profile) || /["\r\n]/.test(profile))throw new Error('Codex 配置目录无效。')
  const directory=await fs.stat(profile).catch(()=>null)
  if(!directory?.isDirectory())throw new Error('之前的 Codex 配置目录已不存在。请先正常打开 Codex，再运行主题入口以重新识别。')
}
async function prepareConnection({api,pkg,config,codexHome,processes}) {
  let target=selectTarget(processes,config)
  if(!target && processes.some(item=>!item.headless && !item.profile)) {
    // A normal Codex may still be creating its renderer. Do not open a second profile over it.
    for(let n=0;n<20;n++) {
      await delay(250)
      processes=await api.getProcesses(pkg)
      target=selectTarget(processes,config)
      if(target || !processes.some(item=>!item.headless && !item.profile))break
    }
    if(!target && processes.some(item=>!item.headless && !item.profile))throw new Error('Codex 仍在初始化，尚无法识别配置目录。请等待主界面出现后重试。')
  }
  // First setup learns the real running profile. Later launches reuse it directly.
  if(!target && !config?.profile)throw new Error('首次使用主题，请先正常打开 Microsoft Store 版 Codex，等待主界面出现后，再运行主题入口。')
  const profile=target?.profile || config.profile
  await checkProfile(profile)
  let port=target?.port, browser, started=false
  const startup=target ? port ? 'attached' : 'restarted' : 'direct'
  try {
    if(port) {
      await api.verifyOwner(port,pkg.executable,profile)
      browser=(await api.version(port)).webSocketDebuggerUrl
    } else {
      port=await api.choosePort()
      if(target) {
        console.log('首次接入普通 Codex，正在保留原配置并重启一次。')
        await api.closeTarget(pkg,target)
      } else console.log('正在使用已保存的配置直接启动主题 Codex。')
      started=true
      await api.startPackaged(pkg,profile,codexHome,port)
      browser=await api.waitBrowser(pkg,profile,port)
    }
    return {profile,port,browser,startup,restarted:startup==='restarted',started}
  } catch(error) {
    if(started)await restoreStartup({api,pkg,profile,codexHome,port})
    throw error
  }
}
async function restoreStartup({api,pkg,profile,codexHome,port}) {
  try {
    const replacement=(await api.getProcesses(pkg)).find(item=>item.port===port && equalPath(item.profile,profile))
    if(replacement)await api.closeTarget(pkg,replacement)
    await api.startPackaged(pkg,profile,codexHome,null)
  } catch(error) {console.error('恢复普通 Codex 启动失败：'+error.message)}
}
async function run(options,services={}) {
  const api={findPackage,getProcesses,startPackaged,openStoreCodex,closeTarget,choosePort,version,waitBrowser,verifyOwner,buildPayload,stopInjector,
    stopProjectInjectors,...services}
  const root=path.resolve(options['state-root'] || path.join(process.env.LOCALAPPDATA,'ClosureCodexTheme'))
  const configFile=path.join(root,'config.json'), sessionFile=path.join(root,'session.json')
  const config=await readJson(configFile), previous=await readJson(sessionFile)
  if(options.mode==='status')return {ok:true,message:config?.enabled ? '已配置深色主题启动入口。' : '尚未启用深色主题。',config,session:previous}
  if(options.mode==='disable' && !config?.enabled)return {ok:true,message:'主题已经关闭。'}
  const pkg=await api.findPackage()
  let processes=await api.getProcesses(pkg)
  let target=selectTarget(processes,config)
  if(options.mode==='inspect')return {ok:true,message:'Codex 安装与原配置检测完成。',packageVersion:pkg.version,target,processes}
  if(typeof WebSocket!=='function')throw new Error('请使用完整发行包内的运行时，或安装 Node.js 22 及以上版本。')
  if(options.mode==='disable') {
    if(!config?.enabled)return {ok:true,message:'主题已经关闭。'}
    await api.stopInjector(previous)
    const current=processes.find(item=>equalPath(item.profile,config.profile) && item.port===previous?.port)
    if(current) {
      await api.verifyOwner(previous.port,pkg.executable,config.profile)
      await api.stopProjectInjectors(previous.browser)
      await api.closeTarget(pkg,current)
      await api.startPackaged(pkg,config.profile,config.codexHome,null)
    }
    await writeJson(configFile,{...config,enabled:false})
    await writeJson(sessionFile,{...previous,running:false})
    return {ok:true,message:'已恢复原外观与普通启动。原账号、聊天记录和外观设置均保留。'}
  }
  const codexHome=config?.codexHome || process.env.CODEX_HOME || path.join(process.env.USERPROFILE,'.codex')
  // Validate bundled assets before touching an ordinary running app.
  await api.buildPayload()
  if(options['from-menu'] && !config?.profile && !target && !processes.some(item=>!item.headless)) {
    await api.openStoreCodex(pkg)
    for(let attempt=0;attempt<40;attempt++){
      await delay(250)
      processes=await api.getProcesses(pkg)
      target=selectTarget(processes,config)
      if(target)break
    }
  }
  let connection, newInjector, session
  try {
    connection=await prepareConnection({api,pkg,config,codexHome,processes})
    const {profile,port,browser,restarted,startup}=connection
    if(previous?.browser===browser)await api.stopInjector(previous)
    await api.stopProjectInjectors(browser)
    const injectorState=path.join(root,'injector-state.json'), control=path.join(root,'injector-control.json')
    await fs.unlink(control).catch(error=>{if(error.code!=='ENOENT')throw error})
    const output=await fs.open(path.join(root,'injector.stdout.log'),'a'), errors=await fs.open(path.join(root,'injector.stderr.log'),'a')
    try {
      newInjector=spawn(process.execPath,[path.join(__dirname,'attach.cjs'),'--port',String(port),'--browser',browser,'--state',injectorState,'--control',control],
        {detached:true,windowsHide:true,env:process.env,stdio:['ignore',output.fd,errors.fd]})
      await new Promise((resolve,reject)=>{newInjector.once('spawn',resolve);newInjector.once('error',reject)})
      newInjector.unref()
    } finally {await output.close();await errors.close()}
    session={running:true,profile,executable:pkg.executable,port,browser,startup,restarted,injectorPid:newInjector.pid,injectorEntry:path.join(__dirname,'attach.cjs'),injectorState,control}
    await writeJson(sessionFile,session)
    const state=await waitInjection(injectorState,newInjector.pid)
    const ready=state.targets.some(item=>item.shellReady)
    await writeJson(configFile,{enabled:true,profile,codexHome,project,version:pkg.version})
    return {ok:true,message:ready ? '深色主题已启用。' : 'Codex 主界面出现后会自动应用主题。',
      shellReady:ready,restarted,startup,port,profile}
  } catch(error) {
    if(session)await api.stopInjector(session).catch(()=>{})
    if(connection?.started)await restoreStartup({api,pkg,profile:connection.profile,codexHome,port:connection.port})
    await writeJson(sessionFile,{...session,running:false,error:error.message})
    throw error
  }
}
async function main() {
  const {values}=parseArgs({options:{mode:{type:'string',default:'enable'},'state-root':{type:'string'},result:{type:'string'},'from-menu':{type:'boolean',default:false}}})
  if(!['enable','disable','status','inspect'].includes(values.mode))throw new Error('Invalid theme action')
  const root=path.resolve(values['state-root'] || path.join(process.env.LOCALAPPDATA,'ClosureCodexTheme'))
  await fs.mkdir(root,{recursive:true})
  let lock
  try {
    const lockFile=path.join(root,'operation.lock')
    if(!['inspect','status'].includes(values.mode)) {
      try {lock=await fs.open(lockFile,'wx')} catch(error) {
        if(error.code!=='EEXIST')throw error
        const owner=Number(await fs.readFile(lockFile,'utf8'))
        if(!Number.isInteger(owner)||owner<=0)throw new Error('主题操作记录不完整，请检查 operation.lock 后重试。')
        try {process.kill(owner,0);throw new Error('主题正在处理上一次操作，请稍候再试。')} catch(error) {
          if(error.code!=='ESRCH')throw error
          await fs.unlink(lockFile);lock=await fs.open(lockFile,'wx')
        }
      }
      await lock.writeFile(String(process.pid))
    }
    const result=await run(values)
    if(values.result)await writeJson(values.result,result)
    console.log(JSON.stringify(result,null,2))
  } catch(error) {
    const result={ok:false,message:error.message}
    if(values.result)await writeJson(values.result,result)
    console.error(error.stack || error.message);process.exitCode=1
  } finally {
    if(lock){await lock.close();await fs.unlink(path.join(root,'operation.lock')).catch(()=>{})}
  }
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={parseProfile,selectTarget,run,getProcesses,prepareConnection}
