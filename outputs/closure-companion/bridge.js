let interactive = false

window.closureCompanion.onCursor(({ x, y }) => {
  const withinWindow = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
  const panel = document.getElementById('dsh-closure-pet-settings')
  const target = withinWindow ? document.elementFromPoint(x, y) : null
  const panelTarget = Boolean(panel && target && panel.contains(target))
  const uiTarget = Boolean(target && target.closest?.('[data-closure-ui]'))
  const hit = withinWindow && window.__dshClosurePet?.hitTest?.(x, y)
  const dragging = document.documentElement.classList.contains('dshcl-dragging')
  window.__dshClosurePet?.setHover?.(x, y)
  const enabled = Boolean(dragging || panelTarget || uiTarget || hit)
  if (interactive !== enabled) {
    interactive = enabled
    window.closureCompanion.setInteractive(enabled)
  }
})
