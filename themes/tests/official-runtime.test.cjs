const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {powershellJson}=require('../codex/official-runtime.cjs')
const fs=require('node:fs/promises')
const path=require('node:path')
const os=require('node:os')
const {setTimeout:delay}=require('node:timers/promises')
const {getProcesses,startPackaged}=require('../codex/theme-launcher.cjs')
const windowsOnly={skip:process.platform!=='win32'}

test('Windows PowerShell serializes null and empty pipeline results as JSON null',windowsOnly,async()=>{
  for(const source of ['$null','@()','return','@(1) | Where-Object { $_ -eq 2 }']) {
    assert.equal(await powershellJson(source),null,source)
  }
})

test('Windows PowerShell JSON preserves values and Unicode and propagates script errors',windowsOnly,async()=>{
  for(const [source,expected] of [
    ['$false',false],['0',0],["''",''],['1,2',[1,2]],
    ['[pscustomobject]@{profile=$env:CLOSURE_TEST_PROFILE;enabled=$true}',{profile:'C:\\用户\\Codex profile',enabled:true}],
  ]) {
    assert.deepEqual(await powershellJson(source,{CLOSURE_TEST_PROFILE:'C:\\用户\\Codex profile'}),expected)
  }
  await assert.rejects(powershellJson("throw '目录不可用'",{},'启动 Codex'), {message:'启动 Codex失败：目录不可用'})
})

test('process discovery returns an empty list when no Codex process matches',windowsOnly,async()=>{
  const executable=`C:\\closure-no-such-codex-${randomUUID()}.exe`
  assert.deepEqual(await getProcesses({executable}),[])
})

test('registered executable launch preserves the original home, profile and arguments on Windows',windowsOnly,async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'closure-codex-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}))
  const profile=path.join(root,'用户 配置')
  const executable=path.join(root,'主题 启动测试.exe')
  await fs.mkdir(profile)
  await powershellJson(`
    Add-Type -OutputAssembly $env:TEST_EXE -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.IO;
public class ThemeLaunchTest {
  public static void Main(string[] args) {
    File.WriteAllLines(Path.Combine(Environment.GetEnvironmentVariable("CODEX_HOME"), "args.txt"), args);
  }
}
'@
  `,{TEST_EXE:executable})
  await startPackaged({executable},profile,root,19339)
  let args
  for(let n=0;n<50&&!args;n++){
    args=await fs.readFile(path.join(root,'args.txt'),'utf8').catch(()=>null)
    if(!args)await delay(50)
  }
  assert.deepEqual(args?.trim().split(/\r?\n/),['--remote-debugging-address=127.0.0.1','--remote-debugging-port=19339','--user-data-dir='+profile])
})
