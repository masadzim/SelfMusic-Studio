const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  download: (url) => ipcRenderer.invoke('dl:start', url),
  pause: (id) => ipcRenderer.invoke('dl:pause', id),
  resume: (id) => ipcRenderer.invoke('dl:resume', id),
  cancel: (id) => ipcRenderer.invoke('dl:cancel', id),
  reveal: (savePath) => ipcRenderer.invoke('dl:reveal', savePath),
  onUpdate: (cb) => { ipcRenderer.on('dl:update', (event, data) => cb(data)); }
});