const path = require('node:path')
const os = require('node:os')
const { createActivity } = require('./activity.cjs')
const { createQuota } = require('./quota.cjs')
const { createDsh } = require('./dsh.cjs')
const { createWorkBuddy, powershellJson } = require('./workbuddy.cjs')

const keys = { codex: 'codexLinked', dsh: 'dshLinked', workbuddy: 'workbuddyLinked' }
const names = { codex: 'Codex', dsh: 'DSH', workbuddy: 'WorkBuddy' }
const counters = s => [s?.turnStartSeq || 0, s?.turnEnd?.seq || 0, s?.tools?.ok || 0, s?.tools?.fail || 0, s?.errors?.count || 0, s?.userInput?.seq || 0]

function createIntegrations({ codexHome, enabled = true, now = Date.now,
  directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'ClosureCompanion/bridges'), factories = {} } = {}) {
  const hosts = new Map(), totals = [0, 0, 0, 0, 0, 0]
  let focusKey = null, focusRevision = 0
  let latestEnd = { kind: 'completed' }, latestTools = {}, latestError = {}, latestInput = { scene: null }
  const create = {
    codex() {
      const activity = createActivity(true, path.join(codexHome, 'sessions'))
      let quota, open = false, stopped = false, timer
      async function checkConnection() {
        try {
          const running = await powershellJson(`@(Get-CimInstance Win32_Process -Filter "Name='Codex.exe' OR Name='ChatGPT.exe'" | Where-Object {
            $_.ExecutablePath -match '\\\\WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '\\s--type='
          }).Count -gt 0`)
          if (stopped) return
          open = running === true
          if (open && !quota) quota = createQuota({ enabled: true, home: codexHome })
          if (!open && quota) { quota.stop(); quota = undefined }
        } catch { open = false }
        finally { if (!stopped) { timer = setTimeout(checkConnection, 5000); timer.unref?.() } }
      }
      void checkConnection()
      return { snapshot() {
        const value = activity.snapshot()
        const connected = open && value.closureCompanion.following
        return { ...value, connected, status: connected ? 'connected' : 'waiting', instance: 'codex',
          closureCompanion: { ...value.closureCompanion, ...quota?.snapshot(), host: 'codex' } }
      }, stop() { stopped = true; clearTimeout(timer); activity.stop(); quota?.stop() } }
    },
    dsh: () => createDsh({ directory, now }), workbuddy: () => createWorkBuddy({ now }), ...factories,
  }
  function configure(settings) {
    for (const [host, key] of Object.entries(keys)) {
      const required = enabled && settings[key] === true
      if (required && !hosts.has(host)) hosts.set(host, { adapter: create[host](), previous: new Map(), connected: false })
      if (!required && hosts.has(host)) { hosts.get(host).adapter.stop(); hosts.delete(host) }
    }
  }
  function snapshot() {
    const current = [], candidates = []
    for (const [host, entry] of hosts) {
      const value = entry.adapter.snapshot()
      const baseline = !entry.connected || entry.instance !== value.instance
      const previous = baseline ? new Map() : entry.previous
      const next = new Map()
      const conversations = Array.isArray(value.conversations) ? value.conversations : [{ ...value, id: host, lastActivityAt: value.lastEventAt || 0 }]
      for (const conversation of conversations) {
        const counts = counters(conversation)
        const before = previous.get(conversation.id) || [0, 0, 0, 0, 0, 0]
        const delta = counts.map((c, i) => !baseline && Number.isSafeInteger(c) ? Math.max(0, c - before[i]) : 0)
        next.set(conversation.id, counts)
        if (value.connected) candidates.push({ host, value, conversation, delta,
          key: JSON.stringify([host, value.instance, conversation.id]),
          at: Number.isFinite(conversation.lastActivityAt) ? Math.min(conversation.lastActivityAt, now()) : 0 })
      }
      entry.previous = next; entry.instance = value.instance; entry.connected = value.connected
      current.push({ host, value })
    }
    // Compare host event timestamps, never adapter polling order or balance refreshes.
    // Every conversation's cursor advances, so ignored events cannot replay later.
    candidates.sort((a, b) => b.at - a.at || (a.key === focusKey ? -1 : b.key === focusKey ? 1 :
      Number(b.conversation.work?.active) - Number(a.conversation.work?.active) || a.key.localeCompare(b.key)))
    const selected = candidates[0]
    if ((selected?.key || null) !== focusKey) { focusKey = selected?.key || null; focusRevision++ }
    if (selected) {
      const { delta, conversation: value, host } = selected
      delta.forEach((n, i) => { totals[i] += n })
      if (delta[1]) latestEnd = { ...value.turnEnd, host }
      if (delta[3]) latestTools = { lastFailName: value.tools.lastFailName, lastFailReason: value.tools.lastFailReason, host }
      if (delta[4]) latestError = { message: value.errors.message, host }
      if (delta[5]) latestInput = { scene: value.userInput.scene, host }
    }
    const companion = { ...selected?.value.closureCompanion, ...selected?.conversation.closureCompanion }
    return {
      closureCompanion: { ...companion, quota: companion.quota || [], focusKey, focusRevision, following: current.some(v => v.value.connected),
        accounts: current.filter(v => v.value.connected).map(({ host, value }) => ({ ...value.closureCompanion, host, name: names[host], connected: true })) },
      work: selected?.conversation.work || { active: false, mode: 'idle' },
      tools: { ok: totals[2], fail: totals[3], ...latestTools }, errors: { count: totals[4], ...latestError },
      userInput: { seq: totals[5], ...latestInput }, turnStartSeq: totals[0],
      turnEnd: { ...latestEnd, seq: totals[1], ...(latestEnd.kind === 'error' ? { errorSeq: totals[4] } : {}) },
    }
  }
  function status() {
    return Object.fromEntries([...hosts].map(([host, { adapter }]) => [host, { status: adapter.snapshot().status }]))
  }
  return { configure, snapshot, status, stop() { for (const { adapter } of hosts.values()) adapter.stop(); hosts.clear() } }
}
module.exports = { createIntegrations }
