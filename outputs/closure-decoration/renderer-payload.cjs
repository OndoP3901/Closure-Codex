const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { buildPalette } = require('./palette.cjs')

async function buildPayload() {
  const [decorationCss, module, source, palette] = await Promise.all([
    fs.readFile(path.join(__dirname, 'decoration.css'), 'utf8'),
    fs.readFile(path.join(__dirname, 'decoration.mjs'), 'utf8'),
    fs.readFile(__filename, 'utf8'),
    buildPalette(),
  ])
  const css = palette.css + '\n' + decorationCss
  const revision = createHash('sha256').update(css).update(module).update(source).digest('hex').slice(0,16)
  return `(() => {
    if (location.protocol !== 'app:' || location.hostname !== '-') return null
    function install() {
    const KEY = '__closurePageDecoration'
    const revision = ${JSON.stringify(revision)}
    if (window[KEY]?.revision === revision) return window[KEY].snapshot()
    window[KEY]?.dispose()
    ${module.replace('export function mountDecoration', 'function mountDecoration')}
    const style = document.createElement('style')
    style.id = 'closure-page-decoration-style'
    style.textContent = ${JSON.stringify(css)}
    ;(document.head || document.documentElement).appendChild(style)
    const priorPending = document.documentElement.getAttribute('data-closure-pending')
    let controller, elements, queued = false, disposed = false
    const active = (node) => !node.closest('[data-app-shell-active-page="false"]')
    function menuBar() {
      const trigger = [...document.querySelectorAll('[id^="application-menu-trigger-"]')].find(node => active(node) && node.getClientRects().length)
      const frame = trigger?.closest('[data-app-shell-frame]')
      if (!frame) return null
      let bar = trigger.parentElement
      while (bar && bar.parentElement !== frame) bar = bar.parentElement
      // The menu row is a direct frame child; the frame also includes the tabs and main surface.
      return bar && bar !== frame && !bar.querySelector('main') ? bar : null
    }
    function locate() {
      const menu = menuBar()
      const titlebar = menu || (document.documentElement.getAttribute('data-codex-window-chrome') === 'application-menu' ? null :
        [...document.querySelectorAll('header[data-app-shell-titlebar],header[data-app-shell-header-edge-scroll],header.app-header-tint')].find(active))
      const workspace = [...document.querySelectorAll('main[data-app-shell-main-surface],main.main-surface,[data-settings-panel]')].find(active)
      const sidebar = [...document.querySelectorAll('.app-shell-left-panel')].find(active)
      return [titlebar || null,workspace || null,sidebar || null]
    }
    function refresh() {
      queued = false
      if (disposed) return
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style)
      const next = locate()
      if (!controller && next[0]) controller = mountDecoration({ document,titlebar:next[0],workspace:next[1],sidebar:next[2] })
      const missingClass = elements?.some((element,index) => element && !element.classList.contains(
        ['closure-decoration-titlebar','closure-decoration-workspace','closure-decoration-sidebar'][index]))
      if (!elements || missingClass || next.some((element,index) => element !== elements[index])) {
        controller?.setElements({ titlebar:next[0],workspace:next[1],sidebar:next[2] })
        elements = next
      }
      document.documentElement.removeAttribute('data-closure-pending')
      if (controller && document.documentElement.getAttribute('data-closure-decoration') === 'on' && document.documentElement.getAttribute('data-theme') !== 'dark') controller.setEnabled(true)
    }
    const observer = new MutationObserver((records) => {
      if (disposed || queued || !records.some((record) => record.type === 'childList' || record.attributeName === 'data-app-shell-active-page' || record.attributeName === 'data-theme' ||
        (record.attributeName === 'class' && elements?.includes(record.target)))) return
      queued = true
      queueMicrotask(refresh)
    })
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-app-shell-active-page','class','data-theme']})
    const state = {
      revision,
      snapshot:() => ({ revision,installed:style.isConnected,shellReady:!!(controller && elements?.[0]),
        parts:elements ? { titlebar:!!elements[0],workspace:!!elements[1],sidebar:!!elements[2] } : null }),
      dispose() {
        if (disposed) return
        disposed = true; observer.disconnect(); controller?.dispose(); style.remove()
        if (priorPending === null) document.documentElement.removeAttribute('data-closure-pending')
        else document.documentElement.setAttribute('data-closure-pending',priorPending)
        if (window[KEY] === state) delete window[KEY]
      },
    }
    window[KEY] = state
    refresh()
    return state.snapshot()
    }
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded',install,{once:true})
      return {installed:false,shellReady:false,waitingForDocument:true}
    }
    return install()
  })()`
}

module.exports = { buildPayload }
