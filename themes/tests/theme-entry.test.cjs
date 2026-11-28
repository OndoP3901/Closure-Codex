const {test}=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const {parseProfile,selectTarget,run,prepareConnection}=require('../codex/theme-launcher.cjs')
const {buildPalette}=require('../codex/palette.cjs')
const fs=require('node:fs/promises')
const os=require('node:os')

test('profile parsing preserves Unicode and spaces across Windows argument forms',()=>{
  const profile='C:\\用户\\My Codex\\profile'
  for(const command of [`exe --user-data-dir="${profile}" --flag`,`exe "--user-data-dir=${profile}" --flag`])assert.equal(parseProfile(command),profile)
  assert.equal(parseProfile('exe --user-data-dir=C:\\Codex --flag'),'C:\\Codex')
  assert.equal(parseProfile('exe --unrelated-user-data-dir=C:\\Other'),null)
})
test('automatic selection keeps the ordinary account rather than a project experiment',()=>{
  const project=path.resolve('fixture-project')
  const regular={pid:10,profile:path.resolve('original-profile'),explicitProfile:false}
  const separate={pid:11,profile:path.join(project,'work','decorated-codex','profile'),explicitProfile:true}
  assert.equal(selectTarget([separate,regular],null,project),regular)
  assert.equal(selectTarget([separate],null,project),null)
  const other={pid:12,profile:path.resolve('another-profile'),explicitProfile:true}
  assert.equal(selectTarget([{...regular,explicitProfile:true},other],{profile:regular.profile},project).pid,regular.pid)
  assert.throws(()=>selectTarget([{...regular,explicitProfile:true},other],null,project),/多个/)
  assert.equal(selectTarget([{...regular,headless:true}],null,project),null)
})
test('bundled palette applies base colors, fonts and semantic colors without native import',async()=>{
  const {css}=await buildPalette()
  for(const value of ['--color-surface:#0a0b16 !important','--color-text-primary:#eef0ff !important','--color-accent:#ff3ea5 !important',
    '--diffs-addition-color-override:#35e0d0 !important','--font-ui-family:', '--font-code-family:'])assert.ok(css.includes(value),value)
  assert.ok(css.startsWith('html[data-closure-decoration="on"]'))
  assert.ok(!css.includes('localStorage')&&!css.includes('prefers-color-scheme'))
})
test('first setup without a running Codex asks the user to open it without launching anything',async()=>{
  let starts=0
  await assert.rejects(prepareConnection({api:{startPackaged:async()=>starts++},pkg:{},config:null,codexHome:'home',processes:[]}),/首次使用主题/)
  assert.equal(starts,0)
})
test('saved profile cold start launches directly with CDP, without an ordinary bootstrap or restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-direct-'))
  try {
    const profile=path.join(root,'中文 original profile');await fs.mkdir(profile)
    const calls=[],pkg={executable:'new-store-version.exe'},browser='ws://127.0.0.1:19339/devtools/browser/new'
    const connection=await prepareConnection({pkg,config:{profile},codexHome:'original-home',processes:[],api:{
      choosePort:async()=>19339,closeTarget:async()=>{throw new Error('Cold start must not close an app')},
      startPackaged:async(app,dir,home,port)=>calls.push([app.executable,dir,home,port]),waitBrowser:async()=>browser,
    }})
    assert.deepEqual(calls,[['new-store-version.exe',profile,'original-home',19339]])
    assert.equal(connection.restarted,false);assert.equal(connection.startup,'direct');assert.equal(connection.browser,browser)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('running CDP instance attaches without launching or closing any Codex process',async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-attach-'))
  try {
    const browser='ws://127.0.0.1:19339/devtools/browser/existing',calls=[]
    const connection=await prepareConnection({pkg:{executable:'official.exe'},config:{profile},codexHome:'home',processes:[{pid:42,profile,port:19339}],api:{
      verifyOwner:async(port,exe,dir)=>calls.push([port,exe,dir]),version:async()=>({webSocketDebuggerUrl:browser}),
      closeTarget:async()=>{throw new Error('No restart allowed')},startPackaged:async()=>{throw new Error('No extra app allowed')},
    }})
    assert.equal(connection.startup,'attached');assert.equal(connection.restarted,false);assert.equal(connection.started,false)
    assert.deepEqual(calls,[[19339,'official.exe',profile]])
  }finally{await fs.rm(profile,{recursive:true,force:true})}
})
test('missing saved profile is reported without substituting a fresh account directory',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-missing-'))
  try {
    await assert.rejects(prepareConnection({api:{startPackaged:async()=>{throw new Error('Must not start a fresh profile')}},pkg:{},config:{profile:path.join(root,'gone')},codexHome:'home',processes:[]}),/配置目录已不存在/)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('failed debug startup restores the exact ordinary profile',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-fallback-'))
  try {
    const profile=path.join(root,'original');await fs.mkdir(profile)
    const target={pid:123,created:'original-identity',profile,explicitProfile:false,port:null}
    const calls=[]
    let round=0
    await assert.rejects(run({mode:'enable','state-root':root},{
      findPackage:async()=>({executable:'official.exe'}),
      getProcesses:async()=> ++round===1 ? [target] : [{...target,pid:124,port:19339}],
      buildPayload:async()=>{},choosePort:async()=>19339,
      closeTarget:async(pkg,value)=>calls.push(['close',value.pid]),
      startPackaged:async(pkg,value,home,port)=>calls.push(['start',value,port]),
      waitBrowser:async()=>{throw new Error('unsupported CDP')},
    }),/unsupported CDP/)
    assert.deepEqual(calls,[['close',123],['start',profile,19339],['close',124],['start',profile,null]])
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'session.json'),'utf8')).running,false)
  } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('first menu launch remembers the observed profile when Codex stays in the tray',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-first-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const profile=path.join(root,'原有 配置')
  await fs.mkdir(profile)
  await assert.rejects(run({mode:'enable','from-menu':true,'state-root':root},{
    findPackage:async()=>({}),getProcesses:async()=>[{pid:1,profile,port:null}],
    choosePort:async()=>19339,buildPayload:async()=>{},
    closeTarget:async()=>{throw Error('请完整退出 Codex')},
  }),/请完整退出 Codex/)
  const config=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'))
  assert.equal(config.enabled,false)
  assert.equal(config.profile,profile)
  const starts=[]
  const result=await prepareConnection({config,pkg:{},codexHome:config.codexHome,processes:[],api:{
    choosePort:async()=>19339,startPackaged:async(_pkg,dir)=>starts.push(dir),
    waitBrowser:async()=>'ws://127.0.0.1:19339/devtools/browser/example'
  }})
  assert.deepEqual(starts,[profile])
  assert.equal(result.startup,'direct')
})
test('restore on a fresh or disabled setup does not inspect any installed or running Codex',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-restore-fresh-'))
  try {
    const unexpected=async()=>{throw new Error('An unconfigured restore must not discover or select an app')}
    for(const saved of [null,{enabled:false}]) {
      if(saved)await fs.writeFile(path.join(root,'config.json'),JSON.stringify(saved))
      const result=await run({mode:'disable','state-root':root},{findPackage:unexpected,getProcesses:unexpected})
      assert.equal(result.ok,true)
      assert.equal(result.message,'主题已经关闭。')
    }
  } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('restore closes only the recorded profile and leaves other Codex instances alone',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-restore-'))
  try {
    const profile=path.join(root,'original'),home=path.join(root,'codex-home')
    const record={port:19340,browser:'ws://127.0.0.1:19340/devtools/browser/identity',injectorPid:100}
    await fs.writeFile(path.join(root,'config.json'),JSON.stringify({enabled:true,profile,codexHome:home}))
    await fs.writeFile(path.join(root,'session.json'),JSON.stringify(record))
    const current={pid:10,profile,port:19340,explicitProfile:false}
    const calls=[]
    const result=await run({mode:'disable','from-menu':true,'state-root':root},{
      findPackage:async()=>({executable:'official.exe'}),getProcesses:async()=>[current,{pid:11,profile:path.join(root,'unrelated'),port:19341}],
      stopInjector:async value=>calls.push(['injector',value.injectorPid]),verifyOwner:async port=>calls.push(['verify',port]),
      stopProjectInjectors:async browser=>calls.push(['stop',browser]),closeTarget:async(pkg,value)=>calls.push(['close',value.pid]),
      startPackaged:async(pkg,value,codexHome,port)=>calls.push(['start',value,codexHome,port]),
      openStoreCodex:async()=>calls.push(['extra activation']),
    })
    assert.equal(result.ok,true)
    assert.deepEqual(calls,[['injector',100],['verify',19340],['stop',record.browser],['close',10],['start',profile,home,null]])
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8')).enabled,false)
  } finally {await fs.rm(root,{recursive:true,force:true})}
})

test('plain menu launch activates Codex once when the themed process is gone',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-codex-plain-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const pkg={family:'codex-family',appId:'App'}
  for(const [enabled,fromMenu,expected] of [[true,true,1],[false,true,1],[true,false,0]]) {
    await fs.writeFile(path.join(root,'config.json'),JSON.stringify({enabled,profile:path.join(root,'profile')}))
    const activations=[]
    await run({mode:'disable','from-menu':fromMenu,'state-root':root},{
      findPackage:async()=>pkg,getProcesses:async()=>[],stopInjector:async()=>{},
      openStoreCodex:async value=>activations.push(value),
      startPackaged:async()=>assert.fail('No themed process to restart'),
    })
    assert.deepEqual(activations,expected?[pkg]:[])
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8')).enabled,false)
  }
})
