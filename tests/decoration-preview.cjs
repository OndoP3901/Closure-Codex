// Run with the bundled Electron, not Node. All windows remain hidden and offscreen.
const { app, BrowserWindow, session } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'work', 'decoration-preview')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  await mkdir(output, { recursive: true })
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['file:', 'data:'].includes(new URL(details.url).protocol) })
  })
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, focusable: false, skipTaskbar: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const errors = []
  win.webContents.on('console-message', (...args) => {
    const details = typeof args[1] === 'number' ? { level: args[1], message: args[2] } : args[0]
    if (details.level === 'error' || details.level === 3) errors.push(details.message)
  })
  await win.loadFile(path.join(root, 'tools', 'decoration-preview', 'preview.html'))
  await delay(200)
  const samples = []
  for (const [width, height] of [[1280, 900], [720, 600]]) {
    win.setSize(width, height)
    await delay(100)
    const sample = await win.webContents.executeJavaScript(`(() => {
      const control = window.closureDecorationPreview
      const titlebar = document.querySelector('#titlebar')
      const workspace = document.querySelector('#workspace')
      const metrics = () => [titlebar,workspace,document.querySelector('.composer')].map((element) => {
        const r = element.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]
      })
      const before = metrics()
      const onBackground = getComputedStyle(titlebar).backgroundImage
      const workspaceBackground = getComputedStyle(workspace).backgroundImage
      control.setEnabled(false)
      const offBackground = getComputedStyle(titlebar).backgroundImage
      const layoutUnchanged = JSON.stringify(metrics()) === JSON.stringify(before)
      control.setEnabled(true)
      const button = document.querySelector('.toolbar button')
      const rect = button.getBoundingClientRect()
      const input = document.querySelector('[contenteditable]')
      const inputRect = input.getBoundingClientRect()
      return { appearance:document.documentElement.dataset.theme, titleHeight:before[0][3],
        onBackground, offBackground, workspaceBackground, layoutUnchanged,
        buttonReceivesInput:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2) === button,
        composerReceivesInput:document.elementFromPoint(inputRect.x+10,inputRect.y+10) === input,
        pageDecorationNodes:document.querySelectorAll('[class*="closure-decoration-"]').length,
        documentWidth:innerWidth, contentWidth:document.documentElement.scrollWidth }
    })()`)
    assert.equal(sample.appearance, 'dark')
    assert.equal(sample.titleHeight, 36)
    assert.ok(sample.onBackground.includes('repeating-linear-gradient'))
    assert.ok(sample.workspaceBackground.includes('radial-gradient'))
    assert.equal(sample.offBackground, 'none')
    assert.equal(sample.layoutUnchanged, true)
    assert.equal(sample.buttonReceivesInput, true)
    assert.equal(sample.composerReceivesInput, true)
    assert.equal(sample.pageDecorationNodes, 3)
    assert.ok(sample.contentWidth <= sample.documentWidth)
    assert.equal(win.isVisible(), false)
    const filename = `dark-${width}x${height}.png`
    await writeFile(path.join(output, filename), (await win.webContents.capturePage()).toPNG())
    samples.push({ filename, ...sample })
  }
  const lifecycle = await win.webContents.executeJavaScript(`(async () => {
    const { mountDecoration } = await import('../../outputs/closure-decoration/decoration.mjs')
    const options = { titlebar:document.querySelector('#titlebar'), workspace:document.querySelector('#workspace'), sidebar:document.querySelector('#sidebar') }
    window.closureDecorationPreview.dispose()
    const baseline = document.documentElement.outerHTML
    let invalidRejected = false
    try { mountDecoration({ ...options, titlebar:null }) } catch { invalidRejected = true }
    const invalidPreserved = document.documentElement.outerHTML === baseline
    const first = mountDecoration(options)
    const second = mountDecoration(options)
    first.dispose()
    const duplicateSafe = document.documentElement.getAttribute('data-closure-decoration') === 'on'
    const darkOnly = typeof second.setAppearance === 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--closure-line').trim() === '#ff3ea5'
    second.dispose()
    second.dispose()
    return { invalidRejected,invalidPreserved,duplicateSafe,darkOnly,fullyRestored:document.documentElement.outerHTML === baseline }
  })()`)
  assert.ok(Object.values(lifecycle).every(Boolean), JSON.stringify(lifecycle))
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed:true, scope:'Isolated layout fixture, not the live Codex client', samples, lifecycle, errors },null,2))
  console.log(JSON.stringify({ passed:true,samples:samples.length,lifecycle,errors }))
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })
setTimeout(() => app.exit(2),30000).unref()
