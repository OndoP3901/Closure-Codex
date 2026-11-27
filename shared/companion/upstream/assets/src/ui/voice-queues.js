import { dialogue, VOICE_SCENES } from '../core/dialogue.js'
import { getStandaloneVoiceQueue, getVoiceQueues } from '../shared/protocol.js'

const buttonStyle = 'padding:3px 7px;border:1px solid #545969;border-radius:6px;background:#303442;color:inherit;font:inherit;cursor:pointer'
const listStyle = 'overflow:auto;overscroll-behavior:contain;margin:4px 0;padding:0;list-style:none'

function button(label, action) {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  element.style.cssText = buttonStyle
  element.addEventListener('click', action)
  return element
}

export function createVoiceQueues({ settings, saveSettings, previewVoice, stopVoicePreview, positionPanel, standalone }) {
  let scene = 'start'
  let group = ''
  const menu = document.createElement('details')
  menu.id = 'dsh-closure-voice-queues'
  menu.style.cssText = 'margin-top:8px;border-top:1px solid #444958;padding-top:5px'
  const heading = document.createElement('summary')
  heading.textContent = '语音队列'
  heading.style.cursor = 'pointer'
  const editor = document.createElement('div')
  editor.style.cssText = 'width:min(420px,calc(100vw - 44px));padding-top:6px'
  menu.append(heading, editor)

  const modes = document.createElement('div')
  const modeKey = standalone ? 'standaloneVoiceQueueMode' : 'voiceQueueMode'
  modes.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px'
  for (const [mode, label] of [['default', '默认队列'], ['personal', '个人队列']]) {
    const option = button(label, () => {
      if (settings[modeKey] === mode) return
      stopVoicePreview()
      settings[modeKey] = mode
      queueList.scrollTop = 0
      saveSettings(true)
      refresh()
    })
    option.dataset.queueMode = mode
    modes.appendChild(option)
  }

  const scenes = document.createElement('div')
  scenes.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px'
  for (const [key, label] of Object.entries(standalone ? {} : VOICE_SCENES)) {
    const tab = button(label, () => {
      stopVoicePreview()
      scene = key
      queueList.scrollTop = 0
      refresh()
    })
    tab.dataset.scene = key
    scenes.appendChild(tab)
  }

  const queueTitle = document.createElement('strong')
  const queueList = document.createElement('ol')
  queueList.style.cssText = listStyle + ';max-height:min(135px,22vh)'
  queueList.dataset.queueList = ''
  const catalogHeading = document.createElement('div')
  catalogHeading.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;border-top:1px solid #444958;padding-top:6px'
  const catalogTitle = document.createElement('strong')
  catalogHeading.append(catalogTitle)
  const filters = []
  for (const [key, label] of [['', '全部'], ['a', '干员语音'], ['b', '卫戍协议']]) {
    const filter = button(label, () => {
      group = key
      catalog.scrollTop = 0
      refresh()
    })
    filter.dataset.group = key
    catalogHeading.appendChild(filter)
    filters.push(filter)
  }
  catalogHeading.appendChild(button('停止试听', stopVoicePreview))
  const catalog = document.createElement('ul')
  catalog.style.cssText = listStyle + ';max-height:min(270px,34vh)'

  function setQueue(ids) {
    if (standalone) settings.standaloneVoiceQueue = ids
    else settings.voiceQueues = { ...settings.voiceQueues, [scene]: ids }
    saveSettings(true)
    refresh()
  }

  const entries = Object.entries(dialogue).map(([id, [title, subtitle]]) => {
    const row = document.createElement('li')
    row.dataset.clip = id
    row.style.cssText = 'padding:5px 2px;border-bottom:1px solid #444958'
    const controls = document.createElement('div')
    controls.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:4px'
    const name = document.createElement('strong')
    name.style.flex = '1'
    name.textContent = id.toUpperCase() + ' · ' + title
    const listen = button('试听', () => { previewVoice(id).catch(() => {}) })
    const add = button('加入', () => setQueue([...(standalone ? settings.standaloneVoiceQueue : settings.voiceQueues[scene]), id]))
    add.dataset.addVoice = id
    controls.append(name, listen, add)
    const text = document.createElement('div')
    text.style.cssText = 'color:#bfc7db;overflow-wrap:anywhere'
    text.textContent = subtitle
    row.append(controls, text)
    catalog.appendChild(row)
    return { id, row, add, listen }
  })
  editor.append(modes, scenes, queueTitle, queueList, catalogHeading, catalog)

  function select(element, selected) {
    element.setAttribute('aria-pressed', String(selected))
    element.style.background = selected ? '#525ca9' : '#303442'
  }

  function refresh() {
    const personal = settings[modeKey] === 'personal'
    const ids = standalone ? getStandaloneVoiceQueue(settings) : getVoiceQueues(settings)[scene]
    queueTitle.textContent = '当前队列（' + ids.length + '）'
    for (const option of modes.children) select(option, option.dataset.queueMode === settings[modeKey])
    for (const tab of scenes.children) select(tab, tab.dataset.scene === scene)
    for (const filter of filters) select(filter, filter.dataset.group === group)
    const queueTop = queueList.scrollTop
    queueList.replaceChildren()
    if (!ids.length) {
      const empty = document.createElement('li')
      empty.textContent = personal ? '队列为空，可从待选区加入语音。' : '队列为空。'
      queueList.appendChild(empty)
    }
    for (const id of ids) {
      const row = document.createElement('li')
      row.dataset.queuedVoice = id
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0'
      const name = document.createElement('span')
      name.style.flex = '1'
      name.textContent = id.toUpperCase() + ' · ' + dialogue[id][0]
      row.appendChild(name)
      queueList.appendChild(row)
      if (!personal) continue
      const remove = button('移除', () => setQueue(ids.filter((entry) => entry !== id)))
      row.appendChild(remove)
    }
    queueList.scrollTop = queueTop
    let visibleCount = 0
    for (const { id, row, add, listen } of entries) {
      row.hidden = !id.startsWith(group)
      if (!row.hidden) visibleCount++
      const included = ids.includes(id)
      add.hidden = !personal
      add.disabled = !personal || included
      add.textContent = included ? '已加入' : '加入'
      listen.disabled = !settings.voice
      listen.title = settings.voice ? '' : '请先开启角色配音'
    }
    catalogTitle.textContent = '待选语音（' + visibleCount + '）'
    positionPanel()
  }

  menu.addEventListener('toggle', () => {
    if (menu.open) refresh()
    else {
      stopVoicePreview()
      positionPanel()
    }
  })
  return { menu, refresh }
}
