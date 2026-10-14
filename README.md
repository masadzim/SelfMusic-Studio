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
- **Buat suara (TTS)** dengan banyak penyedia: ElevenLabs, OpenAI, Google Gemini,
  Google Cloud, Microsoft Azure, MiniMax, Cartesia, Fish Audio, Qwen, Deepgram,
  dan suara bawaan perangkat (gratis tanpa API key)
- **Clone suara** dari unggahan file atau rekaman mikrofon, plus gaya bicara
  (netral, semangat, bercerita, tenang, ramah)
- **Pustaka suara** untuk menyimpan dan memakai ulang hasil clone
- **Simpan hasil suara ke komputer**: tombol `Simpan suara` membuka dialog simpan
  native (pilih folder mana pun), plus `Buka folder` untuk membuka lokasinya.
  Tersedia juga **simpan otomatis** ke folder terakhir tanpa dialog
- **Pengaturan sampel suara**: batas durasi min/maks, ukuran berkas, format,
  auto-pilih suara baru, auto-putar pratinjau, dan pernyataan izin
- **Tema aplikasi**: Gelap, Terang, Samudra, Senja
- **Bahasa aplikasi**: Indonesia & English
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
electron/main.cjs       # Proses utama Electron + auto-update + unduhan + simpan berkas
electron/preload.cjs    # Bridge aman (contextBridge) ke renderer
Asset/                  # Ikon dan logo
BUILD.md                # Catatan build detail
```

## Changelog

### 1.2.0

Perbaikan pada modul suara dan keamanan aplikasi:

- **Simpan hasil suara ke komputer**. Setelah `Generate suara` selesai, muncul
  tombol **Simpan suara** yang membuka dialog simpan native sehingga file MP3/WAV
  bisa ditaruh di folder mana pun, dan tombol **Buka folder** untuk membuka
  lokasinya di file manager.
- **Simpan otomatis** (checkbox di menu `Buat suara`): hasil generate langsung
  ditulis ke folder terakhir yang dipakai tanpa membuka dialog, dengan nama
  berkas bercap waktu dan tanpa menimpa berkas yang sudah ada.
- Tombol **Simpan suara** juga tersedia per bagian untuk penyedia yang hanya
  mengembalikan link sementara (mis. Qwen).
- Perbaikan: tombol unduh audio hasil generate sebelumnya tidak berfungsi di
  aplikasi desktop karena `downloadURL` hanya menerima URL `http(s)`. Semua
  unduhan berbasis `blob:` sekarang melalui dialog simpan native.
- Perbaikan: memilih "Suara perangkat" tidak lagi meninggalkan hasil generate
  sebelumnya (dan tombol simpan yang sudah aktif) di layar.
- Perbaikan: teks antarmuka pada hasil generate kini ikut mengikuti bahasa
  aplikasi tanpa perlu pindah menu.
- Keamanan: impor berkas JSON API key tidak lagi bisa menyisipkan HTML/JS ke
  daftar key (stored XSS). Nama berkas dan ekstensi yang dikirim ke disk
  dibersihkan, dan navigasi `file:` dibatasi ke berkas aplikasi.
- Perbaikan: kebocoran object URL pada ekspor key/CSV dan pratinjau sampel suara.
- Perbaikan: klik ganda pada "Simpan suara" tidak lagi mengirim berkas dua kali.
- Batas ukuran berkas 180 MB untuk dialog simpan agar aplikasi tidak kehabisan
  memori pada naskah yang sangat panjang.

### 1.1.0

Fitur baru dari `voiceclone.html` serta penambahan pengaturan aplikasi:

- **Modul suara (TTS)** dengan 10 penyedia API + suara perangkat, chunking
  naskah otomatis, pemilih model, dan pemilih bahasa suara per penyedia.
- **Clone suara** dari unggahan file atau rekaman mikrofon, dengan validasi
  durasi/ukuran sampel, pratinjau audio, dan penyimpanan ke pustaka lokal.
- **Pustaka suara** (`Pustaka suara`) untuk memakai ulang suara hasil clone.
- **Pengaturan sampel suara** di menu `Preferensi`: durasi minimum/maksimum,
  ukuran berkas maksimum, format yang diizinkan, auto-pilih suara baru,
  auto-putar pratinjau, dan kewajiban pernyataan izin.
- **Tema aplikasi**: Gelap, Terang, Samudra, dan Senja (tersimpan di browser).
- **Bahasa aplikasi**: Indonesia dan English (i18n antarmuka).
- Menu **Preferensi** baru; daftar provider API key dan alamat API diperluas
  mencakup seluruh penyedia suara.
- Versi aplikasi ditampilkan di menu Preferensi.

### 1.0.0

- Rilis awal: generate musik (SunoAPI.org & KIE.AI), cover, video MP4, WAV,
  lirik, multi API key, riwayat, log, manajer unduhan native, dan auto-update.

## Lisensi

Dirilis di bawah [MIT License](LICENSE).

## Dukungan

- Versi web: <https://adzim.my.id/ai>
- Donasi: <https://adzim.my.id/support>
- Kebijakan privasi: <https://adzim.my.id/privacy>
