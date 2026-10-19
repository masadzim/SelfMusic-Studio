#!/usr/bin/env node
/**
 * Fetch the offline TTS assets into resources/tts/:
 *   - Piper voice model id_ID-news_tts-medium  (MIT, ~60 MB)
 *   - eSpeak NG binary + library + data         (GPL-3.0)
 *
 * Linux   : unpacked from the distro .deb packages (no root, no compilation).
 * Windows : laid out from the official espeak-ng.msi, plus the MSVC runtime
 *           DLLs the binary imports (needs wine or msiextract).
 * macOS   : from Homebrew bottles, relocated and ad-hoc re-signed.
 *
 * Usage:
 *   node scripts/prepare-tts-assets.mjs          fetch anything missing
 *   node scripts/prepare-tts-assets.mjs --check  verify only (used by build)
 *   node scripts/prepare-tts-assets.mjs --force  re-fetch everything
 *   node scripts/prepare-tts-assets.mjs --platform darwin-arm64
 *   node scripts/prepare-tts-assets.mjs --platform win32-x64
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, chmodSync, cpSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TTS = path.join(ROOT, 'resources', 'tts');
const MODELS = path.join(TTS, 'models');
const ESPEAK = path.join(TTS, 'espeak');

const MODEL_FILES = [
  ['id_ID-news_tts-medium.onnx',
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx'],
  ['id_ID-news_tts-medium.onnx.json',
    'https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json']
];

// Distro packages that provide the binary, the shared library and the data tree.
const ESPEAK_DEBS = ['espeak-ng', 'libespeak-ng1', 'espeak-ng-data'];

// Upstream ships no win64 archive -- only an MSI installer, so it gets laid out
// with an administrative install instead.
const ESPEAK_MSI = 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi';

// espeak-ng.exe is built with MSVC and imports MSVCP140/VCRUNTIME140, which a
// clean Windows does not ship. The redistributable DLLs are what the official
// VC++ redistributable installs, and the msvc-runtime wheel is nothing but a
// zip of them, so no installer has to run on the build machine.
const MSVC_RUNTIME_PYPI = 'https://pypi.org/pypi/msvc-runtime/json';
const VC_DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');
const PLATFORM = (() => {
  const i = args.indexOf('--platform');
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();
const isWin = PLATFORM ? PLATFORM.startsWith('win32') : process.platform === 'win32';
const isMac = PLATFORM ? PLATFORM.startsWith('darwin') : process.platform === 'darwin';
const forcedArch = PLATFORM ? PLATFORM.split('-').pop() : null;

let problems = 0;
const fail = m => { problems++; console.error('  ! ' + m); };
const ok = m => console.log('  ✓ ' + m);

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

async function fetchModels() {
  mkdirSync(MODELS, { recursive: true });
  for (const [name, url] of MODEL_FILES) {
    const dest = path.join(MODELS, name);
    if (existsSync(dest) && !FORCE && statSync(dest).size > 1024) { ok(`model ${name} (${mb(statSync(dest).size)})`); continue; }
    if (CHECK) { fail(`model ${name} belum ada`); continue; }
    process.stdout.write(`  … mengunduh ${name}\n`);
    await download(url, dest);
    ok(`model ${name} (${mb(statSync(dest).size)})`);
  }
}

async function fetchEspeak() {
  mkdirSync(ESPEAK, { recursive: true });
  if (isWin) return fetchEspeakWindows();
  if (isMac) return fetchEspeakMac(forcedArch || process.arch);

  // Native arch directory, mirroring what electron/tts.cjs looks for.
  const sub = `${process.platform}-${process.arch}`;
  const dest = path.join(ESPEAK, sub);
  const bin = path.join(dest, 'bin', 'espeak-ng');
  const data = path.join(dest, 'espeak-ng-data');

  if (existsSync(bin) && existsSync(data) && !FORCE) {
    ok(`eSpeak ${sub} (${mb(dirSize(dest))})`);
    return;
  }
  if (CHECK) { fail(`eSpeak ${sub} belum ada`); return; }

  const tmp = fs_tmp();
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('apt-get', ['download', ...ESPEAK_DEBS], { cwd: tmp, stdio: 'inherit' });
    const root = path.join(tmp, 'root');
    mkdirSync(root, { recursive: true });
    for (const deb of readdirSync(tmp).filter(f => f.endsWith('.deb'))) {
      execFileSync('dpkg-deb', ['-x', path.join(tmp, deb), root]);
    }
    const libDir = path.join(root, 'usr', 'lib', 'x86_64-linux-gnu');
    const srcData = path.join(libDir, 'espeak-ng-data');
    if (!existsSync(path.join(root, 'usr', 'bin', 'espeak-ng')) || !existsSync(srcData)) {
      throw new Error('struktur paket .deb tidak seperti yang diharapkan');
    }

    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.join(dest, 'bin'), { recursive: true });
    mkdirSync(path.join(dest, 'lib'), { recursive: true });
    cpSync(path.join(root, 'usr', 'bin', 'espeak-ng'), path.join(dest, 'bin', 'espeak-ng'));
    // Copy through the symlink so the loader finds the real file next to the binary.
    cpSync(path.join(libDir, 'libespeak-ng.so.1'), path.join(dest, 'lib', 'libespeak-ng.so.1'), { dereference: true });
    cpSync(srcData, data, { recursive: true });
    chmodSync(bin, 0o755);
    ok(`eSpeak ${sub} (${mb(dirSize(dest))})`);
  } catch (e) {
    fail(`gagal menyiapkan eSpeak: ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function fetchEspeakMac(arch) {
  const sub = `darwin-${arch}`;
  const dest = path.join(ESPEAK, sub);
  const bin = path.join(dest, 'bin', 'espeak-ng');
  const lib = path.join(dest, 'lib', 'libespeak-ng.1.dylib');
  const data = path.join(dest, 'espeak-ng-data');

  if (existsSync(bin) && existsSync(lib) && existsSync(data) && !FORCE) {
    ok(`eSpeak ${sub} (${mb(dirSize(dest))})`);
    return;
  }
  if (CHECK) { fail(`eSpeak ${sub} belum ada`); return; }

  const tmp = fs_tmp();
  mkdirSync(tmp, { recursive: true });
  try {
    // Homebrew bottles for espeak-ng and its pcaudiolib dependency.
    const tag = arch === 'arm64' ? 'arm64_sonoma' : 'sonoma';
    const wanted = ['espeak-ng', 'pcaudiolib'];

    const root = path.join(tmp, 'root');
    mkdirSync(root, { recursive: true });
    for (const formula of wanted) {
      const tgz = path.join(tmp, `${formula}.tar.gz`);
      process.stdout.write(`  … mengunduh bottle ${formula} (${tag})\n`);
      await downloadBottle(formula, tgz, tag);
      const into = path.join(tmp, formula);
      mkdirSync(into, { recursive: true });
      execFileSync('tar', ['xzf', tgz, '-C', into], { stdio: 'inherit' });
      cpSync(into, root, { recursive: true, recursive: true });
    }

    const cellars = Object.fromEntries(
      readdirSync(root).map(f => {
        const versions = readdirSync(path.join(root, f));
        return [f, path.join(root, f, versions[0])];
      })
    );
    const esp = cellars['espeak-ng'];
    const pca = cellars['pcaudiolib'];
    if (!esp || !pca) throw new Error('bottle tidak memuat Cellar yang diharapkan');

    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.join(dest, 'bin'), { recursive: true });
    mkdirSync(path.join(dest, 'lib'), { recursive: true });

    // Bottle files come out read-only; we need to write into them to relocate.
    const take = (src, into) => {
      chmodSync(src, 0o755);
      cpSync(src, into);
      chmodSync(into, 0o755);
      return into;
    };

    take(path.join(esp, 'bin', 'espeak-ng'), path.join(dest, 'bin', 'espeak-ng'));
    take(path.join(esp, 'lib', 'libespeak-ng.1.dylib'), path.join(dest, 'lib', 'libespeak-ng.1.dylib'));
    take(path.join(pca, 'lib', 'libpcaudio.0.dylib'), path.join(dest, 'lib', 'libpcaudio.0.dylib'));
    cpSync(path.join(esp, 'share', 'espeak-ng-data'), data, { recursive: true });

    // Homebrew rewrites load paths at install time; an extracted bottle still
    // points at the literal @@HOMEBREW_*@@ placeholders, so the binaries would
    // not start. Point the executable at ../lib and the dylibs at their siblings.
    const exe = path.join(dest, 'bin', 'espeak-ng');
    const dylibs = [
      path.join(dest, 'lib', 'libespeak-ng.1.dylib'),
      path.join(dest, 'lib', 'libpcaudio.0.dylib')
    ];
    let patched = relocateMachO(exe, '@executable_path/../lib/');
    for (const f of dylibs) patched += relocateMachO(f, '@loader_path/');
    if (!patched) throw new Error('tidak menemukan penanda @@HOMEBREW@@ untuk dipatch');

    // Moving or editing a Mach-O invalidates its signature, and macOS refuses to
    // run unsigned binaries. Re-sign ad-hoc; a Developer ID plus notarisation is
    // still needed to ship this to other people's machines (see BUILD.md).
    if (process.platform === 'darwin') {
      for (const f of [...dylibs, exe]) {
        execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', f], { stdio: 'ignore' });
      }
      ok('tanda tangan ad-hoc ditambahkan');
    } else {
      console.log('  ℹ tanda tangan dilewati (hanya bisa di macOS; build .app harus dari macOS)');
    }

    ok(`eSpeak ${sub} (${mb(dirSize(dest))}, ${patched} load path dipatch)`);
  } catch (e) {
    fail(`gagal menyiapkan eSpeak macOS: ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Pull a bottle from ghcr.io; it needs a pull token first. */
async function downloadBottle(formula, dest, tag) {
  const repo = `homebrew/core/${formula}`;
  const tokenRes = await fetch(
    `https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io`);
  if (!tokenRes.ok) throw new Error(`token bottle ${formula}: HTTP ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  if (!token) throw new Error(`token bottle ${formula} kosong`);

  const meta = await (await fetch(`https://formulae.brew.sh/api/formula/${formula}.json`)).json();
  const want = tag || (process.arch === 'arm64' ? 'arm64_sonoma' : 'sonoma');
  const file = meta.bottle?.stable?.files?.[want] || meta.bottle?.stable?.files?.[want.replace('arm64_', '')];
  if (!file) {
    throw new Error(`bottle ${want} tidak tersedia untuk ${formula} (ada: ${Object.keys(meta.bottle?.stable?.files || {}).join(', ')})`);
  }

  const res = await fetch(file.url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`unduh bottle ${formula}: HTTP ${res.status}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

/**
 * Rewrite every @@HOMEBREW_CELLAR@@ / @@HOMEBREW_PREFIX@@ load path so the
 * binaries start outside Homebrew. Mach-O load commands hold a NUL-terminated C
 * string, so a *shorter* replacement is safe: the leftover bytes sit after the
 * terminator and are never read. A longer one would corrupt the binary, so that
 * case is reported instead of attempted.
 *
 * @param {string} file    Mach-O file to patch
 * @param {string} prefix  '@executable_path/../lib/' for the binary (its dylibs
 *                         live in ../lib), '@loader_path/' for the dylibs
 * @returns {number} jumlah load path yang dipatch
 */
function relocateMachO(file, prefix) {
  const buf = readFileSync(file);
  const text = buf.toString('latin1');
  const re = /@@HOMEBREW_(?:CELLAR|PREFIX)@@[\x20-\x7e]*?\.dylib/g;
  let count = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const at = m.index;                     // real byte offset of this load path
    const replacement = prefix + path.posix.basename(m[0]);
    if (replacement.length > m[0].length) {
      console.warn(`    ! tidak bisa dipatch in-place (terlalu panjang): ${m[0]}`);
      re.lastIndex = at + m[0].length;
      continue;
    }
    // Zero the shorter replacement plus its terminator. The tail of the old
    // string stays put but sits past the NUL, so dyld never reads it.
    buf.fill(0, at, at + replacement.length + 1);
    buf.write(replacement, at, 'latin1');
    count++;
    re.lastIndex = at + replacement.length + 1;
  }
  if (count) writeFileSync(file, buf);
  return count;
}

/** Lay an MSI out on disk. Returns false when no extractor is available. */
function unpackMsi(msi, out, tmp) {
  // Windows already ships the extractor we need.
  if (process.platform === 'win32') {
    spawnSync('msiexec', ['/a', msi, `TARGETDIR=${out}`, '/qn'], { encoding: 'utf8', timeout: 300000, windowsHide: true });
    return existsSync(out);
  }

  if (spawnSync('msiextract', ['-C', out, msi], { encoding: 'utf8' }).status === 0) {
    return existsSync(out);
  }
  if (spawnSync('wine', ['--version'], { encoding: 'utf8', timeout: 60000 }).status !== 0) return false;

  // Wine maps the unix root to Z:, and msiexec will not accept a unix path.
  const z = p => 'Z:' + p.split(path.sep).join('\\');
  // A throwaway prefix: the developer's own wine setup is none of our business.
  const r = spawnSync(
    'wine',
    ['msiexec', '/a', z(msi), `TARGETDIR=${z(out)}`, '/qn'],
    { encoding: 'utf8', timeout: 300000, env: { ...process.env, WINEPREFIX: path.join(tmp, 'wineprefix'), WINEDEBUG: '-all' } }
  );
  // Wine's exit code is unreliable for msiexec; a missing extraction is the
  // real signal, so check the output instead of trusting the status.
  return r.status === 0 && existsSync(out);
}

/** Unpack a zip. Uses the system `unzip`, or PowerShell where there is none. */
function unzipInto(archive, dest) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`],
      { encoding: 'utf8', timeout: 300000, windowsHide: true }
    );
    return ps.status === 0;
  }
  const r = spawnSync('unzip', ['-q', '-o', archive, '-d', dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('unzip gagal: ' + (r.stderr || '').trim());
  return true;
}

/** Copy the MSVC runtime DLLs next to espeak-ng.exe. */
async function fetchVCRuntime(tmp, dest) {
  const meta = await (await fetch(MSVC_RUNTIME_PYPI, { redirect: 'follow' })).json();
  const wheel = (meta.urls || []).find(u => /win_amd64\.whl$/.test(u.filename) && !/cp3(1[01])-/.test(u.filename));
  if (!wheel) throw new Error('roda win_amd64 untuk msvc-runtime tidak ditemukan di PyPI');

  const whl = path.join(tmp, 'msvc.whl');
  process.stdout.write('  … mengunduh runtime MSVC\n');
  await download(wheel.url, whl);

  const vc = path.join(tmp, 'vc');
  mkdirSync(vc, { recursive: true });
  unzipInto(whl, vc);

  for (const name of VC_DLLS) {
    let src = null;
    for (const entry of readdirSync(vc, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cand = path.join(vc, entry.name, 'data', name);
      const candScripts = path.join(vc, entry.name, 'data', 'Scripts', name);
      if (existsSync(cand)) { src = cand; break; }
      if (existsSync(candScripts)) { src = candScripts; break; }
    }
    if (!src) throw new Error(`${name} tidak ada di roda msvc-runtime`);
    cpSync(src, path.join(dest, name));
  }
}

async function fetchEspeakWindows() {
  const dest = path.join(ESPEAK, 'win32');
  const bin = path.join(dest, 'espeak-ng.exe');
  const data = path.join(dest, 'espeak-ng-data');
  const complete = existsSync(bin) && existsSync(data) && VC_DLLS.every(d => existsSync(path.join(dest, d)));
  if (complete && !FORCE) { ok(`eSpeak win32 (${mb(dirSize(dest))})`); return; }
  if (CHECK) { fail('eSpeak win32 belum ada'); return; }

  const tmp = fs_tmp();
  mkdirSync(tmp, { recursive: true });
  try {
    process.stdout.write('  … mengunduh espeak-ng.msi\n');
    const msi = path.join(tmp, 'espeak-ng.msi');
    await download(ESPEAK_MSI, msi);

    const admin = path.join(tmp, 'admin');
    mkdirSync(admin, { recursive: true });
    if (!unpackMsi(msi, admin, tmp)) {
      throw new Error('tidak ada msiextract atau wine untuk membongkar MSI');
    }

    // The administrative install nests the payload one directory deep, named
    // after the product ("eSpeak NG").
    let src = null;
    for (const entry of readdirSync(admin, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(admin, entry.name, 'espeak-ng.exe'))) {
        src = path.join(admin, entry.name);
        break;
      }
    }
    if (!src) throw new Error('isi MSI tidak memuat espeak-ng.exe');

    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(path.join(src, 'espeak-ng.exe'), bin);
    cpSync(path.join(src, 'libespeak-ng.dll'), path.join(dest, 'libespeak-ng.dll'));
    cpSync(path.join(src, 'espeak-ng-data'), data, { recursive: true });

    await fetchVCRuntime(tmp, dest);
    ok(`eSpeak win32 (${mb(dirSize(dest))})`);
  } catch (e) {
    fail(`gagal menyiapkan eSpeak win32: ${e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function fs_tmp() {
  return path.join(os.tmpdir(), 'sms-tts-' + process.pid);
}

function dirSize(dir) {
  let total = 0;
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += statSync(p).size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

const mb = n => (n / 1048576).toFixed(1) + ' MB';

console.log(CHECK ? 'Memeriksa aset TTS…' : 'Menyiapkan aset TTS offline…');
await fetchModels();
await fetchEspeak();

if (problems) {
  console.error(`\n${problems} aset bermasalah. Jalankan: npm run prepare:assets`);
  process.exit(1);
}
console.log('\nAset TTS siap.');
