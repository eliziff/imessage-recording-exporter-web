# Message Recording Exporter

A local-only web app that turns a scrolling iMessage screen recording into:

- one continuous deduplicated image;
- automatically numbered PNG images; and
- a letter-sized PDF.

The recording never leaves the browser. The app has no server, account, analytics, cookies, or upload endpoint.

## How it works

The browser first tries its native video decoder. It samples grayscale frames with Canvas, identifies the moving conversation region, matches overlapping horizontal bands, solves the frame positions as a graph, and uses low-error seams to assemble the result. Up/down scrolling is supported.

If the browser cannot decode an iPhone HEVC recording, the app lazy-loads its included `ffmpeg.wasm` files and creates a temporary 12-fps H.264 copy in browser memory. The fallback is substantially slower than native decoding; no converter is downloaded or initialized on the normal path.

## Run locally

GitHub Pages or any ordinary static HTTP server works:

```powershell
python -m http.server 8769 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8769/`.

## Checks

```powershell
npm ci
npm run check
npm test
npm run build
```

The focused test covers reversal-safe graph positioning and deliberate non-overlapping jumps. `test/browser_smoke.py` is an optional ChromeDriver test for local video fixtures; recordings and generated results are ignored by Git.

See [CORPUS_RESULTS.md](CORPUS_RESULTS.md) for zero-configuration results on three public, untrimmed iOS recordings, including fast flicks, pauses, slow scrolling, and a documented low-texture hard case.

The GitHub Actions matrix runs the checks on Windows, macOS, and Linux. A separate workflow publishes the tested static files to GitHub Pages after changes reach `main`.

## Dependencies

Runtime dependencies are vendored so the deployed page remains self-contained:

- `ffmpeg.wasm` for the lazy HEVC compatibility path;
- jsPDF for on-demand PDF creation.

Dependency versions are pinned in `package-lock.json`. Dependabot checks npm packages and GitHub Actions weekly.

## Current limits

- A large jump with no shared pixels cannot be reconstructed; the app reports an internal timeline gap instead of silently joining it.
- Browser canvases have a practical height limit. Split exceptionally long conversations into multiple recordings.
- The export preserves what is visible in the screen recording. It does not recover message metadata or attachments that were never shown or played.

MIT © 2026 Elias Ziff
