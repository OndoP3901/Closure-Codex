const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const { dispose, stylesheet, themeTarget } = require('../antigravity/theme.cjs')

const origin = 'https://127.0.0.1:12345'
const port = 45678

test('the verified Antigravity page keeps its target across conversation routes and title changes', () => {
  const target = {
    id: 'page-1',
    type: 'page',
    title: 'Antigravity',
    url: origin + '/',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/page-1`,
  }
  assert.equal(themeTarget(target, port)?.origin, origin)
  assert.equal(themeTarget({ ...target, url: origin + '/c/42', title: 'Conversation' }, port)?.origin, origin)
  assert.equal(themeTarget({ ...target, url: 'https://example.com/' }, port), null)
  assert.equal(themeTarget({ ...target, webSocketDebuggerUrl: target.webSocketDebuggerUrl + '?other' }, port), null)
})

test('the stylesheet mounts on a conversation after the shell renders, once per document', () => {
  let hasShell = false
  let style
  let pending
  const document = {
    querySelector: () => hasShell ? {} : null,
    getElementById: id => style?.id === id ? style : null,
    createElement: () => ({}),
    documentElement: {
      append(element) { style = { ...element, sheet: {} } },
    },
  }
  class MutationObserver {
    constructor(callback) { pending = callback }
    observe() {}
    disconnect() { pending = undefined }
  }
  const window = {}
  window.top = window
  const location = new URL(origin + '/c/42')
  const context = { window, location, document, MutationObserver }
  const source = stylesheet(origin, 'body { color: magenta; }')
  assert.equal(vm.runInNewContext(source, context), false)
  assert.equal(style, undefined)
  assert.equal(vm.runInNewContext(source, { ...context, location: new URL('https://example.com/') }), false)

  hasShell = true
  pending()
  const installed = style
  assert.equal(installed.textContent, 'body { color: magenta; }')
  assert.equal(pending, undefined)
  location.pathname = '/'
  assert.equal(vm.runInNewContext(source, context), true)
  assert.equal(style, installed)
})

test('the native caption is transparent while themed and restores the app colors on disable', async () => {
  const colors = []
  let style
  const document = {
    querySelector: () => ({}),
    getElementById: () => style,
    createElement: () => ({ remove() { style = undefined } }),
    documentElement: {
      append(element) { style = Object.assign(element, { sheet: {} }) },
    },
  }
  const overlay = new EventTarget()
  overlay.visible = true
  const forcedColors = new EventTarget()
  forcedColors.matches = false
  const window = {
    electronNative: { async setTitleBarOverlay(options) { colors.push({ ...options }) } },
    navigator: { windowControlsOverlay: overlay },
    matchMedia: () => forcedColors,
    getComputedStyle() {
      assert.equal(style, undefined)
      return {
        colorScheme: 'dark',
        getPropertyValue: name => name === '--sidebar' ? '#111114' : '#BCBDC6',
      }
    },
  }
  window.top = window
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = { window, location: new URL(origin), document, MutationObserver }
  const source = stylesheet(origin, 'body { color: magenta; }')
  assert.equal(vm.runInNewContext(source, context), true)
  assert.equal(vm.runInNewContext(source, context), true)
  await vm.runInNewContext(dispose, context)
  await vm.runInNewContext(dispose, context)
  assert.deepEqual(colors, [
    { color: '#00000000', symbolColor: '#eef0ff' },
    { color: '#111114', symbolColor: '#BCBDC6' },
  ])
})
