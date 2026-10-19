# Third-Party Notices

SelfMusic Studio bundles or depends on the components below. Their licenses
apply to those components; the SelfMusic Studio source itself is GPL-3.0-or-later.

---

## Bundled (distributed inside the installer / AppImage / package)

### eSpeak NG — engine and data files

- **Version:** 1.52.0
- **License:** GPL-3.0-or-later
- **Source:** https://github.com/espeak-ng/espeak-ng
- **Upstream:** https://espeak-ng.org
- **What is bundled:** the `espeak-ng` executable, its shared library, and the
  complete `espeak-ng-data/` tree (phoneme tables and per-language dictionaries).
- **Packaged from:**
  - Linux: Ubuntu archive packages `espeak-ng`, `libespeak-ng1`,
    `espeak-ng-data` (`1.52.0+dfsg-5build1`), unpacked without root.
  - Windows: the official installer `espeak-ng.msi` (release 1.52.0), laid out
    with an administrative install — `espeak-ng.exe` + `libespeak-ng.dll`.
  - macOS: Homebrew bottles, relocated and ad-hoc re-signed.
  - Fetched by `scripts/prepare-tts-assets.mjs`.
- **Why GPL matters here:** both the compiled binary *and* the data files are
  covered by GPL-3.0, so shipping them makes the combined work GPL-3.0.

### Microsoft Visual C++ runtime — Windows builds only

- **Components:** `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`
- **License:** redistributable under the Visual C++ Redistributable EULA
  (local deployment: copying these files next to your own application)
- **Why it is bundled:** the upstream `espeak-ng.exe` is built with MSVC and
  imports these DLLs. Windows does not ship them, and this project promises a
  package that needs nothing installed, so the runtime travels next to the
  executable. Without them the binary fails to start on a clean machine.
- **Fetched by:** `scripts/prepare-tts-assets.mjs`, from the `msvc-runtime`
  wheel on PyPI, which is a verbatim copy of the DLLs the official
  `vc_redist.x64.exe` installs.
- **Source of the DLLs:** https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist

### Piper voice model — `id_ID-news_tts-medium`

- **Model:** Bahasa Indonesia, news_tts corpus, medium quality
- **License:** MIT (see the model card)
- **Source / files:**
  https://huggingface.co/rhasspy/piper-voices/tree/main/id/id_ID/news_tts/medium
- **Size:** ~60 MB (`id_ID-news_tts-medium.onnx`) plus its `.json` config
- **Runtime:** https://github.com/OHF-Voice/piper1-gpl
- **Notes:** one voice (neutral). Vocoder output is 22 050 Hz mono.

---

## Runtime dependency (bundled by electron-builder)

### onnxruntime-node

- **Version:** 1.30.0
- **License:** MIT
- **Source:** https://github.com/microsoft/onnxruntime
- **Package:** https://www.npmjs.com/package/onnxruntime-node
- **What it does:** runs the Piper ONNX model on CPU.
- **Notes:** uses the N-API v6 ABI, so the same prebuilt binary works in Node and
  Electron without a local rebuild. The CUDA and TensorRT provider plugins are
  removed at build time — this application is CPU-only.

---

## Development-only dependency

### electron-updater

- **License:** MIT
- **Source:** https://github.com/electron-userland/electron-builder

---

## System components (NOT bundled — invoked as separate programs)

The application prefers an existing system eSpeak NG over the bundled copy when
one is found on `PATH` or in a standard location. Those installs stay under
their own distribution's terms.

---

## Source availability (GPL-3.0 section 6)

The corresponding source for every binary released by this project is public:

    https://github.com/masadzim/SelfMusic-Studio

See `COPYRIGHT-NOTICE.txt` for details.
