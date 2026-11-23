// Actual official runtime lifecycle, with every application launch forced headless into a fresh temp profile.
const fs=require('node:fs/promises')
const path=require('node:path')
const os=require('node:os')
const assert=require('node:assert/strict')
const {spawn}=require('node:child_process')
const packageRoot=process.env.CLOSURE_TEST_PACKAGE_ROOT || path.resolve(__dirname,'..')
const {run,getProcesses}=require(path.join(packageRoot,'outputs/closure-decoration/theme-launcher.cjs'))
const {findPackage,verifyOwner,terminateOwners}=require(path.join(packageRoot,'outputs/closure-decoration/official-runtime.cjs'))
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-theme-official-'))
 const profile=path.join(root,'original profile'),home=path.join(root,'codex-home'),stateRoot=path.join(root,'state')
 const pkg=await findPackage(), launched=[]
 const output=process.env.CLOSURE_TEST_OUTPUT || path.resolve(__dirname,'../work/theme-entry-official')
 await fs.mkdir(home,{recursive:true});await fs.mkdir(stateRoot);await fs.mkdir(output,{recursive:true})
 const oldHome=process.env.CODEX_HOME;process.env.CODEX_HOME=home
 const report={passed:false,scope:'Real official runtime in isolated headless profile; no access to user app UI',packageVersion:pkg.version}
 const services={
  getProcesses:async pkg=>(await getProcesses(pkg)).filter(item=>item.profile?.toLowerCase()===profile.toLowerCase()).map(item=>({...item,headless:false})),
  startPackaged:async(pkg,requested,requestedHome,port)=>{
   assert.ok(!requested || requested===profile);assert.equal(requestedHome,home)
   const env={...process.env,CODEX_ELECTRON_USER_DATA_PATH:profile,CODEX_ELECTRON_START_IN_BACKGROUND:'1',CODEX_HOME:home}
   delete env.ELECTRON_RUN_AS_NODE
   const args=[`--user-data-dir=${profile}`,'--headless=new','--no-startup-window']
   if(port)args.push('--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`)
   const log=await fs.open(path.join(output,'official.stderr.log'),'a')
   try{
    const child=spawn(pkg.executable,args,{env,windowsHide:true,stdio:['ignore','ignore',log.fd]})
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
    launched.push(child);child.unref()
   }finally{await log.close()}
  },
 }
 let session
 try{
  // First setup requires a running original instance. It must not open a throwaway ordinary app.
  const options={mode:'enable','state-root':stateRoot,'no-shortcuts':true}
  await assert.rejects(run(options,services),/首次使用主题/)
  assert.equal(launched.length,0)
  await services.startPackaged(pkg,profile,home,null)
  for(let n=0;n<40;n++) {
   if((await services.getProcesses(pkg)).some(item=>item.profile===profile))break
   await delay(250)
  }
  const first=await run(options,services)
  assert.equal(first.ok,true);assert.equal(first.restarted,true);assert.equal(first.profile,profile)
  assert.equal(first.startup,'restarted')
  session=JSON.parse(await fs.readFile(path.join(stateRoot,'session.json'),'utf8'))
  const owners=await verifyOwner(session.port,pkg.executable,profile)
  const firstPid=owners[0].pid
  const repeat=await run(options,services)
  assert.equal(repeat.ok,true);assert.equal(repeat.restarted,false)
  session=JSON.parse(await fs.readFile(path.join(stateRoot,'session.json'),'utf8'))
  assert.equal((await verifyOwner(session.port,pkg.executable,profile))[0].pid,firstPid)
  // Simulate a user fully exiting Codex. Next use must start it exactly once, already with CDP.
  await terminateOwners(await verifyOwner(session.port,pkg.executable,profile),pkg.executable,profile)
  for(let n=0;n<20;n++) {
   if(!(await services.getProcesses(pkg)).length)break
   await delay(250)
  }
  const launchCount=launched.length
  const cold=await run(options,services)
  assert.equal(cold.ok,true);assert.equal(cold.restarted,false);assert.equal(cold.startup,'direct')
  assert.equal(launched.length,launchCount+1)
  session=JSON.parse(await fs.readFile(path.join(stateRoot,'session.json'),'utf8'))
  const coldPid=(await verifyOwner(session.port,pkg.executable,profile))[0].pid
  assert.notEqual(coldPid,firstPid)
  assert.equal(session.restarted,false)
  const restored=await run({...options,mode:'disable'},services)
  assert.equal(restored.ok,true)
  const remaining=await services.getProcesses(pkg)
  assert.equal(remaining.length,1);assert.equal(remaining[0].port,null)
  assert.notEqual(remaining[0].pid,coldPid)
  const listenersClosed=await fetch(`http://127.0.0.1:${session.port}/json/version`,{signal:AbortSignal.timeout(1000)}).then(()=>false,()=>true)
  assert.equal(listenersClosed,true)
  report.passed=true
  report.checks=['first setup without Codex launches nothing','profile with spaces preserved','first ordinary instance restarts once','actual page injection','repeated enable without restart','saved profile cold start launches once with CDP','graceful injector cleanup','restore original profile','debugging port closed']
  report.coldStart={launchCount:1,restarted:cold.restarted,startup:cold.startup}
  console.log(JSON.stringify(report,null,2))
 }finally{
  if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome
  if(session) {
   const owners=await verifyOwner(session.port,pkg.executable,profile).catch(()=>[])
   if(owners.length)await terminateOwners(owners,pkg.executable,profile)
  }
  for(const child of launched)if(child.exitCode===null)child.kill()
  await delay(400)
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2))
 }
}
main().catch(error=>{console.error(error);process.exitCode=1})
