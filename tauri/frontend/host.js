const { Channel, invoke } = window.__TAURI__.core
let cursorHandler
let wantsPointer = false
const voiceEpoch = Math.floor(performance.timeOrigin) * 1024
const untouchedAtLoad = !navigator.userActivation.hasBeenActive

function applyRuntimeSetting(result) {
  const linked = String(Boolean(result.codexLinked || result.dshLinked || result.workbuddyLinked || result.antigravityLinked))
  if (result.ok && !parameters.has('smoke') && parameters.get('codexLinked') !== linked) {
    const url = new URL(location.href)
    url.searchParams.set('codexLinked', linked)
    setTimeout(() => location.replace(url), 0)
  }
  return result
}

window.closureCompanion = {
  onCursor: (callback) => { cursorHandler = callback },
  setInteractive: (enabled) => { wantsPointer = enabled },
  quit: () => invoke('quit'),
  getLinkedState: () => invoke('linked_state'),
  getRuntimeSettings: () => invoke('runtime_settings'),
  setRuntimeSetting: (key, enabled) => invoke('set_runtime_setting', { key, enabled }).then(applyRuntimeSetting),
  launchAgent: agent => invoke('launch_agent', { agent }).then(applyRuntimeSetting),
  nativeVoice: {
    play: (language, id, volume, request) => invoke('play_voice', { language, id, volume, request: voiceEpoch + request }),
    stop: (request) => invoke('stop_voice', { request: voiceEpoch + request }),
    setVolume: (volume, request) => invoke('voice_volume', { volume, request: voiceEpoch + request }),
  },
}

const cursor = new Channel()
let inspectSample
cursor.onmessage = ({ x, y, sequence }) => {
  const point = inspectSample ? inspectSample() : { x, y }
  if (!point) return
  try {
    cursorHandler?.(point)
  } finally {
    invoke('cursor_result', { sequence, interactive: wantsPointer }).catch(console.error)
  }
}

async function runSmoke(pet, parameters) {
  const { smoke, checkCursor } = await import('/smoke.js')
  await smoke(pet, parameters, untouchedAtLoad)
  await checkCursor(pet, {
    start: () => invoke('start_cursor', { channel: cursor }),
    isPassingThrough: () => invoke('smoke_cursor_passthrough'),
    inspect: callback => { inspectSample = callback },
  })
}

const parameters = new URLSearchParams(location.search)
const waitForPet = setInterval(() => {
  const pet = window.__dshClosurePet
  if (pet?.phase === 'failed') {
    clearInterval(waitForPet)
    invoke('frontend_failed', { message: pet.error }).catch(console.error)
  } else if (pet?.phase === 'running') {
    clearInterval(waitForPet)
    const testing = parameters.has('smoke')
    const ready = invoke('frontend_ready')
    if (testing) {
      ready.then(() => runSmoke(pet, parameters))
        .then(() => invoke('smoke_result', { message: null }))
        .catch(error => invoke('smoke_result', { message: String(error) }))
    } else ready.then(() => invoke('start_cursor', { channel: cursor })).catch(console.error)
  }
}, 50)
