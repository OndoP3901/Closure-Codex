const fs = require('node:fs/promises')
const { connect,evaluate } = require('./cdp.cjs')
const { buildPayload } = require('./renderer-payload.cjs')
const { parseArgs } = require('node:util')
const { values } = parseArgs({options:{port:{type:'string'},browser:{type:'string'},state:{type:'string'},control:{type:'string'}}})
const port=Number(values.port)
if(!Number.isInteger(port)||port<1024||port>65535||!values.browser||!values.state)throw new Error('Validated port, browser endpoint and state path required')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const sessions=new Map()
let anchor
async function release(entry) {
  const {client,scriptId}=entry
  if(!client.closed) {
    if(scriptId)await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId}).catch(()=>{})
    await evaluate(client,'window.__closurePageDecoration?.dispose()').catch(()=>{})
  }
  client.close()
}
async function writeState(value) {
  const temporary=values.state+'.tmp'
  await fs.writeFile(temporary,JSON.stringify(value,null,2))
  await fs.rename(temporary,values.state)
}

async function main() {
  anchor=await connect(values.browser,port)
  await writeState({running:true,port,injectorPid:process.pid,targets:[]})
  while(!anchor.closed) {
    try {
      if(values.control) {
        const request=await fs.readFile(values.control,'utf8').then(JSON.parse).catch(()=>null)
        if(request?.stop === values.browser)break
      }
      const payload=await buildPayload()
      const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(3000)})
      if(anchor.closed)break
      const targets=(await response.json()).filter(target=>target.type==='page' && /^app:\/\/-\/index\.html(?:[?#]|$)/.test(target.url))
      const current=new Set(targets.map(target=>target.id))
      for(const [id,entry] of sessions)if(!current.has(id)||entry.client.closed){await release(entry);sessions.delete(id)}
      const statuses=[]
      for(const target of targets) {
        let entry=sessions.get(target.id)
        try {
          if(!entry) {
            const client=await connect(target.webSocketDebuggerUrl,port)
            if(anchor.closed){client.close();break}
            entry={client}
            sessions.set(target.id,entry)
            await client.send('Page.enable')
          }
          if(entry.payload !== payload) {
            const {identifier}=await entry.client.send('Page.addScriptToEvaluateOnNewDocument',{source:payload})
            if(entry.scriptId)await entry.client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:entry.scriptId})
            entry.scriptId=identifier
            entry.payload=payload
          }
          statuses.push({id:target.id,...await evaluate(entry.client,payload)})
        } catch(error) {
          if(entry)await release(entry)
          sessions.delete(target.id)
          statuses.push({id:target.id,error:error.message})
        }
      }
      await writeState({running:true,port,injectorPid:process.pid,targets:statuses})
    } catch(error) {if(!anchor.closed)console.error(error.message)}
    await delay(1500)
  }
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  for(const entry of sessions.values())await release(entry)
  anchor?.close()
  await writeState({running:false,port,injectorPid:process.pid}).catch(()=>{})
})
