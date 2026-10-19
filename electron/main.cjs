const { app, BrowserWindow, shell, dialog, ipcMain, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const tts = require('./tts.cjs');

let mainWindow = null;
const downloads = new Map();
let downloadSeq = 0;
let lastSaveDir = null;

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
    const appFile = path.join(__dirname, '..', 'SelfMusic-Studio.html');
    if (url.startsWith('file:') && path.resolve(decodeURIComponent(new URL(url).pathname)) === path.resolve(appFile)) return;
    event.preventDefault();
    if (url.startsWith('https:')) shell.openExternal(url);
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

const AUDIO_FILTERS = {
  mp3: ['Audio MP3', 'mp3'],
  mpeg: ['Audio MP3', 'mp3'],
  wav: ['Audio WAV', 'wav'],
  webm: ['Audio WebM', 'webm'],
  ogg: ['Audio OGG', 'ogg'],
  opus: ['Audio Opus', 'opus'],
  m4a: ['Audio M4A', 'm4a'],
  flac: ['Audio FLAC', 'flac']
};

function safeExt(value) {
  const ext = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || 'mp3';
}

function safeName(value) {
  const name = path
    .basename(String(value || ''))
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim();
  if (!name || name === '.' || name === '..') return 'suara.mp3';
  return name;
}

function audioFilters(ext) {
  const hit = AUDIO_FILTERS[ext];
  return [
    { name: hit ? hit[0] : 'Audio', extensions: [hit ? hit[1] : ext] },
    { name: 'Semua berkas', extensions: ['*'] }
  ];
}

function uniquePath(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const base = name.replace(/\.[^.]+$/, '');
  const ext = path.extname(name) || '.mp3';
  let n = 1;
  do {
    target = path.join(dir, `${base} (${++n})${ext}`);
  } while (fs.existsSync(target));
  return target;
}

function saveDir() {
  if (lastSaveDir) {
    try {
      if (fs.statSync(lastSaveDir).isDirectory()) return lastSaveDir;
    } catch {}
  }
  return app.getPath('downloads');
}

async function writeAudio(filePath, data) {
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    return { ok: false, error: 'Data audio tidak valid.' };
  }
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) return { ok: false, error: 'Data audio kosong.' };
  await fsp.writeFile(filePath, buf);
  return { ok: true, path: filePath, name: path.basename(filePath), size: buf.length };
}

function setupFileSave() {
  ipcMain.handle('audio:save', async (event, payload) => {
    try {
      const p = payload || {};
      const name = safeName(p.name);
      const ext = safeExt(p.ext || name.split('.').pop());
      const dir = saveDir();

      let filePath;
      if (p.silent) {
        // Simpan tanpa dialog, ke folder terakhir (atau Downloads).
        await fsp.mkdir(dir, { recursive: true });
        filePath = uniquePath(dir, name);
      } else {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        const res = await dialog.showSaveDialog(win, {
          title: 'Simpan audio',
          defaultPath: path.join(dir, name),
          buttonLabel: 'Simpan',
          filters: audioFilters(ext)
        });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        filePath = res.filePath;
      }

      const out = await writeAudio(filePath, p.data);
      if (out.ok) lastSaveDir = path.dirname(filePath);
      return out;
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'Gagal menyimpan file.' };
    }
  });
}

/* ---------- Offline TTS (eSpeak NG + Piper) ---------- */
function setupTts() {
  ipcMain.handle('tts:voices', (event, override) => {
    try {
      return tts.listVoices(typeof override === 'string' ? override : undefined);
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'Gagal membaca daftar suara.', voices: [] };
    }
  });

  ipcMain.handle('tts:synth', async (event, payload) => {
    try {
      const p = payload || {};
      return await tts.synthesize({
        text: typeof p.text === 'string' ? p.text : '',
        style: typeof p.style === 'string' ? p.style : 'netral',
        espeakOverride: typeof p.espeakOverride === 'string' ? p.espeakOverride : undefined
      });
    } catch (error) {
      return { ok: false, error: (error && error.message) || 'Sintesis suara gagal.' };
    }
  });

  ipcMain.handle('tts:status', (event, override) => {
    const espeak = tts.resolveEspeak(typeof override === 'string' ? override : undefined);
    const model = tts.resolveModel();
    return {
      ok: !!(espeak && espeak.data && model),
      engine: espeak ? espeak.source : 'none',
      binary: espeak ? espeak.bin : null,
      dataDir: espeak ? espeak.data : null,
      model: model || null,
      styleScale: tts.STYLE_LENGTH_SCALE,
      maxMb: tts.MAX_OUTPUT_MB
    };
  });

  // Muat model sekali saat app siap supaya generate pertama tidak lambat.
  tts.warmup().then(ok => {
    if (ok) console.log('[tts] model Piper siap');
    else console.warn('[tts] model Piper tidak termuat — suara perangkat akan lazily dimuat');
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
  setupFileSave();
  setupTts();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});