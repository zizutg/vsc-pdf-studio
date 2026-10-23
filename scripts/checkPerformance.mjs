import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(
  await readFile(
    path.join(root, 'benchmarks/live-drawing-highlighter.json'),
    'utf8'
  )
);
const saveBaseline = JSON.parse(
  await readFile(
    path.join(root, 'benchmarks/save-roundtrip-baseline.json'),
    'utf8'
  )
);

async function measure(script) {
  const child = spawn(
    process.execPath,
    [path.join(root, 'benchmarks', script)],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(exitCode, 0, `${script} did not complete.`);
  return JSON.parse(output);
}

const report = process.argv[2]
  ? JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'))
  : await measure('liveDrawing.mjs');

assert.ok(report.pixelChecks.length >= baseline.pixelChecks.length);
for (const check of report.pixelChecks) {
  assert.notEqual(check.finalMatchesReference, false, check.name);
  if (typeof check.missingCorePixels === 'number') {
    assert.equal(check.missingCorePixels, 0, check.name);
  }
  if (typeof check.finalMissingCorePixels === 'number') {
    assert.equal(check.finalMissingCorePixels, 0, check.name);
  }
}

for (const result of report.results) {
  const key = `${result.name}/${result.cpuThrottleRate}x`;
  const original = baseline.results.find(
    (entry) =>
      entry.name === result.name &&
      entry.cpuThrottleRate === result.cpuThrottleRate
  );
  assert.ok(original, `No recorded performance baseline for ${key}`);
  assert.equal(result.move.clearsPerEvent, 0, `${key}: move cleared ink`);
  assert.equal(
    result.move.strokePaintsPerEvent,
    0,
    `${key}: move repainted ink`
  );
  assert.ok(
    result.finish.clearsPerEvent <= original.finish.clearsPerEvent,
    `${key}: completion redraw count increased`
  );
  assert.ok(
    result.finish.strokePaintsPerEvent <= original.finish.strokePaintsPerEvent,
    `${key}: completion paint count increased`
  );
  assert.ok(
    result.burst.previewFramesPerRun.every((count) => count <= 1),
    `${key}: burst generated more than one preview frame`
  );

  const oldP95 = original.move.handlerMs.p95;
  const newP95 = result.move.handlerMs.p95;
  if (newP95 > Math.max(oldP95 * 2, oldP95 + 2)) {
    console.warn(
      `${key}: move p95 rose from ${oldP95} ms to ${newP95} ms; investigate before release.`
    );
  }
}

console.log(
  `Drawing gate passed: ${report.pixelChecks.length} pixel checks and ${report.results.length} operation budgets.`
);

const saveReport = await measure('saveRoundtrip.mjs');
assert.deepEqual(saveReport.scenario, saveBaseline.scenario);
assert.ok(
  saveReport.secondBytes <= saveReport.firstBytes * 1.05,
  'Repeated save caused unexpected PDF growth.'
);
assert.ok(
  saveReport.firstBytes <= saveBaseline.firstBytes * 1.25,
  'First save produced a PDF over 25% larger than the baseline.'
);
for (const key of ['firstSaveMs', 'reopenMs', 'secondSaveMs']) {
  if (
    saveReport[key] > Math.max(saveBaseline[key] * 2, saveBaseline[key] + 1000)
  ) {
    console.warn(
      `${key} rose from ${saveBaseline[key]} ms to ${saveReport[key]} ms; investigate before release.`
    );
  }
}
console.log('Save/reopen gate passed for mixed annotations and form fields.');
