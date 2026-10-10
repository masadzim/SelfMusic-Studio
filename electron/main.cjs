const { app, BrowserWindow, shell, dialog, ipcMain, session, Menu } = require('electron');
const path = require('node:path');

let mainWindow = null;
const downloads = new Map();
let downloadSeq = 0;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 820,
    minHeight: 620,
    title: 'SelfMusic Studio',
    icon: path.join(__dirname, '..', 'Asset', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      if (url.startsWith('https:')) shell.openExternal(url);
    }
  });

  window.loadFile(path.join(__dirname, '..', 'SelfMusic-Studio.html'));

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
}

function broadcastDownload(record) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('dl:update', {
    id: record.id,
    url: record.url,
    filename: record.filename,
    state: record.state,
    receivedBytes: record.receivedBytes,
    totalBytes: record.totalBytes,
    savePath: record.savePath
  });
}

function pruneDownloads() {
  if (downloads.size <= 60) return;
  const finished = [...downloads.values()].filter((r) =>
    ['completed', 'cancelled', 'interrupted'].includes(r.state)
  );
  for (const r of finished.slice(0, Math.max(0, finished.length - 40))) {
    downloads.delete(r.id);
  }
}

function setupDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const id = 'd' + (++downloadSeq);
    const record = {
      id,
      item,
      url: item.getURL(),
      filename: item.getFilename(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      savePath: null
    };
    downloads.set(id, record);

    item.setSaveDialogOptions({
      title: 'Simpan unduhan',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      buttonLabel: 'Simpan'
    });

    item.on('updated', (e, state) => {
      record.state =
        state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath() || record.savePath;
      broadcastDownload(record);
    });

    item.on('done', (e, state) => {
      record.state = state;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.savePath = item.getSavePath() || record.savePath;
      broadcastDownload(record);
      pruneDownloads();
    });
  });

  ipcMain.handle('dl:start', (event, url) => {
    if (!mainWindow || typeof url !== 'string' || !/^https?:/i.test(url)) return;
    mainWindow.webContents.downloadURL(url);
  });
  ipcMain.handle('dl:pause', (event, id) => {
    const r = downloads.get(id);
    if (r && r.item) r.item.pause();
  });
  ipcMain.handle('dl:resume', (event, id) => {
    const r = downloads.get(id);
    if (r && r.item) r.item.resume();
  });
  ipcMain.handle('dl:cancel', (event, id) => {
    const r = downloads.get(id);
    if (r && r.item) r.item.cancel();
  });
  ipcMain.handle('dl:reveal', (event, savePath) => {
    if (typeof savePath === 'string' && savePath) shell.showItemInFolder(savePath);
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        { label: 'Versi Web', click: () => shell.openExternal('https://adzim.my.id/ai') },
        { label: 'Privasi', click: () => shell.openExternal('https://adzim.my.id/privacy') },
        { type: 'separator' },
        { label: 'Donate', click: () => shell.openExternal('https://adzim.my.id/support') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    console.error('[updater] electron-updater is not available:', error);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error == null ? 'unknown' : (error.stack || error).toString());
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info && info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] no update available');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `SelfMusic Studio ${info.version} has been downloaded.`,
      detail: 'Restart the app to apply the update.'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('[updater] check failed:', error);
  });
}

app.whenReady().then(() => {
  buildMenu();
  setupDownloads();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});