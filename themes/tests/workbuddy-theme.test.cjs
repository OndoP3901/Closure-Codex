const test=require('node:test')
const assert=require('node:assert/strict')
const path=require('node:path')
const fs=require('node:fs')
const os=require('node:os')
const {findInstall,selectTarget,run}=require('../workbuddy/lib/launcher.cjs')
const {validateEndpoint}=require('../workbuddy/lib/cdp.cjs')

test('WorkBuddy resolves the activated runtime and also supports flat installs',async t=>{
  const local=fs.mkdtempSync(path.join(os.tmpdir(),'closure-wb-install-'))
  t.after(()=>fs.rmSync(local,{recursive:true,force:true}))
  const directory=path.join(local,'Programs','WorkBuddy')
  const launcher=path.join(directory,'WorkBuddy.exe')
  const runtime=path.join(directory,'versions','5.12.1')
  const executable=path.join(runtime,'WorkBuddy-app.exe')
  const activation=path.join(directory,'activation.record')
  fs.mkdirSync(path.join(runtime,'resources'),{recursive:true})
  fs.writeFileSync(launcher,'')
  fs.writeFileSync(executable,'')
  fs.writeFileSync(path.join(runtime,'resources','app.asar'),'')
  fs.writeFileSync(activation,'WB-ACTIVATION-1\r\nignored\r\nignored\r\n5.12.1\r\n')
  assert.deepEqual(await findInstall(local,''),{
    launcher,executable,renderer:path.join(runtime,'resources','app.asar','renderer','index.html')
  })
  fs.writeFileSync(activation,'WB-ACTIVATION-1\r\nignored\r\nignored\r\n../5.12.1\r\n')
  await assert.rejects(findInstall(local,''),/未找到 WorkBuddy/)
  fs.rmSync(activation)
  fs.mkdirSync(path.join(directory,'resources'))
  fs.writeFileSync(path.join(directory,'resources','app.asar'),'')
  assert.deepEqual(await findInstall(local,''),{
    launcher,executable:launcher,renderer:path.join(directory,'resources','app.asar','renderer','index.html')
  })
})

test('theme startup selects one owning window and rejects ambiguous running profiles',()=>{
  const main={pid:1,hasWindow:true},worker={pid:2,hasWindow:false}
  assert.equal(selectTarget([worker,main]),main)
  assert.equal(selectTarget([worker]),worker)
  assert.equal(selectTarget([]),null)
  assert.throws(()=>selectTarget([worker,{pid:3,hasWindow:false}]))
  assert.throws(()=>selectTarget([main,{pid:3,hasWindow:true}]))
})
test('theme connections require the exact loopback debugger endpoint',()=>{
  const valid='ws://127.0.0.1:19368/devtools/page/native-page'
  assert.equal(validateEndpoint(valid,19368),valid)
  for(const url of ['ws://192.168.1.1:19368/devtools/page/a','ws://127.0.0.1:19369/devtools/page/a','ws://user@127.0.0.1:19368/devtools/page/a','ws://127.0.0.1:19368/other','wss://127.0.0.1:19368/devtools/page/a'])assert.throws(()=>validateEndpoint(url,19368))
})
test('WorkBuddy semantic surfaces share the established Codex palette',async()=>{
  const {TOKENS}=await import('../workbuddy/src/palette.mjs')
  const codex=JSON.parse(fs.readFileSync(path.join(__dirname,'../codex/palette/closure-dark.txt'),'utf8').slice('codex-theme-v1:'.length)).theme
  assert.equal(TOKENS['--wb-bg-primary'],codex.surface)
  assert.equal(TOKENS['--wb-text-strong'],codex.ink)
  assert.equal(TOKENS['--wb-brand-primary'],codex.accent)
  assert.equal(TOKENS['--cr-internal-text-primary'],codex.ink)
  assert.equal(TOKENS['--cr-internal-send-button-fill'],codex.accent)
})

test('restore on a fresh WorkBuddy setup does not require an installed or running application',async t=>{
  const fsp=require('node:fs/promises'),os=require('node:os')
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'closure-wb-restore-'))
  t.after(()=>fsp.rm(root,{recursive:true,force:true}))
  const result=await run({mode:'disable',root},{findInstall:async()=>{throw Error('Application discovery must not run')},getProcesses:async()=>{throw Error('Process discovery must not run')}})
  assert.equal(result.ok,true)
  assert.equal(result.message,'主题已关闭。')
})

test('WorkBuddy restore stops only the recorded helper and preserves the owning window',async t=>{
  const fsp=require('node:fs/promises'),os=require('node:os')
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'closure-wb-restore-'))
  t.after(()=>fsp.rm(root,{recursive:true,force:true}))
  const record={running:true,browser:'ws://127.0.0.1:19368/devtools/browser/a',helperPid:12}
  await fsp.writeFile(path.join(root,'session.json'),JSON.stringify(record))
  let stopped=0
  const result=await run({mode:'disable',root},{stopHelper:async value=>{assert.deepEqual(value,record);stopped++},findInstall:async()=>{throw Error('No application discovery')},getProcesses:async()=>{throw Error('No window closing')}})
  assert.equal(result.ok,true)
  assert.equal(stopped,1)
  assert.equal(JSON.parse(await fsp.readFile(path.join(root,'session.json'))).running,false)
})
