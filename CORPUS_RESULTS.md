# Corpus results

Run on 2026-08-25 in headless Chrome on Windows. The browser received temporary 12-fps H.264 copies so this measures the stitch/export algorithm independently of HEVC conversion speed. No fixture-specific crop, phone model, resolution, or scroll settings were supplied.

## Public real-device recordings

Source: [`LiLiKazine/Seamly.app` release `fixtures-v1`](https://github.com/LiLiKazine/Seamly.app/releases/tag/fixtures-v1), `Recordings.tar.gz` (SHA-256 `12dc07e6954db0b3786109a2298e3cdf583e0797a9f86354c93552caa09f0994`). All three are untrimmed 1320×2868, 60-fps HEVC recordings from Chrome on iOS.

| Fixture | Behaviour | Published geometry | Browser result | Difference | Continuity |
| --- | --- | ---: | ---: | ---: | --- |
| `DSNN4777.MP4` | Fast flicks and pauses | 1320×13591 | 1320×13507 | −84 px (−0.62%) | 100%, no timeline gaps |
| `KMZK1521.MP4` | Slow steady scroll | 1320×10650 | 1320×10705 | +55 px (+0.52%) | 100%, no timeline gaps |
| `CKHQ1876.MP4` | Low-texture article and collapsing bar | 6495 px ground-truth scroll span | 6641 px span | +146 px (+2.25%) | 100%, no timeline gaps |

The fixture authors document `CKHQ1876` as an unresolved hard case in their own video stitcher: one ambiguous seam lands on a competing alignment and another seam splits. This implementation kept one connected sequence, but its 2.25% span error is still a reason to review low-texture exports visually.

## Local Messages recording

A 1284×2778 iPhone Messages recording with fast scrolling, pauses, an embedded playing video, and a reversal measured a 6315-pixel browser scroll span. The separately validated desktop implementation measured 6316 pixels from the original recording. Chrome produced the continuous JPEG, four numbered PNGs, and a 4.2 MB PDF without console errors.

Recordings and generated exports are not committed.

## HEVC fallback smoke

Headless Chrome was forced down the lazy compatibility path with a 360×778 HEVC derivative of the local recording. It loaded the vendored FFmpeg WebAssembly only after native decoding failed, transcoded locally, stitched a 1767-pixel scroll span, and produced two PNGs plus a 767 KB PDF in 15.7 seconds. Diagnostics reported `videoDecoding: converted`; the browser console was clean.
