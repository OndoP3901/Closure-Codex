const fs = require('node:fs')
const path = require('node:path')
const { summarizeError, summarizeToolError } = require('./error-summary.cjs')

const tailLimit = 256 * 1024
const activeTimeout = 20 * 60 * 1000
const quotaTimeout = 30 * 60 * 1000
const talkHold = 2200 // Keep a short response visible across a one-second renderer poll.
const rolloutName = /^rollout-[\w-]+\.jsonl$/i
const publicToolNames = new Set(['web.search', 'web_run', 'search_service.web_run', 'apply_patch', 'exec_command'])

function parseToolOutput(output) {
  if (typeof output !== 'string') return output
  try { return JSON.parse(output) } catch { return null }
}

function createActivity(enabled, sessionsRoot) {
  const files = new Map()
  const pending = new Map()
  const tools = { ok: 0, fail: 0 }
  let turnStartSeq = 0
  const turnEnd = { seq: 0, kind: 'completed', at: 0 }
  const errors = { count: 0 }
  const userInput = { seq: 0, scene: null }
  const startedAt = Date.now()
  let rateLimits = { at: 0, windows: [] }
  let watcher

  function noteUserInput(scene, notify, session) {
    if (!notify) return
    userInput.seq++
    userInput.scene = scene
    session.signals.userInput = { seq: session.signals.userInput.seq + 1, scene }
  }

  function trackUserInput(event, session, notify) {
    if (session.subagent) return
    if (event.type === 'function_call' && typeof event.call_id === 'string') {
      if (event.name === 'request_user_input') {
        if (session.inputCalls.has(event.call_id)) return
        session.inputCalls.set(event.call_id, false)
        noteUserInput('question', notify, session)
      } else if (event.name === 'request_user_input_async') {
        session.inputCalls.set(event.call_id, true)
      }
    } else if (event.type === 'function_call_output' && session.inputCalls.has(event.call_id)) {
      const asynchronous = session.inputCalls.get(event.call_id)
      session.inputCalls.delete(event.call_id)
      const output = parseToolOutput(event.output)
      if (asynchronous && output?.accepted === true) {
        session.awaitingAnswers++
        noteUserInput('question', notify, session)
      } else if (!asynchronous && Object.values(output?.answers ?? {}).some((answer) =>
        Array.isArray(answer?.answers) && answer.answers.some((text) => typeof text === 'string' && text.trim())
      )) {
        noteUserInput('answer', notify, session)
      }
    } else if (session.awaitingAnswers && event.type === 'message' && event.role === 'user' &&
      event.content?.some?.(({ type, text }) => type === 'input_text' && typeof text === 'string' &&
        text.startsWith('<send_user_message_question_reply>') && text.trimEnd().endsWith('</send_user_message_question_reply>'))) {
      session.awaitingAnswers--
      noteUserInput('answer', notify, session)
    }
  }

  function applyLine(line, session, notify) {
    let record
    try { record = JSON.parse(line) } catch { return }
    if (!record.payload) return
    const event = record.payload
    const at = Date.parse(record.timestamp)
    if (record.type === 'session_meta') {
      session.subagent = Boolean(event.source?.subagent)
      return
    }
    if (record.type === 'response_item') {
      trackUserInput(event, session, notify)
      if (['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(event.type) ||
          event.type === 'message' && ['user', 'assistant'].includes(event.role)) {
        if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      }
      if (session.turn && event.type === 'message' && event.role === 'assistant') {
        session.mode = 'outputting'
        if (Number.isFinite(at)) {
          session.activityAt = Math.max(session.activityAt, at)
          if (notify) session.talkUntil = at + talkHold
        }
      }
      return
    }
    if (record.type !== 'event_msg') return

    if (event.type === 'token_count') {
      const total = event.info?.total_token_usage?.total_tokens
      if (Number.isSafeInteger(total) && total >= 0 && Number.isFinite(at)) {
        const changed = total !== session.totalTokens
        if (session.turn && (session.turnStartTokens === null || total < session.totalTokens)) {
          const last = event.info.last_token_usage?.total_tokens
          session.turnStartTokens = Number.isSafeInteger(last) && last >= 0 && last <= total ? total - last : null
        }
        session.totalTokens = total
        if (session.turn) {
          session.turnTokens = session.turnStartTokens === null ? null : total - session.turnStartTokens
        }
        if (changed) session.activityAt = Math.max(session.activityAt, at)
      }
      const limits = event.rate_limits
      if (!limits || (limits.limit_id && limits.limit_id !== 'codex') || !Number.isFinite(at) || at < rateLimits.at) return
      const windows = [limits.primary, limits.secondary].filter((entry) =>
        Number.isFinite(entry?.used_percent) && entry.used_percent >= 0 && entry.used_percent <= 100 &&
        Number.isInteger(entry.window_minutes) && entry.window_minutes > 0 && Number.isFinite(entry.resets_at)
      ).map((entry) => ({ minutes: entry.window_minutes, remaining: 100 - entry.used_percent, resetsAt: entry.resets_at * 1000 }))
      if (windows.length) rateLimits = { at, windows }
      return
    }

    if (event.type === 'task_started') {
      if (typeof event.turn_id !== 'string' || session.turn === event.turn_id) return
      if (notify && !session.subagent) { turnStartSeq++; session.signals.turnStartSeq++ }
      session.turn = event.turn_id
      session.mode = 'thinking'
      session.error = null
      session.talkUntil = 0
      session.turnStartTokens = session.totalTokens
      session.turnTokens = null
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      return
    }
    if (!session.turn || (event.turn_id && event.turn_id !== session.turn)) return

    if (event.type === 'agent_message' ||
        (['item_started', 'item_completed'].includes(event.type) && event.item?.type === 'AgentMessage')) {
      session.mode = 'outputting'
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      if (notify && Number.isFinite(at)) session.talkUntil = at + talkHold
    } else if (['item_started', 'item_completed'].includes(event.type) &&
        ['CommandExecution', 'McpToolCall', 'FileChange'].includes(event.item?.type)) {
      session.mode = 'thinking'
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      if (event.type !== 'item_completed') return
      const item = event.item
      const mcp = item.type === 'McpToolCall'
      const toolError = mcp && (item.status === 'failed' || item.result?.isError === true || item.result?.is_error === true)
      // A command can run normally and still return a nonzero result (for example, a search with no matches).
      if (notify && toolError) {
        tools.fail++
        tools.lastFailName = publicToolNames.has(item.tool) ? item.tool : ''
        tools.lastFailReason = summarizeToolError(item)
        session.signals.tools = { ...tools, ok: session.signals.tools.ok, fail: session.signals.tools.fail + 1 }
      }
      else if (notify && item.status === 'completed' && (item.exit_code ?? 0) === 0) { tools.ok++; session.signals.tools.ok++ }
    } else if (event.type === 'error' && !event.will_retry && !event.willRetry) {
      session.talkUntil = 0
      const details = event.error ?? event
      session.error = { reason: summarizeError(details), seq: 0 }
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      if (notify) {
        session.error.seq = ++errors.count
        errors.message = session.error.reason
        session.signals.errors = { count: session.signals.errors.count + 1, message: session.error.reason }
      }
    } else if (event.type === 'task_complete' || event.type === 'turn_aborted') {
      if (Number.isFinite(at)) session.activityAt = Math.max(session.activityAt, at)
      const kind = event.type === 'turn_aborted' ? 'interrupted' : session.error ? 'error' : 'completed'
      session.turn = null
      session.mode = null
      session.inputCalls.clear()
      if (kind !== 'completed') session.talkUntil = 0
      if (notify && !session.subagent) {
        turnEnd.seq++
        turnEnd.kind = kind
        turnEnd.at = Date.now()
        turnEnd.errorSeq = kind === 'error' ? session.error.seq : 0
        turnEnd.reason = kind === 'error' ? session.error.reason
          : kind === 'interrupted' && event.reason === 'interrupted' ? '本轮被中断' : ''
        session.signals.turnEnd = { ...turnEnd, seq: session.signals.turnEnd.seq + 1,
          errorSeq: kind === 'error' ? session.signals.errors.count : 0 }
      }
    }
  }

  function readTail(filename, notifyExisting = true) {
    let fd
    try {
      fd = fs.openSync(filename, 'r')
      const { size, mtimeMs, birthtimeMs } = fs.fstatSync(fd)
      const prior = files.get(filename)
      const truncated = prior && prior.offset > size
      const session = prior && !truncated ? prior : {
        offset: 0, updated: 0, turn: null, mode: null, talkUntil: 0, error: null,
        activityAt: 0, totalTokens: null, turnStartTokens: null, turnTokens: null,
        inputCalls: new Map(), awaitingAnswers: 0,
        signals: { tools: { ok: 0, fail: 0 }, errors: { count: 0 }, userInput: { seq: 0, scene: null }, turnStartSeq: 0, turnEnd: { seq: 0, kind: 'completed' } },
      }
      if (size === session.offset) return
      const start = Math.max(session.offset, size - tailLimit)
      if ((!prior || truncated) && start > 0) {
        const head = Buffer.alloc(Math.min(tailLimit, size))
        const headBytes = fs.readSync(fd, head, 0, head.length, 0)
        const firstLine = head.indexOf(10)
        if (firstLine >= 0 && firstLine < headBytes) {
          applyLine(head.toString('utf8', 0, firstLine), session, false)
        }
      }
      const data = Buffer.alloc(size - start)
      const bytes = fs.readSync(fd, data, 0, data.length, start)
      session.updated = mtimeMs
      files.set(filename, session)
      if (bytes === 0) return
      const end = data.lastIndexOf(10, bytes - 1)
      if (end < 0) return
      // The writer may be between chunks. Resume immediately after the final newline.
      session.offset = start + end + 1
      // A newly created rollout can finish before its first watch callback.
      const notify = notifyExisting && !truncated && (Boolean(prior) || birthtimeMs >= startedAt)
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) applyLine(line, session, notify)
    } catch (error) {
      if (error.code === 'ENOENT') files.delete(filename)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  function queue(filename) {
    if (!filename || !rolloutName.test(path.basename(filename))) return
    const full = path.resolve(sessionsRoot, filename)
    if (!full.startsWith(sessionsRoot + path.sep) || pending.has(full)) return
    pending.set(full, setTimeout(() => {
      pending.delete(full)
      readTail(full)
    }, 180))
  }

  if (enabled && fs.existsSync(sessionsRoot)) {
    try {
      watcher = fs.watch(sessionsRoot, { recursive: true }, (_event, filename) => queue(filename))
      watcher.on('error', () => { watcher?.close(); watcher = undefined })
      for (const offset of [0, 1]) {
        const date = new Date()
        date.setDate(date.getDate() - offset)
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const folder = path.join(sessionsRoot, String(date.getFullYear()), month, day)
        if (!fs.existsSync(folder)) continue
        for (const name of fs.readdirSync(folder)) {
          if (!rolloutName.test(name)) continue
          const filename = path.join(folder, name)
          if (Date.now() - fs.statSync(filename, { throwIfNoEntry: false })?.mtimeMs < quotaTimeout) readTail(filename, false)
        }
      }
    } catch { watcher?.close(); watcher = undefined }
  }

  return {
    snapshot() {
      const now = Date.now()
      let active
      let latest
      for (const [filename, session] of files) {
        if (session.subagent) continue
        if (session.activityAt && (!latest || session.activityAt > latest.activityAt)) latest = session
        if (session.turn && now - session.activityAt <= activeTimeout &&
            (!active || session.activityAt > active.activityAt)) active = session
      }
      for (const [filename, session] of files) {
        if (session !== latest && now - session.updated > activeTimeout) files.delete(filename)
      }
      const selected = active || latest
      return {
        conversations: [...files].filter(([, s]) => !s.subagent).map(([filename, s]) => ({
          id: path.basename(filename), lastActivityAt: s.activityAt, ...s.signals,
          work: { active: Boolean(s.turn && now - s.activityAt <= activeTimeout),
            mode: s.turn && now - s.activityAt <= activeTimeout ? s.talkUntil > now ? 'outputting' : s.mode || 'thinking' : 'idle' },
          closureCompanion: { tokenUsage: s.totalTokens == null ? null : { total: s.totalTokens, turn: s.turnTokens } },
        })),
        closureCompanion: {
          following: Boolean(watcher), completed: now - turnEnd.at < 10000 && turnEnd.kind === 'completed',
          quota: now - rateLimits.at < quotaTimeout ? rateLimits.windows.filter((entry) => entry.resetsAt > now) : [],
          tokenUsage: selected?.totalTokens == null ? null : {
            total: selected.totalTokens, turn: selected.turnTokens,
          },
        },
        work: { mode: selected?.talkUntil > now ? 'outputting' : active?.mode || 'idle', active: Boolean(active) },
        tools: { ...tools },
        errors: { ...errors },
        userInput: { ...userInput },
        turnStartSeq,
        turnEnd: { seq: turnEnd.seq, kind: turnEnd.kind, errorSeq: turnEnd.errorSeq, reason: turnEnd.reason },
      }
    },
    stop() {
      watcher?.close()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}

module.exports = { createActivity }
