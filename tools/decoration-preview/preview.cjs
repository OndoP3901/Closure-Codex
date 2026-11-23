const { app, BrowserWindow } = require('electron')
const path = require('node:path')
app.setName('可露希尔 · 装饰预览')
app.setPath('userData', path.resolve(__dirname, '../../work/decoration-preview-profile'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:1280,height:900,minWidth:640,minHeight:480,show:false,
    title:'可露希尔 · 页面装饰预览',backgroundColor:'#0a0b16',autoHideMenuBar:true,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} })
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }))
  win.webContents.on('will-navigate',(event) => event.preventDefault())
  await win.loadFile(path.join(__dirname,'preview.html'))
  win.show()
}).catch((error) => { console.error(error); app.exit(1) })
app.on('window-all-closed',() => app.quit())
