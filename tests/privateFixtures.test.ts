import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDocument } from 'pdfjs-dist';
import { SaveManager } from '../storage/saveManager';

const fixtureDir = path.resolve(__dirname, '../../tests/fixtures/private');
const manifestPath = path.join(fixtureDir, 'manifest.json');
const shapeSubtypes = new Set([
  'Square',
  'Circle',
  'Line',
  'Polygon',
  'PolyLine',
  'Ink',
]);

interface FixtureEntry {
  file: string;
  source: 'Acrobat' | 'Foxit';
  shapeCounts: number[];
}

function validateManifest(value: unknown): FixtureEntry[] {
  assert.ok(value && typeof value === 'object' && 'fixtures' in value);
  const fixtures = (value as { fixtures: unknown }).fixtures;
  assert.ok(Array.isArray(fixtures) && fixtures.length > 0);
  for (const entry of fixtures) {
    assert.ok(entry && typeof entry === 'object');
    assert.match(entry.file, /^[^/\\]+\.pdf$/i);
    assert.ok(['Acrobat', 'Foxit'].includes(entry.source));
    assert.ok(
      Array.isArray(entry.shapeCounts) &&
        entry.shapeCounts.length > 0 &&
        entry.shapeCounts.every(
          (count: unknown) =>
            typeof count === 'number' && Number.isInteger(count) && count >= 0
        )
    );
  }
  return fixtures as FixtureEntry[];
}

async function displayShapes(bytes: Uint8Array) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      pages.push(
        annotations
          .filter((annotation) => shapeSubtypes.has(annotation.subtype))
          .map((annotation) =>
            JSON.stringify({
              subtype: annotation.subtype,
              rect: annotation.rect.map(
                (coordinate: number) => Math.round(coordinate * 100) / 100
              ),
            })
          )
          .sort()
      );
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

test('private Acrobat and Foxit PDFs survive Studio open/save/reopen', async (t) => {
  let manifestText: string;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (process.env.REQUIRE_PRIVATE_FIXTURES !== '1') {
        t.skip('No local third-party PDF fixtures are configured.');
        return;
      }
      throw new Error(
        'Private PDF fixtures are required for release. Create tests/fixtures/private/manifest.json as documented in docs/quality-gates.md.',
        { cause: error }
      );
    }
    throw error;
  }

  const fixtures = validateManifest(JSON.parse(manifestText) as unknown);
  if (process.env.REQUIRE_PRIVATE_FIXTURES === '1') {
    assert.deepEqual(
      new Set(fixtures.map((fixture) => fixture.source)),
      new Set(['Acrobat', 'Foxit']),
      'Release checks require both Acrobat and Foxit fixtures.'
    );
  }

  for (const fixture of fixtures) {
    await t.test(`${fixture.source}: ${fixture.file}`, async () => {
      const sourcePath = path.join(fixtureDir, fixture.file);
      const originalBytes = new Uint8Array(await fs.readFile(sourcePath));
      const originalShapes = await displayShapes(originalBytes);
      assert.deepEqual(
        originalShapes.map((page) => page.length),
        fixture.shapeCounts,
        'The source PDF no longer matches its declared shape counts.'
      );

      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'pdf-studio-private-fixture-')
      );
      const copyPath = path.join(tempDir, fixture.file);
      await fs.writeFile(copyPath, originalBytes);
      const uri = { fsPath: copyPath, toString: () => `file://${copyPath}` };
      const manager = new SaveManager();

      try {
        const baseBytes = await manager.getPdfBytes(uri as any);
        assert.deepEqual(
          await displayShapes(baseBytes),
          originalShapes,
          'Studio would not display every native shape and position on open.'
        );
        const annotations = await manager.getAnnotations(uri as any);
        const fields = await manager.getFormFields(uri as any);
        await manager.saveDocument(uri as any, annotations, fields);
        manager.disposeSession(uri as any);

        const reopenedBase = await manager.getPdfBytes(uri as any);
        assert.deepEqual(
          await displayShapes(reopenedBase),
          originalShapes,
          'Studio lost, moved, or duplicated shapes after saving.'
        );
        assert.deepEqual(
          (await manager.getFormFields(uri as any)).map((field) => field.name),
          fields.map((field) => field.name),
          'Form fields changed after saving.'
        );
        const reopenedAnnotations = await manager.getAnnotations(uri as any);
        assert.equal(
          reopenedAnnotations.comments.length,
          annotations.comments.length
        );
        assert.equal(
          reopenedAnnotations.highlights.length,
          annotations.highlights.length
        );
        assert.equal(
          reopenedAnnotations.strokes.length,
          annotations.strokes.length
        );
      } finally {
        manager.disposeSession(uri as any);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  }
});
