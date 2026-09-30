import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
// Optional read-only comparison: serve the old drawing/controller modules
// directly from Git, without checking out or overwriting working files.
const sourceRef = process.env.DRAWING_SOURCE_REF || null;
const measuredSources = new Map(
  await Promise.all(
    ['media/drawingLayer.js', 'media/main.js'].map(async (file) => [
      file,
      sourceRef
        ? execFileSync('git', ['show', `${sourceRef}:${file}`], { cwd: root })
        : await readFile(path.join(root, file)),
    ])
  )
);
const chromePath =
  process.env.CHROME_PATH ||
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }[process.platform];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scenarios = [
  { name: 'empty', pages: 1, strokesPerPage: 0 },
  { name: 'moderate', pages: 1, strokesPerPage: 250 },
  { name: 'dense', pages: 1, strokesPerPage: 1000 },
  { name: 'distributed', pages: 10, strokesPerPage: 100 },
];
const pointsPerStroke = 100;
const moves = 30;
const repetitions = 3;

function summarize(samples) {
  if (!samples.length) return null;
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const round = (value) => Math.round(value * 1000) / 1000;
  const average = (key) =>
    round(
      samples.reduce((total, sample) => total + sample[key], 0) / samples.length
    );
  return {
    events: samples.length,
    handlerMs: {
      p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
      p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
      max: round(sorted.at(-1)),
    },
    clearsPerEvent: average('clears'),
    strokePaintsPerEvent: average('paints'),
    cloneCallsPerEvent: average('clones'),
    cloneMsPerEvent: average('cloneMs'),
  };
}

// Runs only in the benchmark browser, not in the shipped webview.
function installMeasurements() {
  const stats = { clears: 0, paints: 0, clones: 0, cloneMs: 0 };
  window.benchmarkStats = stats;
  for (const [method, key] of [
    ['clearRect', 'clears'],
    ['stroke', 'paints'],
  ]) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) {
      if (this.canvas.classList.contains('drawing-canvas')) stats[key]++;
      return original.apply(this, args);
    };
  }
  const clone = window.structuredClone;
  window.structuredClone = (...args) => {
    const start = performance.now();
    const value = clone(...args);
    stats.clones++;
    stats.cloneMs += performance.now() - start;
    return value;
  };
  const snapshot = () => ({ ...stats });
  window.benchmarkFrames = [];
  const requestFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    requestFrame((timestamp) => {
      const before = snapshot();
      const start = performance.now();
      callback(timestamp);
      if (stats.clears !== before.clears || stats.paints !== before.paints) {
        window.benchmarkFrames.push({
          ms: performance.now() - start,
          ...Object.fromEntries(
            Object.keys(stats).map((key) => [key, stats[key] - before[key]])
          ),
        });
      }
    });
  window.benchmarkSamples = [];
  let start;
  let before;
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.target.classList.contains('drawing-canvas')) return;
        window.benchmarkPointerId = event.pointerId;
        before = snapshot();
        start = performance.now();
      },
      true
    );
    window.addEventListener(type, (event) => {
      if (!event.target.classList.contains('drawing-canvas')) return;
      window.benchmarkSamples.push({
        type,
        ms: performance.now() - start,
        ...Object.fromEntries(
          Object.keys(stats).map((key) => [key, stats[key] - before[key]])
        ),
      });
    });
  }
  window.measureButton = (selector) => {
    const before = snapshot();
    const start = performance.now();
    document.querySelector(selector).click();
    return {
      ms: performance.now() - start,
      ...Object.fromEntries(
        Object.keys(stats).map((key) => [key, stats[key] - before[key]])
      ),
    };
  };
}

function initializeFixture(pdfBase64, scenario, pointCount) {
  const strokes = [];
  for (let page = 1; page <= scenario.pages; page++) {
    for (let index = 0; index < scenario.strokesPerPage; index++) {
      strokes.push({
        id: `fixture-${page}-${index}`,
        page,
        color: '#ef4444',
        width: 3,
        viewportWidth: 600,
        viewportHeight: 800,
        points: Array.from({ length: pointCount }, (_, point) => ({
          x: 25 + (index % 10) * 50 + point * 0.4,
          y: 25 + (Math.floor(index / 10) % 65) * 10 + Math.sin(point / 5) * 3,
        })),
      });
    }
  }
  window.postMessage(
    {
      type: 'init',
      payload: {
        fileName: 'generated-benchmark.pdf',
        pdfBase64,
        formFields: [],
        annotations: {
          version: 1,
          updatedAt: new Date(0).toISOString(),
          strokes,
          highlights: [],
          comments: [],
        },
      },
    },
    '*'
  );
}

const html = `<!doctype html><html><head><link rel="stylesheet" href="/media/styles.css"></head>
<body><div id="app"></div><script>
window.benchmarkMessages=[];
window.acquireVsCodeApi=()=>({postMessage(message){benchmarkMessages.push(message);}});
</script><script src="/media/libs/pdf.min.js"></script><script src="/media/libs/pdf_viewer.js"></script>
<script>pdfjsLib.GlobalWorkerOptions.workerSrc='/media/libs/pdf.worker.min.js';</script>
<script type="module" src="/media/main.js"></script></body></html>`;

const profile = await mkdtemp(path.join(root, '.drawing-benchmark-'));
let browser;
let socket;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
      return;
    }
    const file = path.resolve(
      root,
      `.${new URL(req.url, 'http://localhost').pathname}`
    );
    if (
      !file.startsWith(path.join(root, 'media') + path.sep) &&
      file !== path.join(root, 'benchmarks/drawingPixels.mjs')
    ) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      'Content-Type',
      file.endsWith('.css') ? 'text/css' : 'text/javascript'
    );
    res.end(
      measuredSources.get(
        path.relative(root, file).split(path.sep).join('/')
      ) ?? (await readFile(file))
    );
  } catch {
    res.writeHead(404).end();
  }
});

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let launchError;
  browser.on('error', (error) => {
    launchError = error;
  });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    try {
      port = (
        await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
      ).split('\n')[0];
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(
    port,
    'Chrome did not start; set CHROME_PATH to a Chrome/Chromium executable.'
  );
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((target) => target.type === 'page').webSocketDebuggerUrl
  );
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(
        () => reject(new Error(`Timed out: ${method}`)),
        60000
      );
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text
      );
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(`Not ready: ${expression}`);
  };
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url });
  await waitFor('window.benchmarkMessages?.some(m => m.type === "ready")');
  const pixelChecks = await evaluate(
    "import('/benchmarks/drawingPixels.mjs').then(module => module.runDrawingPixelChecks())"
  );
  console.error(`Pixel checks passed: ${pixelChecks.length}`);
  const results = [];
  for (const rate of [1, 4]) {
    await send('Emulation.setCPUThrottlingRate', { rate });
    for (const scenario of scenarios) {
      const pdf = await PDFDocument.create();
      for (let page = 0; page < scenario.pages; page++) pdf.addPage([600, 800]);
      const base64 = Buffer.from(await pdf.save()).toString('base64');
      for (let repetition = 0; repetition < repetitions; repetition++) {
        await send('Page.navigate', { url });
        await waitFor(
          'window.benchmarkMessages?.some(m => m.type === "ready")'
        );
        await evaluate(
          `(${initializeFixture})(${JSON.stringify(base64)}, ${JSON.stringify(scenario)}, ${pointsPerStroke})`
        );
        await waitFor(
          `document.querySelectorAll('.drawing-canvas').length === ${scenario.pages}`
        );
        await evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        );
        await evaluate(
          `document.querySelector('[data-mode="annotate"]').click(); (${installMeasurements})();`
        );
        const origin = await evaluate(
          `(()=>{const r=document.querySelector('.drawing-canvas').getBoundingClientRect();return {x:r.left+100,y:r.top+160}})()`
        );
        const input = (type, x, y, buttons) =>
          send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            buttons,
            button: type === 'mouseMoved' ? 'none' : 'left',
            clickCount: type === 'mouseMoved' ? 0 : 1,
          });
        await input('mousePressed', origin.x, origin.y, 1);
        for (let move = 1; move <= moves; move++)
          await input(
            'mouseMoved',
            origin.x + move * 4,
            origin.y + Math.sin(move / 3) * 15,
            1
          );
        // Include queued preview work, not just the now-cheaper pointer handlers.
        await evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        );
        const previewFrames = await evaluate('benchmarkFrames');
        await input(
          'mouseReleased',
          origin.x + moves * 4,
          origin.y + Math.sin(moves / 3) * 15,
          0
        );
        const samples = await evaluate('benchmarkSamples');
        assert.equal(
          samples.filter((sample) => sample.type === 'pointermove').length,
          moves
        );
        const undo = await evaluate('measureButton("#undo-button")');
        const redo = await evaluate('measureButton("#redo-button")');
        await evaluate(
          'benchmarkSamples.length=0;document.querySelector(\'[data-mode="erase"]\').click()'
        );
        await input(
          'mousePressed',
          origin.x + moves * 4,
          origin.y + Math.sin(moves / 3) * 15,
          1
        );
        await input(
          'mouseReleased',
          origin.x + moves * 4,
          origin.y + Math.sin(moves / 3) * 15,
          0
        );
        const erase = await evaluate(
          'benchmarkSamples.find(s=>s.type==="pointerdown")'
        );
        assert.ok(erase.clones > 0, 'Eraser must hit a stroke');
        await evaluate(
          'document.querySelector(\'[data-mode="annotate"]\').click()'
        );
        await input('mousePressed', origin.x, origin.y, 1);
        const burst = await evaluate(`(async()=>{
          benchmarkSamples.length=0;
          benchmarkFrames.length=0;
          const canvas=document.querySelector('.drawing-canvas');
          for(let move=1;move<=${moves};move++) canvas.dispatchEvent(new PointerEvent('pointermove',{
            bubbles:true,pointerId:benchmarkPointerId,pointerType:'mouse',buttons:1,
            clientX:${origin.x}+move*4,clientY:${origin.y}+Math.sin(move/3)*15
          }));
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return { samples:benchmarkSamples, frames:benchmarkFrames };
        })()`);
        assert.equal(burst.samples.length, moves);
        await input(
          'mouseReleased',
          origin.x + moves * 4,
          origin.y + Math.sin(moves / 3) * 15,
          0
        );
        results.push({
          ...scenario,
          rate,
          repetition,
          samples,
          undo,
          redo,
          erase,
          previewFrames,
          burst,
        });
      }
      console.error(`Measured ${scenario.name}, CPU rate ${rate}x`);
    }
  }
  assert.deepEqual(exceptions, [], 'Browser runtime errors');
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        environment: {
          platform: os.platform(),
          arch: os.arch(),
          cpu: os.cpus()[0]?.model,
          node: process.version,
          browser: await send('Browser.getVersion'),
        },
        parameters: {
          pointsPerStroke,
          moves,
          repetitions,
          viewport: '1200x900 @ 1x',
          pdfSize: '600x800',
          input: 'CDP mouse events',
          serialization: 'excluded; host messaging is stubbed',
          deferredRendering:
            'drawing rAF callbacks timed separately; final preview settled before release',
          burst:
            '30 synthetic moves in one task during a trusted mouse capture; scheduling stress only',
        },
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        sourceOverride: sourceRef
          ? { ref: sourceRef, files: [...measuredSources.keys()] }
          : null,
        pixelChecks,
        sourceHashes: Object.fromEntries(
          await Promise.all(
            [
              'media/drawingLayer.js',
              'media/main.js',
              'benchmarks/liveDrawing.mjs',
              'benchmarks/drawingPixels.mjs',
            ].map(async (file) => [
              file,
              createHash('sha256')
                .update(
                  measuredSources.get(file) ??
                    (await readFile(path.join(root, file)))
                )
                .digest('hex'),
            ])
          )
        ),
        results: [1, 4].flatMap((rate) =>
          scenarios.map((scenario) => {
            const runs = results.filter(
              (result) => result.rate === rate && result.name === scenario.name
            );
            const events = runs.flatMap((run) => run.samples);
            return {
              ...scenario,
              cpuThrottleRate: rate,
              totalExistingPoints:
                scenario.pages * scenario.strokesPerPage * pointsPerStroke,
              start: summarize(
                events.filter((event) => event.type === 'pointerdown')
              ),
              move: summarize(
                events.filter((event) => event.type === 'pointermove')
              ),
              deferredPreview: summarize(
                runs.flatMap((run) => run.previewFrames)
              ),
              liveWorkMsPerStroke: runs.map((run) =>
                Number(
                  (
                    run.samples
                      .filter((sample) => sample.type !== 'pointerup')
                      .reduce((sum, sample) => sum + sample.ms, 0) +
                    run.previewFrames.reduce((sum, frame) => sum + frame.ms, 0)
                  ).toFixed(3)
                )
              ),
              burst: {
                moves: summarize(runs.flatMap((run) => run.burst.samples)),
                deferredPreview: summarize(
                  runs.flatMap((run) => run.burst.frames)
                ),
                previewFramesPerRun: runs.map((run) => run.burst.frames.length),
                totalPaintsPerRun: runs.map((run) =>
                  [...run.burst.samples, ...run.burst.frames].reduce(
                    (sum, sample) => sum + sample.paints,
                    0
                  )
                ),
              },
              finish: summarize(
                events.filter((event) => event.type === 'pointerup')
              ),
              undo: summarize(runs.map((run) => run.undo)),
              redo: summarize(runs.map((run) => run.redo)),
              erase: summarize(runs.map((run) => run.erase)),
            };
          })
        ),
      },
      null,
      2
    )
  );
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null) {
    const exited = once(browser, 'exit');
    browser.kill('SIGTERM');
    await exited;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
