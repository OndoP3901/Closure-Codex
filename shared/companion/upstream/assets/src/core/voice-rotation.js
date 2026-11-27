export function createVoiceRotation(random = Math.random) {
  const rotations = new Map()

  return function nextVoice(key, queue) {
    if (!queue.length) {
      rotations.delete(key)
      return undefined
    }
    let rotation = rotations.get(key)
    if (!rotation || rotation.queue !== queue) {
      rotation = { queue, pending: [], last: rotation?.last }
      rotations.set(key, rotation)
    }
    if (!rotation.pending.length) {
      rotation.pending = [...queue]
      for (let index = queue.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1))
        const value = rotation.pending[index]
        rotation.pending[index] = rotation.pending[swap]
        rotation.pending[swap] = value
      }
      const end = queue.length - 1
      if (end > 0 && rotation.pending[end] === rotation.last) {
        const swap = Math.floor(random() * end)
        rotation.pending[end] = rotation.pending[swap]
        rotation.pending[swap] = rotation.last
      }
    }
    rotation.last = rotation.pending.pop()
    return rotation.last
  }
}
