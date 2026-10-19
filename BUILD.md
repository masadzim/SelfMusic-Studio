# Build SelfMusic Studio

The desktop app uses Electron and packages the existing HTML application with the
branding in `Asset/`.

## Requirements

- Node.js and npm
- Windows packaging on Linux also requires Wine
- `apt-get` + `dpkg-deb` to unpack the eSpeak NG packages (no root needed)
- `unzip` (Windows asset fetch) and `wine` or `msiextract` (laying out the
  official `espeak-ng.msi`) when preparing the Windows assets

## Commands

```sh
npm install
npm run prepare:assets       # download the Piper model + eSpeak NG (once, ~84 MB)
npm run prepare:assets:win   # add the Windows eSpeak + MSVC runtime (once, ~24 MB)
npm start
npm run build:linux
npm run build:windows
```

Builds are written to `dist/`. Linux creates an AppImage and Windows creates an
NSIS installer `.exe`. `npm run build:linux:deb` produces a `.deb`.

## Offline TTS assets

The app bundles a neural Bahasa Indonesia voice so "Suara perangkat" works
offline and produces a real file you can save. Two pieces:

- **Piper model** `id_ID-news_tts-medium` (MIT, ~60 MB) from `rhasspy/piper-voices`
- **eSpeak NG 1.52** binary, shared library and data tree (GPL-3.0, ~26 MB).
  Linux unpacks it from the distro `.deb` packages, Windows lays it out from the
  official `espeak-ng.msi`, macOS from Homebrew bottles — all done by
  `scripts/prepare-tts-assets.mjs`.

`resources/tts/` is git-ignored because of its size. Re-run
`npm run prepare:assets` to restore it; builds call the `--check` variant first
and fail with a clear message if the assets are missing. `npm run build:windows`
checks the Windows assets instead, so a cross-build cannot silently ship a
package whose offline voice has no engine.

Windows packages also carry `msvcp140.dll`, `vcruntime140.dll` and
`vcruntime140_1.dll` next to `espeak-ng.exe`: the upstream binary imports them
and Windows does not provide them, and the whole point of the bundled engine is
that the user installs nothing. See `THIRD-PARTY-NOTICES.md`.

Because eSpeak NG and its data are GPL-3.0, the distributed app is
GPL-3.0-or-later. See `THIRD-PARTY-NOTICES.md`.

## Package size

`scripts/prune-onnxruntime.mjs` runs before every build and:

- deletes the CUDA provider (259 MB) and TensorRT provider — this app is CPU-only
- parks the runtimes for other platforms in `node_modules/.onnxruntime-parked`
  when `--target` is given, so single-platform builds stay much smaller
- parks the CPU architectures the target cannot load (`linux/arm64` in an x64
  build, 24 MB) under the same flag

`scripts/stage-tts-assets.cjs` runs as electron-builder's `beforePack` hook and
moves the eSpeak builds for other platforms into `resources/.espeak-parked`,
restoring them in `afterPack`. Without it every package would carry ~50 MB of
dictionaries for engines it cannot run.

Expected package size: roughly 200 MB (up from ~121 MB before 1.3.0).

## Auto-update

The app uses `electron-updater` with GitHub Releases as the update feed
(`build.publish` in `package.json`). On launch, a packaged build checks the
latest GitHub release, downloads a newer version in the background, and prompts
to restart and install. Auto-update is skipped when running unpackaged
(`npm start`).

Supported update targets:

- Windows: NSIS installer (`.exe`)
- Linux: AppImage

## Releasing

Publishing requires a GitHub token with `repo` scope in `GH_TOKEN`:

```sh
export GH_TOKEN=$(gh auth token)
npm version patch   # or minor/major, updates package.json + git tag
npm run release     # builds AppImage + NSIS and publishes to GitHub Releases
```

`npm run release` uploads the installers plus the generated update metadata
(`latest.yml`, `latest-linux.yml`, `*.blockmap`) that `electron-updater` reads.
Run `npm run release:linux` or `npm run release:windows` to publish a single
platform.

> ⚠️ **If the assets are uploaded by hand (`gh release upload`), keep the names
> byte-identical to what `latest.yml` / `latest-linux.yml` contain.** GitHub
> rewrites spaces in an asset name to dots, so `SelfMusic Studio Setup 1.3.0.exe`
> lands as `SelfMusic.Studio.Setup.1.3.0.exe` while the updater still looks for
> the spaced name — the download then 404s. `npm run release` renames them
> correctly because electron-builder does the upload. Fix an already-published
> release without re-uploading:
>
> ```sh
> gh api repos/masadzim/SelfMusic-Studio/releases/tags/v1.3.0 \
>   --jq '.assets[] | "\(.id)\t\(.name)"'
> gh api -X PATCH repos/masadzim/SelfMusic-Studio/releases/assets/<id> \
>   -f name="SelfMusic-Studio-Setup-1.3.0.exe"
> ```
