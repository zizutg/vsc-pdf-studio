import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { SaveManager } = require('../out/storage/saveManager.js');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-studio-save-bench-'));
const pdfPath = path.join(tempDir, 'mixed.pdf');
const uri = { fsPath: pdfPath, toString: () => `file://${pdfPath}` };
const manager = new SaveManager();

try {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) pdf.addPage([600, 800]);
  pdf.getForm().createTextField('FullName').addToPage(pdf.getPage(0), {
    x: 30,
    y: 740,
    width: 180,
    height: 24,
  });
  const square = pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: pdf.context.obj([300, 600, 380, 640]),
    NM: PDFHexString.fromText('external-shape'),
    F: 4,
  });
  pdf.getPage(0).node.addAnnot(pdf.context.register(square));
  await writeFile(pdfPath, await pdf.save());

  const annotations = {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    strokes: Array.from({ length: 400 }, (_, index) => ({
      id: `stroke-${index}`,
      color: '#ef4444',
      width: 3,
      page: (index % 4) + 1,
      viewportWidth: 600,
      viewportHeight: 800,
      points: Array.from({ length: 100 }, (_, point) => ({
        x: 20 + point * 4,
        y: 100 + (index % 50) * 8 + Math.sin(point / 8) * 3,
      })),
    })),
    highlights: Array.from({ length: 40 }, (_, index) => ({
      id: `highlight-${index}`,
      color: '#eab308',
      page: (index % 4) + 1,
      viewportWidth: 600,
      viewportHeight: 800,
      rects: [{ x: 30, y: 200 + index * 8, width: 90, height: 10 }],
    })),
    comments: Array.from({ length: 12 }, (_, index) => ({
      id: `comment-${index}`,
      author: 'Benchmark',
      color: '#3b82f6',
      page: (index % 4) + 1,
      viewportWidth: 600,
      viewportHeight: 800,
      rects: [{ x: 150, y: 200 + index * 12, width: 18, height: 18 }],
      text: `Benchmark comment ${index}`,
    })),
  };

  const fields = await manager.getFormFields(uri);
  const firstStart = performance.now();
  await manager.saveDocument(uri, annotations, fields);
  const firstSaveMs = performance.now() - firstStart;
  const firstBytes = (await stat(pdfPath)).size;

  manager.disposeSession(uri);
  const reopenStart = performance.now();
  const restored = await manager.getAnnotations(uri);
  const restoredFields = await manager.getFormFields(uri);
  await manager.getPdfBytes(uri);
  const reopenMs = performance.now() - reopenStart;
  assert.equal(restored.strokes.length, annotations.strokes.length);
  assert.equal(restored.highlights.length, annotations.highlights.length);
  assert.equal(restored.comments.length, annotations.comments.length);
  assert.deepEqual(
    restoredFields.map((field) => field.name),
    fields.map((field) => field.name)
  );

  const secondStart = performance.now();
  await manager.saveDocument(uri, restored, restoredFields);
  const secondSaveMs = performance.now() - secondStart;
  const secondBytes = (await stat(pdfPath)).size;
  assert.ok(
    secondBytes <= firstBytes * 1.05,
    'Repeated save caused unexpected PDF growth.'
  );
  const saved = await PDFDocument.load(await readFile(pdfPath));
  assert.equal(saved.getPageCount(), 4);
  assert.equal(saved.getPage(0).node.Annots()?.size() ?? 0, 5);

  console.log(
    JSON.stringify({
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      scenario: {
        pages: 4,
        strokes: 400,
        pointsPerStroke: 100,
        highlights: 40,
        comments: 12,
        formFields: 1,
        nativeShapes: 1,
      },
      firstSaveMs: Number(firstSaveMs.toFixed(2)),
      reopenMs: Number(reopenMs.toFixed(2)),
      secondSaveMs: Number(secondSaveMs.toFixed(2)),
      firstBytes,
      secondBytes,
    })
  );
} finally {
  manager.disposeSession(uri);
  await rm(tempDir, { recursive: true, force: true });
}
