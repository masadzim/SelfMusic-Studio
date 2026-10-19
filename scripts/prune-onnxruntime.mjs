#!/usr/bin/env node
/**
 * Prepare onnxruntime-node for packaging.
 *
 * Two problems with the published tarball (~287 MB unpacked):
 *   1. It ships a 259 MB CUDA provider and a TensorRT provider. This app is
 *      CPU-only, so both are always deleted.
 *   2. It ships every platform's CPU runtime. A build only needs one, so with
 *      `--target` the other platforms are moved to node_modules/.onnxruntime-parked
 *      (moved, not deleted, so cross-building on one machine still works).
 *   3. A platform directory carries one subdirectory per CPU architecture
 *      (`x64` and/or `arm64`). Only one is needed per build, so `--arch` parks
 *      the rest. Without this a linux-x64 build still carries a 25 MB arm64
 *      runtime it can never load.
 *
 * The parked copies are only ever restored when the real directory is missing,
 * so a stale cache can never clobber a good install.
 *
 * Usage:
 *   node scripts/prune-onnxruntime.mjs                 # drop GPU providers only
 *   node scripts/prune-onnxruntime.mjs --target linux  # keep only linux
 *   node scripts/prune-onnxruntime.mjs --target linux --arch x64
 *   node scripts/prune-onnxruntime.mjs --target win32
 */
import { existsSync, readdirSync, rmSync, statSync, mkdirSync, renameSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'node_modules', 'onnxruntime-node');
const NAPI = path.join(PKG, 'bin', 'napi-v6');
const CACHE = path.join(ROOT, 'node_modules', '.onnxruntime-parked');

const DROP = /onnxruntime_providers_(cuda|tensorrt)\.(so|dll|dylib)$/i;
const ARCH_DIRS = ['win32', 'darwin', 'linux'];
const CPU_DIRS = ['x64', 'arm64'];

const targetIdx = process.argv.indexOf('--target');
const target = targetIdx >= 0 ? process.argv[targetIdx + 1] : null;
const archIdx = process.argv.indexOf('--arch');
const arch = archIdx >= 0 ? process.argv[archIdx + 1] : (process.arch === 'arm64' ? 'arm64' : 'x64');

if (!existsSync(NAPI)) {
  console.error('! onnxruntime-node belum terpasang — jalankan npm install lebih dulu.');
  process.exit(1);
}
if (target && !ARCH_DIRS.includes(target)) {
  console.error(`! --target tidak dikenal: ${target} (pilihan: ${ARCH_DIRS.join(', ')})`);
  process.exit(1);
}
if (!CPU_DIRS.includes(arch)) {
  console.error(`! --arch tidak dikenal: ${arch} (pilihan: ${CPU_DIRS.join(', ')})`);
  process.exit(1);
}

const dirSize = dir => {
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
};
const mb = n => (n / 1048576).toFixed(1) + ' MB';

// --- 1. GPU providers are never needed -------------------------------------
let removed = 0;
let freed = 0;
const dropGpu = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { dropGpu(p); continue; }
    if (!DROP.test(entry.name)) continue;
    const size = statSync(p).size;
    rmSync(p, { force: true });
    removed++;
    freed += size;
    console.log(`  ✓ hapus provider GPU ${path.relative(ROOT, p)} (${mb(size)})`);
  }
};
for (const arch of ARCH_DIRS) {
  const dir = path.join(NAPI, arch);
  if (existsSync(dir)) dropGpu(dir);
}
console.log(removed
  ? `  → ${removed} provider GPU dihapus, hemat ${mb(freed)} dari paket`
  : '  ✓ provider GPU sudah bersih');

// --- 2. Platform pruning (hanya bila --target) -----------------------------
if (target) {
  for (const plat of ARCH_DIRS) {
    if (plat === target) continue;
    const live = path.join(NAPI, plat);
    const parked = path.join(CACHE, plat);
    if (!existsSync(live)) {
      if (existsSync(parked)) console.log(`  ℹ ${plat} sudah diparkir`);
      continue;
    }
    if (existsSync(parked)) rmSync(parked, { recursive: true, force: true });
    mkdirSync(CACHE, { recursive: true });
    renameSync(live, parked);
    console.log(`  ✓ parkir ${plat} (${mb(dirSize(parked))}) di node_modules/.onnxruntime-parked/`);
  }

  // Restore the target platform only when it is genuinely missing.
  const liveTarget = path.join(NAPI, target);
  const parkedTarget = path.join(CACHE, target);
  if (!existsSync(liveTarget) && existsSync(parkedTarget)) {
    cpSync(parkedTarget, liveTarget, { recursive: true });
    console.log(`  ✓ pulihkan ${target} dari cache untuk build ini`);
  }

  // A platform directory holds one subdirectory per CPU architecture. Only one
  // is loadable, so the rest are parked: a linux-x64 build otherwise carries a
  // 25 MB arm64 runtime it can never reach.
  if (existsSync(liveTarget)) {
    for (const entry of readdirSync(liveTarget, { withFileTypes: true })) {
      if (!entry.isDirectory() || !CPU_DIRS.includes(entry.name) || entry.name === arch) continue;
      const live = path.join(liveTarget, entry.name);
      const parked = path.join(CACHE, target, entry.name);
      if (existsSync(parked)) rmSync(parked, { recursive: true, force: true });
      mkdirSync(path.dirname(parked), { recursive: true });
      renameSync(live, parked);
      console.log(`  ✓ parkir ${target}/${entry.name} (${mb(dirSize(parked))}) di node_modules/.onnxruntime-parked/`);
    }
  }
} else {
  console.log('  ℹ mode target-agnostik: semua platform ikut terbawa (pakai --target untuk memangkas)');
}

// --- 3. Sanity check -------------------------------------------------------
function libNameFor(p) {
  if (p === 'win32') return 'onnxruntime.dll';
  if (p === 'darwin') return 'libonnxruntime.1.dylib';
  return 'libonnxruntime.so.1';
}
function hasFile(dir, name) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && hasFile(p, name)) return true;
    if (entry.isFile() && entry.name === name) return true;
  }
  return false;
}

const want = arch;
const lib = libNameFor(target || process.platform);
const probe = [path.join(NAPI, target || (process.platform === 'linux' ? 'linux' : process.platform), want),
               path.join(NAPI, target || (process.platform === 'linux' ? 'linux' : process.platform))];

if (!probe.some(d => hasFile(d, lib))) {
  console.error(`\n! runtime CPU untuk ${target || process.platform}/${want} (${lib}) tidak ditemukan.`);
  for (const d of probe) {
    console.error(`  isi ${path.relative(ROOT, d)}: ${existsSync(d) ? readdirSync(d).join(', ') : '(tidak ada)'}`);
  }
  console.error('  Jalankan `npm install onnxruntime-node` untuk memulihkan, lalu ulangi build.');
  process.exit(1);
}

console.log(`  ✓ runtime CPU tersedia: ${lib}`);
console.log(`\nSelesai. Ukuran onnxruntime-node sekarang ${mb(dirSize(PKG))}.`);
