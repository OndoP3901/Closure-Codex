// dsh-closure-pet — 像素气泡（工厂）
//
// 结构：一个 fixed 容器里放「SVG 背景（像素边框 + 硬阴影）+ 文本层」，
// 文本用 Ark Pixel 12px 像素字体；整体 pointer-events:none，不挡下面 UI。
// 依赖注入：getState() 读 /state、pet、size()、settings。

import { PREFIX } from '../core/env.js'

import { dialogue } from '../core/dialogue.js'
import { getStandaloneVoiceQueue, getVoiceQueues } from '../shared/protocol.js'
import { createVoiceRotation } from '../core/voice-rotation.js'

export function quotaLines(state) {
  const companion = state?.closureCompanion
  const lines = []
  if (companion?.source === 'thirdParty') {
    const balance = companion.balance
    if (balance) lines.push([`账户余额 ${balance.remaining.toFixed(2)}`, balance.unit].filter(Boolean).join(' '))
  } else {
    for (const { minutes, remaining } of companion?.quota || []) {
      const window = minutes % 1440 === 0 ? minutes / 1440 + ' 天'
        : minutes % 60 === 0 ? minutes / 60 + ' 小时' : minutes + ' 分钟'
      lines.push(`${window}额度还剩 ${Math.round(remaining * 10) / 10}%`)
    }
    if (companion?.credits) {
      lines.push(`ChatGPT 积分${companion.credits.unlimited ? '不限量' : '还剩 ' + companion.credits.balance}`)
    }
  }
  const usage = companion?.tokenUsage
  if (usage) {
    if (usage.turn !== null) lines.push(`这轮用了 ${usage.turn.toLocaleString('zh-CN')} Token`)
    lines.push(`这段对话共用了 ${usage.total.toLocaleString('zh-CN')} Token`)
  }
  return lines
}

export function createBubble(deps) {
  var getState = deps.getState
  var pet = deps.pet
  var size = deps.size
  var settings = deps.settings
  const audio = deps.audio

  // ————————————————————— 气泡（像素风）—————————————————————
  // 结构：一个 fixed 容器里放「SVG 背景（像素边框 + 硬阴影）+ 文本层」，
  // 文本用 Ark Pixel 12px 像素字体；整体 pointer-events:none，不挡下面 UI。
  var BUBBLE_FONT = '"ArkPixel12", ui-monospace, monospace'
  // 像素字体是 12px 设计的矢量轮廓：默认按 24px（2×）渲染最清晰。
  var BUBBLE_BASE_SIZE = 24
  var BUBBLE_BASE_MAX_W = 330
  var BUBBLE_HIDE_MS = 5200
  var bubbleEl = null
  var bubbleTextEl = null
  var bubbleTailEl = null
  var bubbleSvg = null
  var bubbleW = 0
  var bubbleH = 0
  var bubbleHideTimer = 0
  var bubbleTickTimer = 0
  var fontReady = false
  var fontPromise = null
  var pendingBubble = null

  function metrics() {
    var follow = settings.bubbleFollowSize !== false
    var scale = Number(settings.bubbleScale) || 1
    var raw = BUBBLE_BASE_SIZE * (follow ? settings.size : 1) * scale
    // 对齐到偶数像素，保证像素边缘清晰
    var fontSize = Math.ceil(Math.min(72, Math.max(12, Math.round(raw))) / 2) * 2
    return {
      font: BUBBLE_FONT,
      fontSize: fontSize,
      line: Math.round(fontSize * 7 / 6),
      pad: Math.round(fontSize / 2),
      maxW: Math.round(BUBBLE_BASE_MAX_W * fontSize / BUBBLE_BASE_SIZE),
      corner: Math.round(fontSize / 4),
      tailW: Math.round(fontSize * 7 / 12),
      tailH: Math.round(fontSize * 5 / 12),
      stroke: Math.max(2, Math.round(fontSize / 12)),
      shadow: Math.max(2, Math.round(fontSize / 8)),
    }
  }

  function hideBubble() {
    bubbleShown = false
    taskDialogueShown = false
    bubbleEventUntil = 0
    clearTimeout(bubbleHideTimer)
    audio.stopVoice()
    if (bubbleEl) {
      try { bubbleEl.getAnimations().forEach(function (a) { a.cancel() }) } catch (err) {}
      bubbleEl.style.opacity = '0'
    }
    if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
  }
  var bubbleEventText = ''
  var bubbleEventUntil = 0
  var interactionText = ''
  const nextVoice = createVoiceRotation()
  var bubbleMode = 'info'

  function ensureFont() {
    if (fontPromise) return fontPromise
    if (!document.getElementById('dsh-closure-pet-font')) {
      var st = document.createElement('style')
      st.id = 'dsh-closure-pet-font'
      st.textContent = '@font-face{font-family:ArkPixel12;src:url("' + PREFIX
        + '/assets/fonts/ark-pixel-12px-zh_hans.woff2") format("woff2");font-display:swap}'
      document.head.appendChild(st)
    }
    // 字体加载完成前先不画气泡，避免先显示回退字体再切换的"发糊"。
    // 加载失败或超时就退回系统等宽字体，保证气泡仍然能显示。
    try {
      var timer = setTimeout(function () {
        if (fontReady) return
        fontReady = true
        fontPromise = Promise.resolve()
        flushPendingBubble()
      }, 600)
      fontPromise = document.fonts.load('24px ArkPixel12').then(function () {
        clearTimeout(timer)
        fontReady = true
        if (bubbleShown) refreshBubble()
        flushPendingBubble()
      }).catch(function () {
        clearTimeout(timer)
        fontReady = true
        flushPendingBubble()
      })
    } catch (err) {
      fontReady = true
      fontPromise = Promise.resolve()
    }
    return fontPromise
  }

  function flushPendingBubble() {
    if (!fontReady || !pendingBubble) return
    var request = pendingBubble
    pendingBubble = null
    showBubble.apply(null, request)
  }

  function ensureBubble() {
    if (bubbleEl) return
    bubbleEl = document.createElement('div')
    bubbleEl.id = 'dsh-closure-pet-bubble'
    bubbleEl.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'z-index:2147481999',
      'pointer-events:none', 'opacity:0',
      'transform-origin:center bottom',
      'filter:none', 'user-select:none', '-webkit-user-select:none',
    ].join(';')

    bubbleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    bubbleSvg.setAttribute('shape-rendering', 'crispEdges')
    bubbleSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible'
    bubbleEl.appendChild(bubbleSvg)

    bubbleTextEl = document.createElement('div')
    var initial = metrics()
    bubbleTextEl.style.cssText = [
      'position:absolute', 'white-space:pre',
      'font-family:' + initial.font,
      'font-size:' + initial.fontSize + 'px',
      'line-height:' + initial.line + 'px',
      'color:#20232a', 'letter-spacing:0',
      '-webkit-font-smoothing:none', 'font-smooth:never',
      'text-rendering:geometricPrecision',
    ].join(';')
    bubbleEl.appendChild(bubbleTextEl)

    document.body.appendChild(bubbleEl)
  }

  function measureText(text, m) {
    var cv = measureText._cv || (measureText._cv = document.createElement('canvas'))
    var ctx = cv.getContext('2d')
    m = m || metrics()
    ctx.font = m.fontSize + 'px ' + m.font
    return ctx.measureText(text).width
  }

  /** 按像素宽度折行：优先在空格处断（英文），中文按字符断 */
  function wrapText(text, maxWidth, m) {
    if (measureText(text, m) <= maxWidth) return [text]
    var out = []
    var cur = ''
    var lastSpace = -1
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i)
      if (cur && measureText(cur + ch, m) > maxWidth) {
        if (lastSpace > 0 && measureText(cur.slice(0, lastSpace), m) > maxWidth * 0.45) {
          out.push(cur.slice(0, lastSpace))
          cur = cur.slice(lastSpace + 1) + ch
        } else {
          out.push(cur)
          cur = ch
        }
        lastSpace = -1
      } else {
        cur += ch
      }
      if (ch === ' ') lastSpace = cur.length - 1
    }
    if (cur) out.push(cur)
    return out
  }

  // 像素气泡外框：四角切 4px 斜角；尾巴默认朝下（气泡在桌宠上方），
  // 桌面边缘放不下时气泡翻到下方，尾巴改为朝上。
  function bubblePath(w, h, tailX, tailUp, m) {
    var c = m.corner
    var t = m.tailH
    var tw = m.tailW
    if (!tailUp) {
      var bodyH = h - t
      return [
        'M', c, 0, 'H', w - c, 'V', c, 'H', w, 'V', bodyH - c, 'H', w - c, 'V', bodyH,
        'H', tailX + tw, 'V', h, 'H', tailX, 'V', bodyH,
        'H', c, 'V', bodyH - c, 'H', 0, 'V', c, 'Z',
      ].join(' ')
    }
    var top = t
    return [
      'M', c, top, 'H', tailX, 'V', 0, 'H', tailX + tw, 'V', top,
      'H', w - c, 'V', top + c, 'H', w, 'V', h - c, 'H', w - c, 'V', h,
      'H', c, 'V', h - c, 'H', 0, 'V', top + c, 'H', c, 'Z',
    ].join(' ')
  }

  function renderBubble(lines, tailCenterX, tailUp) {
    ensureFont()
    ensureBubble()
    var m = metrics()
    // 折行规则：
    //   1) 文本里**显式写的 `\n` 优先作为硬换行**（调用方自己控制分行）；
    //   2) 每段再按像素宽度软折行，避免单行把气泡拉得过宽。
    // 之前没有第 1 步：`\n` 被当成普通字符参与测量，整句按宽度硬切，
    // 于是"第二段"开头又被切一次，看起来像多空了一行。
    var wrapped = []
    for (var li = 0; li < lines.length; li++) {
      var segments = String(lines[li]).split(/\r?\n/)
      for (var si = 0; si < segments.length; si++) {
        var parts = wrapText(segments[si], m.maxW, m)
        for (var pi = 0; pi < parts.length; pi++) wrapped.push(parts[pi])
      }
    }
    lines = wrapped
    var widest = 0
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, measureText(lines[i], m))
    var w = Math.ceil(widest) + m.pad * 2 + 4
    var h = lines.length * m.line + m.pad * 2 + m.tailH
    // 对齐到偶数像素，保证像素边缘清晰
    w = Math.ceil(w / 2) * 2
    h = Math.ceil(h / 2) * 2
    bubbleW = w
    bubbleH = h
    // 容器本身没有内容流（子元素全是绝对定位），必须显式给尺寸
    var margin = m.shadow + 3
    bubbleEl.style.width = (w + margin) + 'px'
    bubbleEl.style.height = (h + margin) + 'px'

    var tailX = Math.round(Math.min(
      Math.max(8, (tailCenterX || w / 2) - m.tailW / 2),
      w - m.tailW - 8,
    ))
    bubbleSvg.setAttribute('width', String(w + margin))
    bubbleSvg.setAttribute('height', String(h + margin))
    bubbleSvg.setAttribute('viewBox', `0 0 ${w + margin} ${h + margin}`)
    bubbleSvg.innerHTML =
      '<path d="' + bubblePath(w, h, tailX, tailUp, m) + '" fill="#000" fill-opacity=".32" transform="translate(' + m.shadow + ',' + m.shadow + ')"/>' +
      '<path d="' + bubblePath(w, h, tailX, tailUp, m) + '" fill="#ffffff" stroke="#20232a" stroke-width="' + m.stroke + '"/>'

    bubbleTextEl.style.fontFamily = m.font
    bubbleTextEl.style.fontSize = m.fontSize + 'px'
    bubbleTextEl.style.lineHeight = m.line + 'px'
    bubbleTextEl.style.left = (m.pad + 2) + 'px'
    bubbleTextEl.style.top = ((tailUp ? m.tailH : 0) + m.pad + 1) + 'px'
    bubbleTextEl.textContent = lines.join('\n')
  }

  function fmtMoney(value, currency) {
    if (value === null || value === undefined) return '--'
    var n = Number(value)
    if (!isFinite(n)) return '--'
    return (currency === 'USD' ? '$' : '¥') + n.toFixed(2)
  }

  /** HH:MM:SS（倒计时显示用） */
  function hhmmss(ms) {
    var totalMinutes = Math.max(0, Math.round(ms / 60000))
    var pad = function (n) { return String(n).padStart(2, '0') }
    var h = Math.floor(totalMinutes / 60)
    var m = totalMinutes % 60
    return pad(h) + '时' + pad(m) + '分'
  }
  function bubbleLines() {
    // 事件反馈期间**只显示反馈内容**，不掺余额/花费/峰谷
    if (bubbleEventText && Date.now() < bubbleEventUntil) {
      return interactionText ? [bubbleEventText, interactionText] : [bubbleEventText]
    }
    var lines = []
    var s = getState()
    if (bubbleMode === 'quota') {
      const usage = quotaLines(s)
      return usage.length ? ['喏，博士，这次的用量在这儿。', ...usage] : []
    }
    if (interactionText) return [interactionText]
    if (s?.closureCompanion) return lines
    var b = s && s.balance
    if (b && b.ok) {
      lines.push('余额 ' + fmtMoney(b.total, b.currency) + (b.low ? ' 要花光了哦！' : '') + (b.stale ? ' 未刷新' : ''))
    } else if (b && b.signedOut) {
      lines.push('博士还没有登录CLSR哦')
    } else {
      lines.push('嗯……余额数据还没同步')
    }
    if (s) {
      var sp = s.spend
      if (sp) {
        var parts = ['今天花掉 ' + fmtMoney(sp.today, 'CNY')]
        if (Number(sp.turnAmount) > 0) parts.push('本轮消耗 ' + fmtMoney(sp.turnAmount, 'CNY'))
        lines.push(parts.join(' · '))
      }
      var peak = s.period === 'peak'
      var left = s.periodNextChangeAt ? Math.max(0, s.periodNextChangeAt - Date.now()) : null
      lines.push((peak ? '峰时' : '谷时') + (left !== null ? ' 距' + (peak ? '谷时' : '峰时') + hhmmss(left) : ''))
    }
    return lines
  }

  function placeBubble() {
    if (!bubbleEl || !pet.pos) return { tailCenter: bubbleW / 2, below: false }
    var s = size()
    var m = metrics()
    var centerX = pet.pos.x + s.w / 2
    // 尾巴不放在正中：气泡主体朝屏幕内侧展开，尾巴落在宽度的 32% / 68% 处
    var ratio = centerX < window.innerWidth / 2 ? 0.32 : 0.68
    var left = Math.round(centerX - bubbleW * ratio)
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - bubbleW - 8))
    var top = Math.round(pet.pos.y - bubbleH - 2)
    var below = top < 8
    if (below) top = Math.round(pet.pos.y + s.h + 2)
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - bubbleH - 8))
    bubbleEl.style.left = left + 'px'
    bubbleEl.style.top = top + 'px'
    // 弹出动画的轴心：在桌宠上方时用底边，翻到下方时用顶边
    bubbleEl.style.transformOrigin = below ? 'center top' : 'center bottom'
    // 尾巴仍然指向桌宠中心；气泡被夹到边缘时跟着偏移，但保证不贴边
    var tailCenter = Math.min(
      Math.max(m.tailW / 2 + 8, centerX - left),
      Math.max(m.tailW / 2 + 8, bubbleW - m.tailW / 2 - 8),
    )
    return { tailCenter: tailCenter, below: below }
  }

  function refreshBubble() {
    if (!pet.skeleton || !pet.pos) return
    ensureFont()
    ensureBubble()
    var lines = bubbleLines()
    if (!lines.length) { hideBubble(); return }
    // 1) 先按占位尾巴量出尺寸；2) 用真实尺寸判定上下/左右；3) 用正确尾巴重画再落位
    renderBubble(lines, 0, false)
    var pos = placeBubble()
    renderBubble(lines, pos.tailCenter, pos.below)
    placeBubble()
    return true
  }

  // 气泡显隐动画：像从桌宠头顶"冒"出来（底部为轴心），带一点回弹
  // 默认只做透明度变化：任何位移/缩放都会让 Chromium 合成文字层，
  // 产生亚像素偏移，看起来短暂发糊。
  // 回退选项：'slide'（淡入+位移）或 'scale'（旧缩放动画）。
  var BUBBLE_POP_MODE = 'fade' // 'fade' | 'slide' | 'scale'
  var bubbleShown = false
  function popBubbleIn() {
    if (!bubbleEl) return
    bubbleEl.style.opacity = '1'
    try { bubbleEl.getAnimations().forEach(function (a) { a.cancel() }) } catch (err) {}
    try {
      var frames = BUBBLE_POP_MODE === 'scale' ? [
        { opacity: 0, transform: 'scale(.62,.7) translateY(10px)' },
        { opacity: 1, transform: 'scale(1.06,1.03) translateY(-2px)', offset: 0.62 },
        { opacity: 1, transform: 'scale(.98,1.01) translateY(1px)', offset: 0.8 },
        { opacity: 1, transform: 'scale(1,1) translateY(0)' },
      ] : BUBBLE_POP_MODE === 'slide' ? [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(-2px)', offset: 0.62 },
        { opacity: 1, transform: 'translateY(1px)', offset: 0.8 },
        { opacity: 1, transform: 'translateY(0)' },
      ] : [
        { opacity: 0 },
        { opacity: 1 },
      ]
      bubbleEl.animate(frames, { duration: 320, easing: 'cubic-bezier(.22,1.5,.36,1)', fill: 'forwards' })
    } catch (err) {}
  }

  function popBubbleOut() {
    if (!bubbleEl) return
    try {
      bubbleEl.getAnimations().forEach(function (a) { a.cancel() })
      var frames = BUBBLE_POP_MODE === 'scale' ? [
        { opacity: 1, transform: 'scale(1,1)' },
        { opacity: 0, transform: 'scale(.92,.94) translateY(4px)' },
      ] : BUBBLE_POP_MODE === 'slide' ? [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(4px)' },
      ] : [
        { opacity: 1 },
        { opacity: 0 },
      ]
      bubbleEl.animate(frames, { duration: 180, easing: 'ease-in', fill: 'forwards' })
    } catch (err) {}
    bubbleEl.style.opacity = '0'
  }

  function showInteraction() {
    if (Date.now() < bubbleEventUntil || (taskDialogueShown && bubbleMode !== 'interaction')) return
    showDialogue(deps.standalone ? 'standalone' : 'working', '', 0, 'interaction')
  }

  let taskDialogueShown = false
  function showDialogue(scene, eventText = '', eventMs = 0, mode = scene) {
    if (!settings.bubble || document.hidden || (!eventText && Date.now() < bubbleEventUntil)) return false
    if (taskDialogueShown && (mode === 'working' || mode === 'idle' || mode === 'startup')) return false
    const standalone = scene === 'standalone'
    const queue = standalone ? getStandaloneVoiceQueue(settings) : getVoiceQueues(settings)[scene]
    const queueMode = standalone ? settings.standaloneVoiceQueueMode : settings.voiceQueueMode
    const id = nextVoice(queueMode + ':' + scene, queue)
    if (!id) return false
    showBubble(eventText, eventMs, dialogue[id][1], mode)
    taskDialogueShown = true
    audio.playVoice(id, (duration) => {
      const visibleFor = Math.max(BUBBLE_HIDE_MS, eventMs, duration + 250)
      if (eventText) bubbleEventUntil = Date.now() + visibleFor
      scheduleHide(visibleFor)
    }).catch(() => {})
    return true
  }

  function showQuota() {
    if (!settings.bubble || !quotaLines(getState()).length) return false
    showBubble(null, null, '', 'quota')
    return true
  }

  function showBubble(eventText, eventMs, clickedLine = '', mode = 'info') {
    if (!settings.bubble) return
    if (!fontReady) {
      pendingBubble = [eventText, eventMs, clickedLine, mode]
      ensureFont()
      return
    }
    taskDialogueShown = false
    audio.stopVoice()
    ensureFont()
    var wasVisible = bubbleShown
    interactionText = clickedLine
    if (eventText) {
      bubbleEventText = eventText
      bubbleEventUntil = Date.now() + (eventMs || 3600)
      bubbleMode = 'event'
    } else {
      bubbleEventText = ''
      bubbleEventUntil = 0
      bubbleMode = mode
    }
    if (!refreshBubble()) return
    bubbleShown = true
    // 只在气泡从无到有时弹一次。连续点击时保持当前气泡稳定，
    // 避免反复从透明淡入导致阴影/背景透出。
    if (!wasVisible) popBubbleIn()
    else bubbleEl.style.opacity = '1'
    // ⚠️ 事件气泡到"文字过期"就收起，**不能**拖到 5.2s：
    //    否则过期后内容会回落成余额/花费，看起来像"思考中突然弹余额"。
    var hideIn = bubbleMode === 'event'
      ? Math.max(700, bubbleEventUntil - Date.now())
      : BUBBLE_HIDE_MS
    scheduleHide(hideIn)
    if (!bubbleTickTimer) {
      bubbleTickTimer = setInterval(function () {
        if (!bubbleShown) {
          clearInterval(bubbleTickTimer); bubbleTickTimer = 0
          return
        }
        // 事件文字已过期 → 直接收气泡（不显示常规内容）
        if (bubbleMode === 'event' && Date.now() > bubbleEventUntil) {
          bubbleShown = false
          popBubbleOut()
          clearInterval(bubbleTickTimer); bubbleTickTimer = 0
          return
        }
        refreshBubble()
      }, 1000)
    }
  }

  function scheduleHide(delay) {
    clearTimeout(bubbleHideTimer)
    bubbleHideTimer = setTimeout(function () {
      bubbleShown = false
      taskDialogueShown = false
      audio.stopVoice()
      popBubbleOut()
      if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
    }, delay)
  }

  function dispose() {
    hideBubble()
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = 0 }
    if (bubbleTickTimer) { clearInterval(bubbleTickTimer); bubbleTickTimer = 0 }
    if (bubbleEl && bubbleEl.parentNode) bubbleEl.parentNode.removeChild(bubbleEl)
    bubbleEl = null
    bubbleTextEl = null
    bubbleTailEl = null
    bubbleSvg = null
  }

  // 启动即预加载像素字体，避免第一次弹气泡时才下载并切换字体。
  ensureFont()

  return { show: showBubble, showDialogue, showQuota: showQuota, showInteraction: showInteraction, refresh: refreshBubble, hide: hideBubble, dispose: dispose, isShown: function () { return bubbleShown } }
}
