// dsh-closure-pet — 悬浮锁定按钮
//
// 放在 host 内部，随桌宠位置和尺寸一起移动。悬停桌宠矩形范围时显示，
// 点击后写入 settings.dragLock；按钮自身不参与桌宠拖拽。

export function createHoverLock(deps) {
  var host = deps.host
  var settings = deps.settings
  var saveSettings = deps.saveSettings
  var panelIsOpen = deps.panelIsOpen || function () { return false }
  var isDragging = deps.isDragging || function () { return false }
  var onLockChange = deps.onLockChange || function () {}

  var button = document.createElement('button')
  button.type = 'button'
  button.dataset.closureUi = 'lock'
  button.style.cssText = [
    'position:absolute', 'right:6px', 'top:6px', 'width:28px', 'height:28px', 'padding:0',
    'display:flex', 'align-items:center', 'justify-content:center',
    'box-sizing:border-box', 'border-radius:8px', 'cursor:pointer',
    'border:1px solid rgba(255,255,255,.22)', 'background:rgba(26,28,36,.94)',
    'color:#e7eaf3', 'box-shadow:0 4px 12px rgba(0,0,0,.35)',
    'opacity:0', 'pointer-events:none', 'z-index:2',
    'transition:opacity .15s ease,background .15s ease,color .15s ease,border-color .15s ease',
  ].join(';')
  button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="5" y="10" width="14" height="10" rx="2.5"></rect>' +
    '<path data-lock-shackle d="M8 10V7a4 4 0 0 1 8 0v3"></path>' +
    '<circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"></circle>' +
    '</svg>'
  var shackle = button.querySelector('[data-lock-shackle]')
  var shown = false

  function sync() {
    var locked = !!settings.dragLock
    button.setAttribute('aria-pressed', locked ? 'true' : 'false')
    button.setAttribute('aria-label', locked ? '解锁桌宠拖动' : '锁定桌宠拖动')
    button.title = locked ? '解锁拖动' : '锁定拖动'
    button.style.background = locked ? 'rgba(255,176,80,.95)' : 'rgba(26,28,36,.94)'
    button.style.color = locked ? '#231a08' : '#e7eaf3'
    button.style.borderColor = locked ? 'rgba(255,210,140,.9)' : 'rgba(255,255,255,.22)'
    shackle.setAttribute('d', locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 7.2-1.7')
  }

  function setShown(next) {
    if (next === shown) return
    shown = next
    if (next) sync()
    button.style.opacity = next ? '1' : '0'
    button.style.pointerEvents = next ? 'auto' : 'none'
  }

  function update(x, y) {
    var rect = host.getBoundingClientRect()
    var inside = x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4
    setShown(inside && settings.showHoverLock !== false && !panelIsOpen() && !isDragging())
  }

  function contains(target) {
    return target === button || button.contains(target)
  }

  button.addEventListener('click', function (event) {
    event.preventDefault()
    event.stopPropagation()
    settings.dragLock = !settings.dragLock
    sync()
    saveSettings(true)
    onLockChange()
  })
  host.appendChild(button)
  sync()

  return { update: update, contains: contains, sync: sync }
}
