const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('closureCompanion', {
  onCursor: (callback) => ipcRenderer.on('closure:cursor', (_event, point) => callback(point)),
  setInteractive: (enabled) => ipcRenderer.send('closure:interactive', enabled === true),
  setAlwaysOnTop: (enabled) => ipcRenderer.send('closure:always-on-top', enabled === true),
  setAutostart: (enabled) => ipcRenderer.invoke('closure:autostart', enabled === true),
  setLaunchMode: (mode) => ipcRenderer.invoke('closure:launch-mode', mode),
})
