(async () => {
  const unavailable = { quota: [], accountStatus: 'unavailable' }
  const normalize = name => String(name ?? '').trim()
    .replace(/\s+\((?:low|medium|high|xhigh|max|thinking)\)$/i, '')
    .replace(/\s+(?:low|medium|high|xhigh|max|thinking)$/i, '')
    .trim().toLowerCase()
  const models = [...document.querySelectorAll('.agy-shell [data-testid="model-selector-trigger"]')]
  const trigger = models.find(node => node.getClientRects().length && node.closest('[data-pane-unfocused]') === null)
    ?? models.find(node => node.getClientRects().length)
  const model = normalize(trigger?.textContent)
  if (!model) return unavailable

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
  const group = groups.find(item => {
    const description = item.description?.split(/:\s*/, 2)[1]
    return normalize(item.displayName) === model ||
      description?.split(',').some(name => normalize(name) === model)
  })
  const quota = [['5h', 300], ['weekly', 10080]].flatMap(([window, minutes]) => {
    const bucket = group?.buckets?.find(item => item.window === window && !item.disabled)
    const fraction = bucket?.remaining?.case === 'remainingFraction' ? bucket.remaining.value : undefined
    return typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? [{ minutes, remaining: fraction * 100 }]
      : []
  })
  return quota.length ? { quota, accountStatus: 'ready' } : unavailable
})()
