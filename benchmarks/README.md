# Live Drawing Baseline

## Run

Requires Node 22+, installed project dependencies, and Chrome/Chromium. No additional npm dependencies are needed.

```bash
npm run benchmark:drawing
# Optional machine-readable output:
npm run --silent benchmark:drawing > benchmarks/live-drawing-latest.json
```

Set `CHROME_PATH` to your browser executable if it is not at the platform default in the script. The runner starts a loopback-only server and a separate headless browser, generates PDFs in memory, and removes its temporary browser profile from the project when finished. It does not open or edit user PDFs. Benchmark files are excluded from the VSIX.

The runner disables background frame throttling in headless Chrome and gives the frame-by-frame pixel suite a longer DevTools timeout than individual benchmark operations.

For read-only comparisons, `DRAWING_SOURCE_REF=904ef5d npm run benchmark:drawing` serves `media/drawingLayer.js` and `media/main.js` from that Git revision while leaving the worktree untouched. Other assets come from the worktree. Reports include the override and SHA-256 hashes of the measured modules and benchmark script, since a commit ID alone does not identify uncommitted changes.

## Method

- Runs the actual `media/main.js`, PDF.js renderer, drawing layer, annotation-update callbacks, and history code. Only the VS Code host bridge is stubbed; no PDF saves are performed.
- Uses generated blank PDFs plus deterministic Studio annotation state: 100 points per existing stroke, 3 pt width, 600 x 800 source coordinates. These are synthetic loads, not measurements of a user's handwriting or imported Acrobat annotations.
- Tests empty, 250-stroke, and 1,000-stroke single-page documents, plus 1,000 strokes distributed over ten pages. Each case uses three fresh document loads and a new stroke with 30 pointer moves, followed by undo, redo, and erase.
- Sends browser mouse input through Chrome DevTools Protocol. Uses the normal Page Width default, a 1200 x 900 viewport, and device scale factor 1.
- Records synchronous pointer-handler and button-action duration, drawing-canvas clear/paint counts, and `structuredClone` counts/time. Wrappers are installed only in the benchmark browser after initial rendering.
- The extended runner also times animation-frame callbacks that paint ink, waits for the last queued preview before release, and reports combined synchronous-plus-deferred live work per stroke. A separate 30-move synthetic burst during mouse capture checks batching; this stress case is not a claim about real input frequency.
- Runs at native CPU speed and with Chrome's 4x CPU throttling. This is a local stress proxy, **not a Docker/dev-container measurement**.

`live-drawing-baseline.json` contains the environment, source commit, parameters, and aggregate results. Each move percentile uses 90 events; completion/undo/redo/erase have only three samples each, so the table below uses their medians. Counts include offscreen pages. Clone timing is reported as a mean in the JSON and must not be compared directly to a median as an exact percentage.

## Recorded Results

Measured September 29, 2026 against source commit `904ef5d`, on Apple M2 / macOS arm64, Node 22.17.0, Chrome 154.0.8037.59. Durations are milliseconds.

| Existing strokes | CPU throttle | Move p95 | Finish median | Undo median | Redo median | Erase median |
| ---------------- | ------------ | -------- | ------------- | ----------- | ----------- | ------------ |
| 0 / 1 page       | 1x           | 0.2      | 0.4           | 0.5         | 0.5         | 0.2          |
| 250 / 1 page     | 1x           | 1.3      | 38.8          | 15.2        | 14.6        | 28.4         |
| 1,000 / 1 page   | 1x           | 2.7      | 118.1         | 55.2        | 54.3        | 114.1        |
| 1,000 / 10 pages | 1x           | 1.0      | 139.4         | 57.4        | 59.8        | 112.3        |
| 0 / 1 page       | 4x           | 0.3      | 0.9           | 0.8         | 0.9         | 0.1          |
| 250 / 1 page     | 4x           | 3.6      | 114.2         | 56.9        | 58.6        | 122.1        |
| 1,000 / 1 page   | 4x           | 9.9      | 460.8         | 223.7       | 231.8       | 465.8        |
| 1,000 / 10 pages | 4x           | 2.5      | 478.6         | 242.6       | 240.8       | 497.8        |

## Findings

1. **Movement redraws old ink on every event.** `pointermove` in [drawingLayer.js](../media/drawingLayer.js) appends a point and calls `redrawPage`. On the dense page, every move clears the canvas and submits 1,001 strokes, including all 1,000 existing strokes. There is no animation-frame scheduling. The ten-page case has cheaper movement because only 100 existing strokes are on the active page, although the code still scans the whole stroke array.
2. **Finishing duplicates full-document drawing work.** `finalizeStroke` calls `onChange`, which reaches `applySessionAnnotations` in [main.js](../media/main.js). That reloads the drawing layer and redraws every page. Returning to `finalizeStroke` redraws every page again. The ten-page measurement records 20 clears and 2,002 stroke paint calls for one completion. Erasing follows the same double-redraw path. Undo and redo redraw all ten pages once each.
3. **Copying annotation state dominates completion time at high point counts.** Completion invokes six `structuredClone` calls: all strokes, the new stroke, annotations for application state, strokes for the drawing layer, annotations for history, and bookmarks. Four copies include the entire stroke collection. For the dense 4x case, clone time averages about 447 ms per completion. The annotation application path also rebuilds highlights, forms, comments, and selection UI; this fixture has none of those, so their real-document cost is not established here.
4. **Point storage is unsimplified.** Every received move adds a point, and each paint rebuilds each stroke's complete path. Larger point counts increase both path work and the full-state copying cost. No simplification or long-stroke accuracy tradeoff was tested in this measurement step.

## Next Steps And Limits

The baseline supports animation-frame scheduling, incremental live-stroke rendering, and affected-page redraws. However, removing redundant full-state copies in the stroke-completion path also deserves attention: rendering-only changes will not eliminate the largest measured completion pause. Any ownership/history changes need undo/redo regression tests, not simply removal of defensive copies.

These are instrumented JavaScript timings, **not end-to-end pen latency or FPS**. Browser rasterization/compositing may happen after a handler returns, timer precision and instrumentation add noise, and CPU throttling is approximate. Once rendering moves into animation-frame callbacks, measure that deferred work as well; faster pointer handlers alone do not prove faster rendering.

Still unmeasured: physical stylus/touch and coalesced samples, actual VS Code webviews and dev containers, long drawing sessions/history memory growth, long individual strokes, mixed forms/comments/highlights, and PDF serialization/disk I/O. Autosave/serialization remains the separate later optimization step. No production drawing behavior was changed to obtain this baseline.

## Frame Scheduling Update

The next implementation step batches pointer-driven previews with `requestAnimationFrame`. It retains samples immediately (including coalesced samples), commits on pointer release without waiting for a frame, and cancels queued work when ink is reloaded or its layer is disposed. It does **not** implement incremental paths, point simplification, or cheaper history copies.

The extended runner was run against both the original Git modules and the working implementation. Reports: `live-drawing-before-frames.json` and `live-drawing-frame-scheduled.json`. All eight scenarios have three repetitions each, using the same local hardware described above.

| Dense page (1,000 existing strokes) | Before move handler p95 | After move handler p95 | After deferred preview p95 |
| ----------------------------------- | ----------------------- | ---------------------- | -------------------------- |
| Native CPU                          | 2.9 ms                  | 0.1 ms                 | 2.8 ms                     |
| 4x throttling                       | 9.7 ms                  | 0.4 ms                 | 9.5 ms                     |

This is a scheduling improvement, not elimination of rendering cost: regularly paced CDP moves still lead to roughly one preview per move. For the deliberate 30-move single-task burst, every tested run went from **30 redraws to one redraw**. On the dense page, that is **30,030 stroke paint calls before versus 1,001 after**, with all input points retained. Do not interpret the synthetic burst as a 30x overall application speedup.

Completion remains expensive: the dense-page median was 129.9 ms before versus 130.2 ms after at native speed, and 477.4 ms versus 485.8 ms under 4x throttling. Those timings vary between runs; the unchanged full-state copying and completion redraws remain future work.

Regression tests cover batching, early release, final endpoints, coalesced samples, cancellation/lost capture, finger policy, unrelated pointers, reload/undo/redo state, erasing, disposal, and zoom-scaled page coordinates. Physical pen/touch testing is still required; simulated events are not a substitute for device testing.

## Incremental Preview Update

Live pen frames now append the new points plus one preceding segment for the rounded join. They do not clear the canvas, scan completed strokes, or rebuild the entire active path. Point data is unchanged. A full redraw mid-stroke resynchronizes the preview position; a new stroke, reload, or disposal resets it.

Completion, erase, undo, and redo still use the existing full rendering path. This preserves the canonical completed appearance but intentionally leaves full-document redraws and annotation-copying costs for subsequent work. This incremental compositing is for the current **opaque pen**, not a future translucent highlighter, which will need separate compositing to avoid opacity accumulating at overlaps.

The runner now includes `drawingPixels.mjs`: 18 browser pixel checks across straight lines, sharp corners, self-crossings, widths 1/3/6, and scales 1x/2x, with existing ink underneath. Completed images must match an independent full-path reference byte for byte. Live previews must have ink wherever the reference has opaque stroke pixels; antialiasing/partial-coverage differences at joins and crossings are recorded rather than treated as exact matches. Those differences are normalized by the canonical redraw on release. This is not a claim of pixel-identical live previews or physical-pen testing.

Unit checks also load 1,000 existing strokes and verify that each additional one-point frame issues one short path (at most two segments), with no canvas clears or replay of old ink. `live-drawing-incremental.json` records the extended measurements and pixel-check results.

## Affected-Page Redraw Update

Stroke completion, erase, and undo/redo now repaint only affected ink pages. Normal annotation reloads compare stroke content per page, so identical reloads do not repaint and edits retain the same stroke ID without being missed. Draw and erase callbacks supply their known page directly to avoid comparing all points on that hot path. The application callback's repaint also replaces the redundant completion/erase repaint.

`live-drawing-affected-pages.json` records the same eight synthetic scenarios and 18 passing browser pixel checks. In the 1,000-stroke, ten-page case, one completion now clears **1 canvas and paints 101 strokes**, versus **20 clears and 2,002 paints** in `live-drawing-incremental.json`. Erase clears 1 canvas instead of 20; undo and redo each clear 1 instead of 10. The dense single-page case drops from two clears to one on completion and erase.

Completion time did not improve consistently across runs: the ten-page median was 139.2 ms before and 132.2 ms after at native speed, and 458.2 ms versus 460.2 ms under 4x throttling. Full annotation/history cloning and other UI updates remain in the completion path. These instrumented results do not establish physical-pen latency or dev-container performance.

## Point Simplification Update

New pen strokes retain every pointer sample during the live preview, then simplify their saved path at completion with a 0.25 CSS-pixel deviation tolerance. Endpoints and significant corners are preserved. The iterative algorithm processes at most 512 source intervals per chunk to bound worst-case work and avoid call-stack growth. Existing saved strokes are not modified.

`live-drawing-simplified.json` records 24 passing browser pixel checks, including a slightly noisy straight stroke at widths 1/3/6 and scales 1x/2x. That 81-point stroke saves as 2 points in all six cases. Its completed rendering differs at antialiased edges but has no missing fully covered pixels compared with the unsimplified path. Completed canvas pixels exactly match an independent rendering of the saved path. The original straight, corner, and crossing cases also pass. Geometry unit tests cover corners, reversals, endpoint retention, bounded deviation, and long strokes across chunks.

This is a storage and future-work reduction, not a demonstrated latency improvement: the dense-page completion median was 133.5 ms before and 149.3 ms after at native speed, and 475.4 ms versus 491.2 ms under 4x throttling. Three completion samples per scenario are insufficient to distinguish a small regression from noise. Full-document state copying remains the dominant cost; imported or previously saved strokes remain unsimplified. Physical pen and high-zoom visual checks remain necessary.

## Freehand Highlighter Update

The freehand highlighter lazily creates one pointer-transparent canvas above the active ink page and reuses it instead of allocating one per PDF page. It repaints its active path once per animation frame at the selected opacity, so successive preview batches do not accumulate alpha. Release commits the stroke to Studio annotation state and saves it as one translucent PDF path. Reload and disposal clear and detach the temporary preview. Opaque pen previews retain their incremental path.

`live-drawing-highlighter-preview.json` records the preview-stage baseline. `live-drawing-highlighter.json` records the completed highlighter with 25 passing browser pixel checks. The self-crossing preview is compared with an independently drawn translucent path; minor edge differences are tolerated. The committed canvas must match an independent rendering of the saved path byte for byte, and neither preview nor committed path may exceed one 30% stroke's alpha at overlaps. Unit tests cover frame redraws, pen-canvas isolation, commit/erase, alpha restoration, reload, disposal, and PDF save/reopen/removal. Physical stylus testing remains outstanding.
