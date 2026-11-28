(async () => {
  const unavailable = { quota: [], accountStatus: 'unavailable' }
  const normalize = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const models = [...document.querySelectorAll('.agy-shell [data-testid="model-selector-trigger"]')]
  const trigger = models.find(node => node.getClientRects().length && node.closest('[data-pane-unfocused]') === null)
    ?? models.find(node => node.getClientRects().length)
  const fullName = normalize(trigger?.textContent)
  if (!fullName) return unavailable
  // In 2.36 the label contains the model name as text and the thinking level in a nested span.
  const label = trigger.querySelector(':scope > span')
  const modelName = normalize(Array.from(label?.childNodes ?? [])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent).join(''))

  let service
  const fiber = Object.keys(trigger).find(key => key.startsWith('__reactFiber$'))
  for (let node = fiber && trigger[fiber]; node && !service; node = node.return) {
    for (let context = node.dependencies?.firstContext; context; context = context.next) {
      const value = context.memoizedValue
      if (typeof value?.retrieveUserQuotaSummary === 'function') {
        service = value
        break
      }
    }
  }
  if (!service) return unavailable

  const result = await service.retrieveUserQuotaSummary({})
  const groups = result?.response?.groups ?? result?.groups
  if (!Array.isArray(groups)) return unavailable
  function findGroup(model, normalizeName = normalize) {
    if (!model) return
    return groups.find(item => {
      const listed = item.description?.split(/:\s*/, 2)[1]?.split(',') ?? []
      return [item.displayName, ...listed].some(name => normalizeName(name) === model)
    })
  }
  // Older selectors render both pieces as a single string.
  const withoutLevel = name => normalize(name).replace(/\s+\(?(?:extra high|low|medium|high|xhigh|max|thinking)\)?$/, '')
  const group = findGroup(modelName) ?? findGroup(fullName) ?? findGroup(withoutLevel(fullName), withoutLevel)
  const quota = [['5h', 300], ['weekly', 10080]].flatMap(([window, minutes]) => {
    const bucket = group?.buckets?.find(item => item.window === window && !item.disabled)
    const fraction = bucket?.remaining?.case === 'remainingFraction' ? bucket.remaining.value : undefined
    return typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? [{ minutes, remaining: fraction * 100 }]
      : []
  })
  return quota.length ? { quota, accountStatus: 'ready' } : unavailable
})()
