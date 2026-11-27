let interactive = false

window.closureCompanion.onCursor(({ x, y }) => {
  const withinWindow = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
  const panel = document.getElementById('dsh-closure-pet-settings')
  const panelTarget = withinWindow && panel?.contains(document.elementFromPoint(x, y))
  const hit = withinWindow && window.__dshClosurePet?.hitTest?.(x, y)
  const dragging = document.documentElement.classList.contains('dshcl-dragging')
  const enabled = Boolean(dragging || panelTarget || hit)
  if (interactive !== enabled) {
    interactive = enabled
    window.closureCompanion.setInteractive(enabled)
  }
})
