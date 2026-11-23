const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.join(__dirname, '../outputs/closure-companion/main.cjs'), 'utf8')
const followCodex = source.slice(source.indexOf('function followCodex('), source.indexOf('function registerInput('))
const tracker = new EventEmitter()
const lines = new EventEmitter()
const screen = new EventEmitter()
const win = new EventEmitter()
let visible = false
let bounds
let quit = 0
let scale = 1
let trackerStopped = false
let topmost = false
tracker.stderr = new EventEmitter()
tracker.kill = () => { trackerStopped = true }
lines.close = () => {}
screen.screenToDipRect = (_window, rect) => ({
  x: rect.x, y: rect.y, width: rect.width / scale, height: rect.height / scale,
})
Object.assign(win, {
  getNativeWindowHandle: () => Buffer.alloc(8),
  isDestroyed: () => false,
  isVisible: () => visible,
  showInactive: () => { visible = true },
  hide: () => { visible = false },
  setBounds: (rect) => { bounds = rect },
  setAlwaysOnTop: (enabled) => { topmost = enabled },
  getBounds: () => bounds,
  loadURL: async () => {},
})
const display = { id: 1, workArea: { x: 12, y: 20, width: 1000, height: 750 } }
Object.assign(screen, {
  getAllDisplays: () => [display], getPrimaryDisplay: () => display,
  getDisplayMatching: () => display, getDisplayNearestPoint: () => display,
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
})
class Tray {
  setToolTip() {}
  setContextMenu() {}
  destroy() {}
}
const petWindow = vm.runInNewContext(`${followCodex}\nmanagePetWindow(win)`, {
  win, screen, path, __dirname, process, console, noTray: true, Tray, canvas: false,
  URLSearchParams, origin: 'closure-pet://local', Menu: { buildFromTemplate() {} },
  spawn: () => tracker, readline: { createInterface: () => lines }, app: { quit: () => { quit++ } },
})
async function checkWindow() {
  await petWindow.show('codex')
  const report = (state) => lines.emit('line', JSON.stringify(state))
  const main = { visible: true, x: 0, y: 0, width: 1200, height: 800 }
  report(main)
  assert.equal(visible, true)
  assert.equal(bounds.width, 1200)
  for (const transition of ['picker', 'minimize']) {
    report({ visible: false })
    assert.equal(visible, false, transition)
    report(main)
    assert.equal(visible, true, transition)
  }
  scale = 1.5
  report({ ...main, x: -1600 })
  assert.equal(bounds.x, -1600)
  assert.equal(bounds.width, 800)
  scale = 2
  screen.emit('display-metrics-changed')
  assert.equal(bounds.width, 600)
  await petWindow.show('standalone')
  assert.equal(trackerStopped, true)
  assert.equal(visible, true)
  assert.deepEqual(bounds, display.workArea)
  petWindow.setFullscreen(true)
  assert.equal(visible, false)
  assert.equal(topmost, false)
  petWindow.setFullscreen(false)
  assert.equal(visible, true)
  assert.equal(topmost, true)
  petWindow.setAlwaysOnTop(false)
  assert.equal(topmost, false)
  petWindow.setFullscreen(true)
  petWindow.setFullscreen(false)
  assert.equal(topmost, false)
  petWindow.setAlwaysOnTop(true)
  assert.equal(topmost, true)
  report({ visible: false })
  tracker.emit('close')
  assert.equal(visible, true)
  assert.equal(quit, 0)
  await petWindow.show('codex')
  assert.equal(visible, false)
  report(main)
  assert.equal(visible, true)
  tracker.emit('close')
  assert.equal(visible, false)
  assert.equal(quit, 1)
  win.emit('closed')
  assert.equal(trackerStopped, true)
  assert.equal(screen.listenerCount('display-metrics-changed'), 0)
  console.log('Window following, DPI conversion, standalone switching, and tracker failure passed.')
}
require('node:test').test('desktop pet window switches modes', checkWindow)
