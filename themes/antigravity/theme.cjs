const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { connect, evaluate } = require('../workbuddy/lib/cdp.cjs')
const { powershellJson } = require('../workbuddy/lib/windows.cjs')

const root = path.join(process.env.LOCALAPPDATA, 'ClosureAntigravityTheme')
const sessionFile = path.join(root, 'session.json')
const activePort = path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort')
const executable = path.resolve(process.env.CLOSURE_ANTIGRAVITY_EXE ||
  path.join(process.env.LOCALAPPDATA, 'Programs/Antigravity/Antigravity.exe'))
const server = path.join(path.dirname(executable), 'resources/bin/language_server.exe')
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null)
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

async function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value))
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function getJson(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    redirect: 'error', signal: AbortSignal.timeout(1800),
  })
  if (!response.ok) throw new Error('Antigravity debug target unavailable.')
  return response.json()
}

function ownsPort(port, image, pid) {
  return powershellJson(`
    $listeners = @(Get-NetTCPConnection -LocalPort $env:CLOSURE_AGY_PORT -State Listen -ErrorAction SilentlyContinue)
    $matching = @($listeners | Where-Object {
      $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      $_.LocalAddress -eq '127.0.0.1' -and $process.Path -eq $env:CLOSURE_AGY_IMAGE -and
        (!$env:CLOSURE_AGY_PID -or $_.OwningProcess -eq $env:CLOSURE_AGY_PID)
    })
    [bool]($matching.Count -and $matching.Count -eq $listeners.Count)
  `, { CLOSURE_AGY_PORT: String(port), CLOSURE_AGY_IMAGE: image, CLOSURE_AGY_PID: String(pid || '') })
}

async function browserFor(pid) {
  const [portText, browserPath] = (await fs.readFile(activePort, 'utf8')).trim().split(/\r?\n/)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
      !/^\/devtools\/browser\/[\w-]+$/.test(browserPath) || !await ownsPort(port, executable, pid)) {
    throw new Error('Could not identify the Antigravity debug listener.')
  }
  const browser = `ws://127.0.0.1:${port}${browserPath}`
  if ((await getJson(port, '/json/version')).webSocketDebuggerUrl !== browser) {
    throw new Error('Antigravity debug session changed.')
  }
  return { pid, port, browser }
}

async function launch(command, args, { stdio = 'ignore', visible = false } = {}) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  const child = spawn(command, args, { stdio, env, detached: true, windowsHide: !visible })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref()
  return child.pid
}

async function startHost() {
  await fs.access(executable)
  const running = await powershellJson(`
    [bool](Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:CLOSURE_AGY_IMAGE })
  `, { CLOSURE_AGY_IMAGE: executable })
  if (running) throw new Error('请保存工作、退出 Antigravity，再重新打开主题入口。')
  const pid = await launch(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { visible: true })
  for (let attempt = 0; attempt < 60 && alive(pid); attempt++) {
    try { return await browserFor(pid) } catch { await delay(300) }
  }
  throw new Error('Antigravity 没有打开主题连接。请退出 Antigravity 后重试。')
}

const styleId = 'closure-antigravity-theme'
const shellSelector = '.agy-shell, .agy-inset-shell'
const mounted = `Boolean(document.getElementById(${JSON.stringify(styleId)})?.sheet)`
const needsMount = `Boolean(document.querySelector(${JSON.stringify(shellSelector)})) && !${mounted}`
const dispose = `(async () => {
  window.__closureAntigravityThemeObserver?.disconnect?.();
  window.__closureAntigravityThemeObserver?.abort?.();
  delete window.__closureAntigravityThemeObserver;
  document.getElementById(${JSON.stringify(styleId)})?.remove();
  const restoreCaption = window.__closureAntigravityCaption;
  delete window.__closureAntigravityCaption;
  await restoreCaption?.();
  return true;
})()`

function mountCaption() {
  const native = window.electronNative
  const overlay = window.navigator?.windowControlsOverlay
  if (typeof native?.setTitleBarOverlay !== 'function' || native.customWindowControls || !overlay) return

  const root = document.documentElement
  const forcedColors = window.matchMedia('(forced-colors: active)')
  let frame = null
  let transparent = false
  let visible = overlay.visible
  const apply = options => Promise.resolve(native.setTitleBarOverlay(options)).catch(() => {})

  function restore() {
    if (!transparent) return
    transparent = false
    // Antigravity derives its native caption colors from these same page tokens.
    const style = window.getComputedStyle(root)
    const dark = style.colorScheme.includes('dark')
    return apply({
      color: style.getPropertyValue('--sidebar').trim() || (dark ? '#131313' : '#ffffff'),
      symbolColor: style.getPropertyValue('--secondary-foreground').trim() || (dark ? '#fafafa' : '#000000'),
    })
  }

  function sync() {
    frame = null
    if (forcedColors.matches) return restore()
    if (!overlay.visible) return
    transparent = true
    return apply({ color: '#00000000', symbolColor: '#eef0ff' })
  }

  function schedule() {
    if (frame === null) frame = window.requestAnimationFrame(sync)
  }

  function geometryChanged() {
    if (visible === overlay.visible) return
    visible = overlay.visible
    schedule()
  }

  const observer = new MutationObserver(schedule)
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
  overlay.addEventListener('geometrychange', geometryChanged)
  forcedColors.addEventListener('change', schedule)
  sync()
  return () => {
    observer.disconnect()
    overlay.removeEventListener('geometrychange', geometryChanged)
    forcedColors.removeEventListener('change', schedule)
    if (frame !== null) window.cancelAnimationFrame(frame)
    return restore()
  }
}

function stylesheet(origin, css) {
  return `(() => {
    if (window !== window.top || location.origin !== ${JSON.stringify(origin)}) return false;
    const id = ${JSON.stringify(styleId)};
    function mount() {
      if (!document.querySelector(${JSON.stringify(shellSelector)})) return false;
      if (!document.getElementById(id)) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = ${JSON.stringify(css)};
        document.documentElement.append(style);
      }
      window.__closureAntigravityThemeObserver?.disconnect?.();
      delete window.__closureAntigravityThemeObserver;
      if (!window.__closureAntigravityCaption && ${mounted}) {
        window.__closureAntigravityCaption = (${mountCaption.toString()})();
      }
      return ${mounted};
    }
    if (mount()) return true;
    if (!window.__closureAntigravityThemeObserver) {
      const observer = new MutationObserver(mount);
      observer.observe(document, { childList: true, subtree: true });
      window.__closureAntigravityThemeObserver = observer;
    }
    return false;
  })()`
}

function themeTarget(target, port) {
  if (target.type !== 'page' || typeof target.id !== 'string' || !/^[\w-]+$/.test(target.id) ||
      target.webSocketDebuggerUrl !== `ws://127.0.0.1:${port}/devtools/page/${target.id}`) return null
  const page = URL.parse(target.url)
  if (!page || !['https:', 'http:'].includes(page.protocol) || page.hostname !== '127.0.0.1' ||
      page.username || page.password || !page.port) return null
  return { ...target, origin: page.origin, pagePort: Number(page.port) }
}

async function targets(port) {
  return (await getJson(port, '/json/list')).map(target => themeTarget(target, port)).filter(Boolean)
}

async function trustedTarget(target, pid) {
  return await ownsPort(target.pagePort, server) || await ownsPort(target.pagePort, executable, pid)
}

async function release(entry) {
  if (!entry.client.closed) {
    if (entry.script) await entry.client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.script }).catch(() => {})
    await evaluate(entry.client, dispose).catch(() => {})
  }
  entry.client.close()
}

function files(id) {
  return { stop: path.join(root, `${id}.stop`), ready: path.join(root, `${id}.ready`) }
}

async function worker(id) {
  const session = await readJson(sessionFile)
  if (session?.id !== id || (await browserFor(session.pid)).browser !== session.browser) return
  const { stop, ready } = files(id)
  const css = await fs.readFile(path.join(__dirname, 'theme.css'), 'utf8')
  const anchor = await connect(session.browser, session.port)
  const entries = new Map()
  try {
    while (!anchor.closed && !await fs.stat(stop).then(() => true, () => false)) {
      const pages = await targets(session.port).catch(() => null)
      if (pages === null) {
        await delay(650)
        continue
      }
      const current = new Map(pages.map(page => [page.id, page]))
      for (const [key, entry] of entries) {
        if (entry.client.closed || current.get(key)?.origin !== entry.origin) {
          await release(entry)
          entries.delete(key)
        }
      }
      for (const target of pages) {
        if (entries.has(target.id)) {
          const running = entries.get(target.id)
          if (await evaluate(running.client, needsMount).catch(() => false)) {
            await evaluate(running.client, running.source).catch(() => false)
          }
          if (!running.ready && await evaluate(running.client, mounted).catch(() => false)) {
            running.ready = true
            await fs.writeFile(ready, '')
          }
          continue
        }
        if (!await trustedTarget(target, session.pid)) continue
        const client = await connect(target.webSocketDebuggerUrl, session.port).catch(() => null)
        if (!client) continue
        const entry = { client, origin: target.origin, source: stylesheet(target.origin, css) }
        try {
          await client.send('Page.enable')
          const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: entry.source })
          entry.script = installed.identifier
          entries.set(target.id, entry)
          entry.ready = await evaluate(client, entry.source).catch(() => false) === true
          if (entry.ready) await fs.writeFile(ready, '')
        } catch (error) {
          console.error(error.message)
          await release(entry)
        }
      }
      await delay(650)
    }
  } finally {
    await Promise.all([...entries.values()].map(release))
    anchor.close()
    await fs.rm(ready, { force: true })
    await fs.rm(stop, { force: true })
  }
}

async function disable(session) {
  if (!session) return
  if (alive(session.helper)) {
    await fs.writeFile(files(session.id).stop, '')
    for (let attempt = 0; attempt < 48 && alive(session.helper); attempt++) await delay(250)
    if (alive(session.helper)) throw new Error('主题仍在恢复，请稍候重试。')
  }
  const host = await browserFor(session.pid).catch(() => null)
  if (host?.browser === session.browser) {
    for (const target of await targets(host.port)) {
      if (!await trustedTarget(target, host.pid)) continue
      const client = await connect(target.webSocketDebuggerUrl, host.port)
      try { await evaluate(client, dispose) } finally { client.close() }
    }
  }
  await fs.rm(files(session.id).stop, { force: true })
  await fs.rm(files(session.id).ready, { force: true })
}

async function main(mode, id) {
  if (mode === 'worker') return worker(id)
  if (!['enable', 'disable', 'link'].includes(mode)) throw new Error('Invalid theme mode.')
  if (typeof WebSocket !== 'function') throw new Error('Install Node.js 22 or later.')
  await fs.mkdir(root, { recursive: true })
  const lockFile = path.join(root, 'operation.lock')
  let lock
  try {
    try { lock = await fs.open(lockFile, 'wx') } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const prior = Number(await fs.readFile(lockFile, 'utf8'))
      if (!prior || alive(prior)) throw new Error('主题正在处理中，请稍候重试。')
      await fs.unlink(lockFile)
      lock = await fs.open(lockFile, 'wx')
    }
    await lock.writeFile(String(process.pid))
    const previous = await readJson(sessionFile)
    if (mode === 'disable') {
      await disable(previous)
      if (previous) await writeJson(sessionFile, { ...previous, helper: null })
      console.log('主题已恢复。退出 Antigravity 后调试端口随之关闭。')
      return
    }
    const existing = previous && await browserFor(previous.pid).catch(() => null)
    if (existing?.browser === previous?.browser && alive(previous?.helper)) await disable(previous)
    const host = (existing?.browser === previous?.browser && existing)
      || await browserFor().catch(() => null)
      || await startHost()
    if (mode === 'link') {
      if (previous) await writeJson(sessionFile, { ...previous, helper: null })
      console.log('Antigravity 联动已就绪。')
      return
    }
    const session = { ...host, id: randomUUID() }
    await writeJson(sessionFile, session)
    const log = await fs.open(path.join(root, 'helper.log'), 'a')
    try { session.helper = await launch(process.execPath, [__filename, 'worker', session.id], { stdio: ['ignore', log.fd, log.fd] }) }
    finally { await log.close() }
    await writeJson(sessionFile, session)
    for (let attempt = 0; attempt < 60 && alive(session.helper); attempt++) {
      if (await fs.stat(files(session.id).ready).then(() => true, () => false)) {
        console.log('Antigravity 深色主题已启用。')
        return
      }
      await delay(250)
    }
    if (!alive(session.helper)) throw new Error('主题助手已退出，请查看 helper.log。')
    console.log('主题助手已启动，主界面加载后会应用主题。')
  } finally {
    if (lock) { await lock.close(); await fs.rm(lockFile, { force: true }) }
  }
}

if (require.main === module) {
  main(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}

module.exports = { dispose, stylesheet, themeTarget }
