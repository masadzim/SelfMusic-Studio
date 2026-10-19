/**
 * Offline text-to-speech engine: eSpeak NG (phonemizer) + Piper (neural VITS).
 *
 * eSpeak NG is GPL-3.0 and its data files are part of that same license; the
 * Piper voice model and onnxruntime-node are MIT. The distributed application is
 * therefore GPL-3.0-or-later. See THIRD-PARTY-NOTICES.md.
 *
 * The phoneme pipeline mirrors OHF-Voice/piper1-gpl:
 *   phonemize_espeak.py (clause handling + NFD), phoneme_ids.py (ids),
 *   const.py (PAD/BOS/EOS), voice.py (ONNX inputs).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Piper special tokens -- src/piper/const.py
const PAD = '_';
const BOS = '^';
const EOS = '$';

// espeakNG --ipa level 2 matches piper's espeak_Initialize(..., espeakPHONEMES_IPA)
// with no espeakINITIALIZE_PHONEME_IPA level set (its default). Level 3 emits
// ZWJ (U+200D), which is absent from phoneme_id_map; level 1 emits "_"
// separators that collide with PAD.
const IPA_LEVEL = '2';

const EXEC_TIMEOUT = 4000;
const MAX_OUTPUT_MB = 180;

// vstyle from the UI mapped onto piper's length_scale (smaller = faster).
const STYLE_LENGTH_SCALE = { netral: 1.0, tenang: 1.15, semangat: 0.87 };

function lengthScaleFor(style) {
  return Object.prototype.hasOwnProperty.call(STYLE_LENGTH_SCALE, style)
    ? STYLE_LENGTH_SCALE[style]
    : STYLE_LENGTH_SCALE.netral;
}

/* ------------------------------------------------------------------ *
 * Locating assets -- packaged (resources/tts) and dev (<repo>/resources/tts)
 * ------------------------------------------------------------------ */

function assetRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'tts'));
  roots.push(path.join(__dirname, '..', 'resources', 'tts'));
  return roots;
}

function findAsset(...parts) {
  for (const root of assetRoots()) {
    const p = path.join(root, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// espeak-ng-data sits in different places depending on distro and packaging.
// The two bundled layouts disagree by one level: unix keeps the binary in
// bin/ with the data beside that, Windows puts both in the platform directory.
function dataDirCandidates(binPath) {
  const dir = path.dirname(binPath);
  const plat = path.dirname(dir);
  return [
    path.join(dir, 'espeak-ng-data'),
    path.join(plat, 'espeak-ng-data'),
    path.join(dir, '..', 'share', 'espeak-ng-data'),
    '/usr/share/espeak-ng-data',
    '/usr/lib/x86_64-linux-gnu/espeak-ng-data',
    '/usr/local/share/espeak-ng-data'
  ];
}

function findDataFor(binPath) {
  for (const d of dataDirCandidates(binPath)) {
    try {
      if (fs.statSync(d).isDirectory()) return d;
    } catch {}
  }
  return null;
}

/**
 * Path of the bundled engine, relative to resources/tts.
 *
 * Only the last segment is a file: the Windows layout puts espeak-ng.exe
 * straight in the platform directory, while the unix layout keeps it in bin/.
 * Spelling both branches as one call once made Windows look for
 * espeak/win32/espeak-ng.exe/espeak-ng.exe, which silently disables the engine.
 */
function bundledEngineParts(platform, arch) {
  return platform === 'win32'
    ? ['espeak', 'win32', 'espeak-ng.exe']
    : ['espeak', `${platform}-${arch}`, 'bin', 'espeak-ng'];
}

/**
 * Resolve eSpeak in the order requested: user override, then a system install,
 * then the copy bundled with the app.
 */
function resolveEspeak(override) {
  const candidates = [];
  if (typeof override === 'string' && override.trim()) {
    const bin = override.trim();
    candidates.push({ bin, data: findDataFor(bin), source: 'override' });
  }

  const bins = [];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const isWin = process.platform === 'win32';
  for (const name of (isWin ? ['espeak-ng.exe', 'espeak.exe'] : ['espeak-ng', 'espeak'])) {
    for (const dir of pathDirs) bins.push(path.join(dir, name));
    bins.push(path.join('/usr/bin', name), path.join('/usr/local/bin', name), path.join('/bin', name));
  }
  for (const bin of bins) {
    if (fs.existsSync(bin)) candidates.push({ bin, data: findDataFor(bin), source: 'system' });
  }

  const bundled = findAsset(...bundledEngineParts(process.platform, process.arch));
  if (bundled) candidates.push({ bin: bundled, data: findDataFor(bundled), source: 'bundled' });

  // A system binary with no data directory is useless; the bundled pair is
  // guaranteed complete, so it wins on ties.
  return candidates.find(c => c.data) || candidates[0] || null;
}

function resolveModel() {
  return findAsset('models', 'id_ID-news_tts-medium.onnx');
}

function resolveModelConfig() {
  return findAsset('models', 'id_ID-news_tts-medium.onnx.json');
}

/* ------------------------------------------------------------------ *
 * eSpeak phonemization
 * ------------------------------------------------------------------ */

function runEspeak(espeak, args, input) {
  const res = spawnSync(espeak.bin, args, {
    input,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    timeout: EXEC_TIMEOUT,
    windowsHide: true
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = String(res.stderr || '').trim();
    throw new Error(`eSpeak gagal (exit ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res.stdout || '';
}

function espeakArgs(espeak, ...rest) {
  const args = [];
  if (espeak.data) args.push('--path', espeak.data);
  args.push(...rest);
  return args;
}

/**
 * Split text into sentences, keeping the terminator so punctuation reaches the
 * model -- phoneme_id_map contains . , ! ? ; : and questions still rise in pitch.
 */
function splitSentences(text) {
  const out = [];
  let buf = '';
  for (const ch of String(text)) {
    buf += ch;
    if ('.!?。！？'.includes(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// Drop espeak's (lang) switch flags, then NFD-normalize so combining marks
// become standalone tokens -- phoneme_id_map lists ̃ ̪ ̯ separately from their
// base letters. Matches phonemize_espeak.py.
function normalizePhonemes(s) {
  return s.replace(/\([^)]+\)/g, '').normalize('NFD').replace(/\s+/g, ' ').trim();
}

/** One espeak call per sentence: keeps the clause->sentence mapping exact. */
function phonemizeSentence(espeak, sentence) {
  const raw = runEspeak(espeak, espeakArgs(espeak, '-v', 'id', '-q', `--ipa=${IPA_LEVEL}`), sentence);
  const body = normalizePhonemes(raw.split('\n').map(s => s.trim()).filter(Boolean).join(' '));
  if (!body) return '';
  const terminator = sentence.match(/[.!?。！？]$/)?.[0] || '';
  return terminator ? body + terminator : body;
}

function phonemize(espeak, text) {
  return splitSentences(text)
    .map(s => phonemizeSentence(espeak, s))
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Piper inference
 * ------------------------------------------------------------------ */

let sessionPromise = null;
let configCache = null;

function loadConfig() {
  if (configCache) return configCache;
  const p = resolveModelConfig();
  if (!p) throw new Error('Model Piper tidak ditemukan (id_ID-news_tts-medium.onnx.json).');
  configCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  return configCache;
}

function loadSession() {
  if (!sessionPromise) {
    const p = resolveModel();
    if (!p) throw new Error('Model Piper tidak ditemukan (id_ID-news_tts-medium.onnx).');
    let ort;
    try {
      ort = require('onnxruntime-node');
    } catch (e) {
      throw new Error('Modul onnxruntime-node tidak tersedia: ' + (e.message || e));
    }
    sessionPromise = ort.InferenceSession.create(p).catch(err => {
      sessionPromise = null;
      throw new Error('Gagal memuat model Piper: ' + ((err && err.message) || err));
    });
  }
  return sessionPromise;
}

// phoneme_ids.py:phonemes_to_ids
function phonemesToIds(phonemes, idMap) {
  const ids = [idMap[BOS][0], idMap[PAD][0]];
  for (const p of phonemes) {
    const hit = idMap[p];
    if (!hit) continue; // reference implementation skips phonemes missing from the map
    ids.push(hit[0], idMap[PAD][0]);
  }
  ids.push(idMap[EOS][0]);
  return ids;
}

function synthSentence(session, ort, cfg, phonemes, lengthScale) {
  const ids = phonemesToIds([...phonemes], cfg.phoneme_id_map);
  const input = BigInt64Array.from(ids.map(BigInt));

  return session.run({
    input: new ort.Tensor('int64', input, [1, input.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(input.length)]), [1]),
    scales: new ort.Tensor('float32', new Float32Array([
      cfg.inference.noise_scale,
      lengthScale,
      cfg.inference.noise_w
    ]), [3])
  }).then(res => {
    let audio = res[session.outputNames[0]].data;
    if (audio.length && audio[0] && audio[0].length !== undefined) audio = audio[0];
    return Float32Array.from(audio);
  });
}

/** Mono 16-bit PCM -> WAV (RIFF, 44-byte header). */
function pcmToWav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);            // block align
  buf.writeUInt16LE(16, 34);           // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

// voice.py:synthesize -- peak-normalize, then clip to [-1, 1]
function normalizeToInt16(parts) {
  const total = parts.reduce((n, a) => n + a.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const a of parts) {
    let peak = 0;
    for (const v of a) { const x = Math.abs(v); if (x > peak) peak = x; }
    const norm = peak < 1e-8 ? 0 : 1 / peak;
    for (const v of a) {
      const c = Math.max(-1, Math.min(1, v * norm));
      out[off++] = Math.round(c * 32767);
    }
  }
  return out;
}

function encodeWav(parts, sampleRate) {
  const pcm = normalizeToInt16(parts);
  const wav = pcmToWav(pcm, sampleRate);
  if (wav.length > MAX_OUTPUT_MB * 1024 * 1024) {
    throw new Error(
      `Audio ${(wav.length / 1048576).toFixed(0)} MB terlalu besar untuk dialog simpan (maks ${MAX_OUTPUT_MB} MB).`
    );
  }
  return { wav, samples: pcm.length };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function listVoices(espeakOverride) {
  const espeak = resolveEspeak(espeakOverride);
  if (!espeak) {
    return { ok: false, error: 'Mesin suara offline (eSpeak NG) tidak ditemukan.', voices: [] };
  }
  if (!espeak.data) {
    return { ok: false, error: `Data eSpeak NG tidak ditemukan untuk ${espeak.bin}.`, voices: [] };
  }

  let stdout;
  try {
    // Colums: Prio | Language | Age/Gender | VoiceName | File | Other Languages
    stdout = runEspeak(espeak, espeakArgs(espeak, '--voices=id'), '');
  } catch (e) {
    return { ok: false, error: 'Gagal membaca daftar suara: ' + (e.message || e), voices: [] };
  }

  const voices = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || /^Pty\b/i.test(t)) continue;
    const col = t.split(/\s+/);
    if (col.length < 5) continue;
    const [prio, lang, , name, rawFile] = col;
    if (lang !== 'id') continue;
    // The File column points at an optional variant file that espeak runs
    // perfectly well without (Indonesian itself reports "poz/id", which no
    // install ships). What genuinely needs skipping are the mbrola voices:
    // they shell out to a phoneme synthesizer we do not bundle.
    const file = rawFile.replace(/\\/g, '/');
    if (/^mb\//.test(file) || /mbrola/i.test(name)) continue;
    voices.push({
      id: lang,
      name: name === 'Indonesian' ? 'Bahasa Indonesia' : `Bahasa Indonesia · ${name}`,
      lang,
      priority: Number(prio) || 0
    });
  }
  voices.sort((a, b) => b.priority - a.priority);
  if (!voices.length) voices.push({ id: 'id', name: 'Bahasa Indonesia', lang: 'id', priority: 0 });

  return { ok: true, voices, source: espeak.source, binary: espeak.bin };
}

async function synthesize({ text, style, espeakOverride } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'Naskah kosong.' };
  }

  const espeak = resolveEspeak(espeakOverride);
  if (!espeak) {
    return { ok: false, error: 'Mesin suara offline (eSpeak NG) tidak ditemukan. Gunakan penyedia API atau pasang eSpeak NG.' };
  }
  if (!espeak.data) {
    return { ok: false, error: `Data eSpeak NG tidak ditemukan untuk ${espeak.bin}.` };
  }

  let cfg, session;
  try {
    cfg = loadConfig();
    session = await loadSession();
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  let sentences;
  try {
    sentences = phonemize(espeak, text);
  } catch (e) {
    return { ok: false, error: 'Fonemisasi gagal: ' + (e.message || e) };
  }
  if (!sentences.length) {
    return { ok: false, error: 'Naskah ini tidak menghasilkan fonem yang bisa disintesis.' };
  }

  const ort = require('onnxruntime-node');
  const lengthScale = lengthScaleFor(style);
  const parts = [];
  try {
    for (const sentence of sentences) {
      parts.push(await synthSentence(session, ort, cfg, sentence, lengthScale));
    }
    const { wav, samples } = encodeWav(parts, cfg.audio.sample_rate);
    return {
      ok: true,
      data: wav.toString('base64'),
      ext: 'wav',
      sampleRate: cfg.audio.sample_rate,
      sentences: sentences.length,
      durationSec: Number((samples / cfg.audio.sample_rate).toFixed(2)),
      source: espeak.source
    };
  } catch (e) {
    return { ok: false, error: 'Sintesis gagal: ' + (e.message || e) };
  }
}

/** Load the model ahead of time so the first generate is not noticeably slower. */
async function warmup() {
  try {
    await loadSession();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  listVoices,
  synthesize,
  warmup,
  resolveEspeak,
  resolveModel,
  lengthScaleFor,
  bundledEngineParts,
  findDataFor,
  STYLE_LENGTH_SCALE,
  MAX_OUTPUT_MB
};
