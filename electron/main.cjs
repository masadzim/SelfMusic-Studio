const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');

let mainWindow = null;

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
      sandbox: true
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
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
