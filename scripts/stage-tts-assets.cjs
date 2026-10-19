/**
 * Keep only the eSpeak build that the package being built can actually run.
 *
 * `extraResources` has no per-platform filter, so a package would otherwise
 * carry all three engines plus their dictionaries: roughly 50 MB of files that
 * are dead weight on the machine that installs it.
 *
 * The foreign directories are moved aside rather than deleted, so
 * `npm start` and the next build still find them. beforePack always restores
 * first, which makes a build that died before afterPack harmless.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ESPEAK = path.join(ROOT, 'resources', 'tts', 'espeak');
const PARK = path.join(ROOT, 'resources', '.espeak-parked');

// Directory prefixes, matching what electron/tts.cjs looks up.
const PLATFORM_PREFIX = { linux: 'linux-', win32: 'win32', mac: 'darwin-', darwin: 'darwin-' };

function restore() {
  if (!fs.existsSync(PARK)) return;
  for (const name of fs.readdirSync(PARK)) {
    const from = path.join(PARK, name);
    const to = path.join(ESPEAK, name);
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
  }
  fs.rmSync(PARK, { recursive: true, force: true });
}

function park(platformName) {
  const prefix = PLATFORM_PREFIX[platformName];
  if (!prefix) throw new Error(`platform "${platformName}" tidak dikenal untuk aset TTS`);
  fs.mkdirSync(PARK, { recursive: true });
  const kept = [];
  for (const name of fs.readdirSync(ESPEAK)) {
    if (name.startsWith(prefix)) { kept.push(name); continue; }
    fs.renameSync(path.join(ESPEAK, name), path.join(PARK, name));
    console.log(`  ℹ eSpeak ${name} diparkir (bukan untuk ${platformName})`);
  }
  if (!kept.length) throw new Error(`tidak ada eSpeak untuk ${platformName} di resources/tts/espeak`);
  console.log(`  ✓ eSpeak untuk ${platformName}: ${kept.join(', ')}`);
}

exports.default = async function beforePack(context) {
  restore();
  park(context.electronPlatformName || process.platform);
};

exports.afterPack = async function afterPack() {
  restore();
  console.log('  ✓ eSpeak platform lain dikembalikan');
};