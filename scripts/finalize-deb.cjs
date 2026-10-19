#!/usr/bin/env node
/**
 * Post-process a .deb produced by electron-builder so the licence texts land in
 * the standard Debian location, /usr/share/doc/<pkg>/.
 *
 * Why this exists: fpm has no --docs flag and electron-builder's DebOptions has
 * no `copyright` field, so the only way is to rewrite the archive. Debian
 * Policy 12.5 wants /usr/share/doc/<pkg>/copyright; without it `dpkg -i`
 * installs fine but `lintian` complains.
 *
 * Everything fpm mounts from linux-unpacked goes under /opt/<product>/, so
 * dropping files there does NOT satisfy policy -- hence the archive rewrite.
 *
 * md5sums inside control.tar is regenerated, because dpkg verifies every
 * unpacked file against it and would otherwise abort the install.
 *
 * Usage: node scripts/finalize-deb.cjs dist/selfmusic-studio_1.3.0_amd64.deb
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

const debPath = process.argv[2];
if (!debPath || !fs.existsSync(debPath)) {
  console.error('Usage: node scripts/finalize-deb.cjs <path ke .deb>');
  process.exit(1);
}

const deb = path.resolve(debPath);
const pkgName = (() => {
  const pkg = require(path.join(ROOT, 'package.json'));
  return (pkg.build && pkg.build.deb && pkg.build.deb.packageName) ||
    (pkg.build && pkg.build.linux && pkg.build.linux.packageName) ||
    pkg.name;
})();

// Already done? Ask dpkg-deb for the file list rather than piping the whole
// 190 MB filesystem tarball through memory.
let listing = '';
try {
  listing = run('dpkg-deb', ['-c', deb], { maxBuffer: 1 << 28 });
} catch (e) {
  console.error('! tidak bisa membaca isi .deb: ' + (e.message || e));
  process.exit(1);
}
if (listing.includes(`usr/share/doc/${pkgName}/copyright`)) {
  console.log(`  ✓ copyright sudah ada di /usr/share/doc/${pkgName}/ — dilewati`);
  process.exit(0);
}

const DOCS = [
  ['COPYING', 'copyright'],
  ['COPYRIGHT-NOTICE.txt', 'COPYRIGHT-NOTICE.txt'],
  ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md'],
  ['resources/deb-docs/changelog.Debian', 'changelog.Debian']
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'debfix-'));
try {
  run('ar', ['x', deb], { cwd: work });
  for (const f of ['debian-binary', 'control.tar.xz', 'data.tar.xz']) {
    if (!fs.existsSync(path.join(work, f))) throw new Error(`anggota arsip ${f} tidak ditemukan`);
  }

  // --- data: add the documents ------------------------------------------------
  const dataDir = path.join(work, 'data');
  fs.mkdirSync(dataDir);
  run('tar', ['xf', path.join(work, 'data.tar.xz'), '-C', dataDir], { maxBuffer: 1 << 28 });

  const docDir = path.join(dataDir, 'usr', 'share', 'doc', pkgName);
  fs.mkdirSync(docDir, { recursive: true });
  const added = [];
  for (const [from, to] of DOCS) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(docDir, to));
    fs.chmodSync(path.join(docDir, to), 0o644);
    added.push(to);
  }
  if (!added.length) throw new Error('tidak ada berkas lisensi untuk disisipkan');

  // Must stay xz-compressed: the ar member is named data.tar.xz and dpkg
  // decompresses it as lzma. `tar cf` without -J would write a plain tar.
  run('tar', ['cJf', path.join(work, 'data.tar.xz'), '--owner=0', '--group=0',
    '--numeric-owner', '--format=gnu', '-C', dataDir, './']);

  // --- control: regenerate md5sums ------------------------------------------
  const ctrlDir = path.join(work, 'ctrl');
  fs.mkdirSync(ctrlDir);
  run('tar', ['xf', path.join(work, 'control.tar.xz'), '-C', ctrlDir]);

  const md5Path = path.join(ctrlDir, 'md5sums');
  let sums = fs.existsSync(md5Path) ? fs.readFileSync(md5Path, 'utf8') : '';
  const fresh = sums.split('\n').filter(l => !added.some(a => l.endsWith(' ' + `usr/share/doc/${pkgName}/${a}`)));

  for (const to of added) {
    const abs = path.join(docDir, to);
    const hash = run('md5sum', [abs]).trim().split(/\s+/)[0];
    fresh.push(`${hash}  usr/share/doc/${pkgName}/${to}`);
  }
  fs.writeFileSync(md5Path, fresh.join('\n') + '\n');

  // Replace control.tar with an updated gzip (dpkg accepts .gz too).
  run('tar', ['czf', path.join(work, 'control.tar.gz'), '--owner=0', '--group=0',
    '--numeric-owner', '--format=gnu', '-C', ctrlDir, './']);
  fs.rmSync(path.join(work, 'control.tar.xz'));

  // --- rebuild the ar archive -------------------------------------------------
  run('ar', ['r', deb, 'debian-binary', 'control.tar.gz', 'data.tar.xz'], { cwd: work });
  console.log(`  ✓ /usr/share/doc/${pkgName}/ → ${added.join(', ')}`);
} catch (e) {
  console.error('  ! gagal menyisipkan dokumen: ' + (e.message || e));
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
