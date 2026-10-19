#!/usr/bin/env node
/**
 * Verifikasi pipeline simpan berkas (IPC audio:save) dan handler TTS tanpa
 * membuka dialog OS.
 *
 * Dialog native di Wayland tidak bisa diotomatisasi, jadi dialog-nya yang
 * di-stub; sisanya -- validasi base64, pembersihan nama berkas, ekstensi,
 * uniquePath, penulisan disk, jalur silent, dan jalur error -- dijalankan
 * sungguhan terhadap kode yang sama dengan yang dipakai aplikasi.
 *
 * Jalankan: node scripts/verify-save-pipeline.cjs
 */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-save-test-'));

// --- stub electron ---------------------------------------------------------
const handlers = new Map();
let dialogMode = 'accept';
const dialogCalls = [];

const fakeElectron = {
  app: {
    // Dijalankan sinkron supaya handler IPC terdaftar saat require selesai.
    whenReady: () => ({ then(cb) { cb(); return this; } }),
    on() {},
    isPackaged: false,
    getPath: () => TMP
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = { setWindowOpenHandler() {}, on() {}, send() {}, downloadURL() {} };
    }
    loadFile() {}
    on() {}
    isDestroyed() { return false; }
    show() {}
    focus() {}
    static getAllWindows() { return []; }
  },
  shell: { openExternal() {}, showItemInFolder() {} },
  dialog: {
    showSaveDialog: async (win, opts) => {
      dialogCalls.push({ win, opts });
      if (dialogMode === 'cancel') return { canceled: true };
      if (dialogMode === 'throw') throw new Error('dialog gagal');
      // Dialog asli mengembalikan path absolut apa adanya.
      return { canceled: false, filePath: opts.defaultPath };
    }
  },
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  session: { defaultSession: { on() {} } },
  Menu: { setApplicationMenu() {}, buildFromTemplate: t => t }
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return fakeElectron;
  return origLoad.apply(this, arguments);
};
require(path.join(ROOT, 'electron', 'main.cjs'));
Module._load = origLoad;

const audioSave = handlers.get('audio:save');
assert(audioSave, 'IPC audio:save tidak terdaftar');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const wavBytes = Buffer.alloc(1200, 7);
const b64 = wavBytes.toString('base64');
const call = payload => audioSave({}, payload);

(async () => {
  console.log('=== Pipeline audio:save ===\n');

  await check('menyimpan berkas lewat dialog', async () => {
    const r = await call({ name: 'suara.wav', ext: 'wav', data: b64 });
    assert(r.ok, 'ok harus true');
    assert(r.path.endsWith('suara.wav'), 'path harus nama berkas, dapat ' + r.path);
    assert(fs.existsSync(r.path), 'berkas harus ada di disk');
    assert.strictEqual(fs.readFileSync(r.path).length, wavBytes.length, 'ukuran harus sama');
    assert.strictEqual(dialogCalls.length, 1, 'dialog dipanggil sekali');
    // Window induk ikut dioper supaya dialog jadi modal (main.cjs:setupFileSave).
    assert(dialogCalls[0].win, 'dialog harus punya window induk');
    assert.strictEqual(dialogCalls[0].opts.title, 'Simpan audio');
  });

  await check('dialog memakai nama yang diminta tanpa menimpa diam-diam', async () => {
    const before = dialogCalls.length;
    const r = await call({ name: 'suara.wav', ext: 'wav', data: b64 });
    assert(r.ok, 'harus ok: ' + r.error);
    assert(fs.existsSync(r.path));
    // Dialog bawaan OS yang tugged handle konfirmasi timpa, jadi stub ini
    // mengembalikan defaultPath apa adanya.
    assert.strictEqual(path.basename(dialogCalls[before].opts.defaultPath), 'suara.wav');
  });

  await check('pembatalan dialog diteruskan apa adanya', async () => {
    dialogMode = 'cancel';
    try {
      const r = await call({ name: 'x.wav', ext: 'wav', data: b64 });
      assert.strictEqual(r.canceled, true, 'harus menandai canceled');
      assert.notStrictEqual(r.ok, true, 'tidak boleh ok=true');
    } finally {
      dialogMode = 'accept';
    }
  });

  await check('nama berkas berbahaya dibersihkan', async () => {
    const r = await call({ name: '../../etc/passwd.wav', ext: 'wav', data: b64 });
    assert(!r.path.includes('..'), 'path traversal belum dibersihkan: ' + r.path);
    assert.strictEqual(path.dirname(r.path), TMP, 'harus tetap di folder tujuan');
  });

  await check('karakter terlarang diganti', async () => {
    const r = await call({ name: 'a/b:c*d?.wav', ext: 'wav', data: b64 });
    assert(!/[\\/:*?"<>|]/.test(path.basename(r.path)), 'karakter terlarang tersisa: ' + r.path);
  });

  await check('ekstensi dari payload dipakai untuk filter dialog', async () => {
    const before = dialogCalls.length;
    const r = await call({ name: 'a.exe', ext: 'exe', data: b64 });
    assert(r.path.endsWith('.exe'));
    const opts = dialogCalls[before].opts;
    assert(Array.isArray(opts.filters), 'filter dialog harus diisi');
    assert(opts.filters[0].extensions.includes('exe'), 'filter harus memuat exe');
  });

  await check('simpan otomatis tidak pernah menimpa berkas yang ada', async () => {
    const first = await call({ name: 'unik.wav', ext: 'wav', data: b64, silent: true });
    assert(first.ok, 'penyimpanan senyap pertama: ' + first.error);
    const second = await call({ name: 'unik.wav', ext: 'wav', data: b64, silent: true });
    assert(second.ok, 'penyimpanan senyap kedua: ' + second.error);
    assert(second.path !== first.path, 'nama kedua harus dibedakan, dapat ' + second.path);
    assert(fs.existsSync(first.path) && fs.existsSync(second.path), 'dua-duanya harus ada');
    assert(/unik \(2\)\.wav$/.test(second.path), 'pola nama unik, dapat ' + second.path);
  });

  await check('data base64 tidak valid ditolak', async () => {
    const r = await call({ name: 'b.wav', ext: 'wav', data: 'ini bukan base64!!' });
    assert.strictEqual(r.ok, false);
    assert(/tidak valid/i.test(r.error), 'pesan: ' + r.error);
  });

  await check('audio kosong ditolak', async () => {
    const r = await call({ name: 'c.wav', ext: 'wav', data: '' });
    assert.strictEqual(r.ok, false);
  });

  await check('mode senyap tidak membuka dialog', async () => {
    const before = dialogCalls.length;
    const r = await call({ name: 'd.wav', ext: 'wav', data: b64, silent: true });
    assert(r.ok, 'mode senyap harus langsung menulis');
    assert.strictEqual(dialogCalls.length, before, 'dialog tidak boleh dibuka');
    assert(fs.existsSync(r.path));
  });

  await check('kegagalan dialog jadi error biasa, bukan crash', async () => {
    dialogMode = 'throw';
    try {
      const r = await call({ name: 'e.wav', ext: 'wav', data: b64 });
      assert.strictEqual(r.ok, false);
      assert(typeof r.error === 'string' && r.error.length > 0, 'harus ada pesan error');
    } finally {
      dialogMode = 'accept';
    }
  });

  await check('payload non-objek tidak membuat crash', async () => {
    const r = await call(undefined);
    assert(r.ok === false || r.ok === true, 'harus mengembalikan objek, bukan melempar');
  });

  // --- TTS handlers --------------------------------------------------------
  console.log('\n=== Handler TTS ===');
  const voices = handlers.get('tts:voices');
  const synth = handlers.get('tts:synth');
  const status = handlers.get('tts:status');

  await check('tts:voices terdaftar', () => assert(voices));
  await check('tts:synth terdaftar', () => assert(synth));
  await check('tts:status terdaftar', () => assert(status));

  await check('tts:voices mengembalikan suara Bahasa Indonesia', async () => {
    const r = await voices({}, '');
    assert(r.ok, 'harus ok: ' + r.error);
    assert(r.voices.length >= 1, 'minimal satu suara');
    assert(r.voices[0].lang === 'id', 'bahasa harus id');
  });

  await check('tts:synth menolak naskah kosong', async () => {
    const r = await synth({}, { text: '', style: 'netral' });
    assert.strictEqual(r.ok, false);
  });

  await check('tts:synth menghasilkan WAV yang valid', async () => {
    const r = await synth({}, { text: 'Halo, ini uji.', style: 'netral' });
    assert(r.ok, 'harus ok: ' + r.error);
    assert.strictEqual(r.ext, 'wav');
    const buf = Buffer.from(r.data, 'base64');
    assert.strictEqual(buf.slice(0, 4).toString(), 'RIFF', 'header harus RIFF');
    assert.strictEqual(buf.slice(8, 12).toString(), 'WAVE', 'header harus WAVE');
    assert.strictEqual(buf.readUInt32LE(24), r.sampleRate, 'sample rate harus konsisten');
    assert(r.durationSec > 0.5, 'durasi harus wajar: ' + r.durationSec);
  });

  await check('length_scale memetakan gaya bicara dengan benar', async () => {
    const netral = await synth({}, { text: 'Halo, uji kecepatan suara perangkat.', style: 'netral' });
    const tenang = await synth({}, { text: 'Halo, uji kecepatan suara perangkat.', style: 'tenang' });
    const semangat = await synth({}, { text: 'Halo, uji kecepatan suara perangkat.', style: 'semangat' });
    assert(tenang.ok && semangat.ok, 'semua harus berhasil');
    assert(tenang.durationSec > netral.durationSec,
      `tenang (${tenang.durationSec}s) harus lebih panjang dari netral (${netral.durationSec}s)`);
    assert(semangat.durationSec < netral.durationSec,
      `semangat (${semangat.durationSec}s) harus lebih pendek dari netral (${netral.durationSec}s)`);
  });

  await check('tts:status melaporkan engine dan peta length_scale', async () => {
    const st = await status({}, '');
    assert(st.ok, 'status harus ok');
    assert(['system', 'bundled', 'override'].includes(st.engine), 'engine: ' + st.engine);
    assert(st.styleScale.tenang > st.styleScale.netral, 'tenang harus lebih lambat');
    assert.deepStrictEqual(Object.keys(st.styleScale).sort(), ['netral', 'semangat', 'tenang'],
      'peta gaya bicara harus tepat 3 kunci, dapat ' + Object.keys(st.styleScale).join(','));
    assert(st.styleScale.netral === 1, 'netral harus 1');
    assert(st.styleScale.tenang > 1, 'tenang harus lebih lambat');
    assert(st.styleScale.semangat < st.styleScale.netral, 'semangat harus lebih cepat');
  });

  await check('lokasi eSpeak ng yang salah ditolak dengan pesan jelas', async () => {
    const r = await voices({}, '/tidak/ada/espeak-ng');
    if (r.ok) {
      // mungkin ada eSpeak sistem yang dipakai, itu perilaku yang diizinkan
      assert(r.source !== 'override', 'harus pindah ke sumber lain, bukan memakai override');
    } else {
      assert(typeof r.error === 'string' && r.error.length > 0, 'harus ada pesan error');
    }
  });

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
