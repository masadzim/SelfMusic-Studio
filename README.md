# SelfMusic Studio

Aplikasi desktop untuk membuat musik AI dengan **SunoAPI.org** dan **KIE.AI**.
Dibangun dengan Electron dan membungkus antarmuka web `SelfMusic-Studio.html`
menjadi aplikasi Windows dan Linux dengan auto-update.

![SelfMusic Studio](Asset/Logo.jpeg)

## Fitur

- Generate musik (SunoAPI.org & KIE.AI)
- Upload & cover lagu
- Buat video MP4 dari lagu
- Convert audio ke WAV
- Ambil lirik
- Cek status task
- Multi API key (beberapa key per provider, aktif/nonaktif, failover)
- Riwayat, log generate, dan log aktivitas
- Manajer unduhan native (pause, resume, cancel, buka folder)
- Auto-update via GitHub Releases

## Persyaratan

- Node.js dan npm
- Untuk build Windows di Linux dibutuhkan Wine

## Menjalankan (development)

```sh
npm install
npm start
```

## Build

```sh
npm run build:linux     # AppImage
npm run build:windows   # NSIS installer (.exe)
npm run build           # keduanya
```

Hasil build ditulis ke folder `dist/`.

## Auto-update

Aplikasi memakai `electron-updater` dengan GitHub Releases sebagai sumber update
(lihat `build.publish` di `package.json`). Saat dijalankan sebagai build paket
(bukan `npm start`), aplikasi mengecek rilis terbaru, mengunduh versi baru di
latar belakang, lalu meminta restart untuk memasangnya.

Target update yang didukung:

- Windows: installer NSIS (`.exe`)
- Linux: AppImage

## Rilis

Publishing membutuhkan GitHub token dengan scope `repo` pada variabel `GH_TOKEN`.

```sh
export GH_TOKEN=$(gh auth token)
npm version patch   # atau minor/major, memperbarui package.json + git tag
npm run release     # build AppImage + NSIS lalu publish ke GitHub Releases
```

`npm run release` mengunggah installer beserta metadata update
(`latest.yml`, `latest-linux.yml`, `*.blockmap`) yang dibaca `electron-updater`.
Gunakan `npm run release:linux` atau `npm run release:windows` untuk publish
satu platform saja.

## Struktur proyek

```
SelfMusic-Studio.html   # Antarmuka aplikasi (UI + logika)
electron/main.cjs       # Proses utama Electron + auto-update + unduhan
electron/preload.cjs    # Bridge aman (contextBridge) ke renderer
Asset/                  # Ikon dan logo
BUILD.md                # Catatan build detail
```

## Lisensi

Dirilis di bawah [MIT License](LICENSE).

## Dukungan

- Versi web: <https://adzim.my.id/ai>
- Donasi: <https://adzim.my.id/support>
- Kebijakan privasi: <https://adzim.my.id/privacy>
