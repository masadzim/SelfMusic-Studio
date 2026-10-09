# Build SelfMusic Studio

The desktop app uses Electron and packages the existing HTML application with the
branding in `Asset/`.

## Requirements

- Node.js and npm
- Windows packaging on Linux also requires Wine

## Commands

```sh
npm install
npm start
npm run build:linux
npm run build:windows
```

Builds are written to `dist/`. Linux creates an AppImage and Windows creates an
NSIS installer `.exe`.

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
