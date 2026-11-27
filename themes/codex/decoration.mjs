// The host supplies verified elements. No selectors based on obfuscated client classes.
const mounted = new WeakMap()

export function mountDecoration({ document: doc = document, titlebar, workspace, sidebar } = {}) {
  if (!titlebar) throw new Error('A verified titlebar element is required')
  if (![titlebar, workspace, sidebar].filter(Boolean).every((node) => node.ownerDocument === doc)) {
    throw new Error('Decoration elements must belong to the supplied document')
  }
  const root = doc.documentElement
  mounted.get(doc)?.dispose()
  const attributes = ['data-closure-decoration', 'data-theme']
  const previous = attributes.map((name) => root.getAttribute(name))
  let added = []
  let disposed = false
  function setElements({ titlebar, workspace, sidebar } = {}) {
    if (disposed) return
    const elements = [[titlebar, 'closure-decoration-titlebar'], [workspace, 'closure-decoration-workspace'],
      [sidebar, 'closure-decoration-sidebar']].filter(([node]) => node)
    if (!elements.every(([node]) => node.ownerDocument === doc)) throw new Error('Decoration elements must belong to the supplied document')
    // Bind new nodes before releasing old nodes; document colours stay enabled throughout routing.
    const next = []
    for (const [node, name] of elements) {
      if (added.some(([oldNode, oldName]) => oldNode === node && oldName === name) || !node.classList.contains(name)) next.push([node,name])
      if (!node.classList.contains(name)) node.classList.add(name)
    }
    for (const [node, name] of added) if (!elements.some(([newNode,newName]) => newNode === node && newName === name)) node.classList.remove(name)
    added = next
  }
  setElements({ titlebar,workspace,sidebar })
  root.setAttribute('data-closure-decoration', 'on')
  root.setAttribute('data-theme', 'dark')
  const controller = {
    setElements,
    setEnabled(enabled) {
      if (disposed) return
      root.setAttribute('data-closure-decoration', enabled ? 'on' : 'off')
      if (enabled) root.setAttribute('data-theme', 'dark')
      else if (previous[1] === null) root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', previous[1])
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const [node, name] of added) node.classList.remove(name)
      attributes.forEach((name, index) => previous[index] === null
        ? root.removeAttribute(name) : root.setAttribute(name, previous[index]))
      if (mounted.get(doc) === controller) mounted.delete(doc)
    },
  }
  mounted.set(doc, controller)
  return controller
}
