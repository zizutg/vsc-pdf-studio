import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist';
import {
  decodePDFRawStream,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  rgb,
} from 'pdf-lib';
import { PDF_STUDIO_DATA_KEY } from '../src/constants';
import { SaveManager } from '../storage/saveManager';
import {
  emptyAnnotationDocument,
  type AnnotationDocument,
} from '../models/annotation';

type TestUri = {
  fsPath: string;
  toString(): string;
};

async function withTempPdf(
  build: () => Promise<Uint8Array>,
  run: (pdfPath: string, uri: TestUri) => Promise<void>
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-tests-'));
  const pdfPath = path.join(tempDir, 'fixture.pdf');
  await fs.writeFile(pdfPath, await build());
  const uri: TestUri = {
    fsPath: pdfPath,
    toString: () => `file://${pdfPath}`,
  };

  try {
    await run(pdfPath, uri);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function createPdfWithNativeComment(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const annotation = pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: pdf.context.obj([300, 420, 316, 436]),
    Contents: PDFHexString.fromText('External note'),
    NM: PDFHexString.fromText('external-comment-1'),
    T: PDFHexString.fromText('Adobe User'),
    M: PDFString.of('D:20260528120000Z'),
    C: pdf.context.obj([1, 0.5, 0]),
    Open: false,
    F: 4,
  });
  page.node.addAnnot(pdf.context.register(annotation));
  return pdf.save();
}

async function createPdfWithImportedHighlightNote(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const annotation = pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Highlight'),
    Rect: pdf.context.obj([100, 280, 220, 300]),
    QuadPoints: pdf.context.obj([100, 300, 220, 300, 100, 280, 220, 280]),
    Contents: PDFHexString.fromText('Imported highlight note'),
    NM: PDFHexString.fromText('external-highlight-1'),
    T: PDFHexString.fromText('Foxit User'),
    Subj: PDFHexString.fromText('Comment on Text'),
    M: PDFString.of('D:20260528121530Z'),
    C: pdf.context.obj([1, 1, 0]),
    F: 4,
  });
  page.node.addAnnot(pdf.context.register(annotation));
  return pdf.save();
}

async function createPdfWithTextFieldDefault(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const form = pdf.getForm();
  const field = form.createTextField('SignerFullName');
  field.addToPage(page, {
    x: 40,
    y: 420,
    width: 180,
    height: 22,
    borderColor: rgb(0, 0, 0),
    backgroundColor: rgb(1, 1, 1),
    textColor: rgb(0, 0, 0),
  });
  field.setText('Current Name');
  field.acroField.dict.set(PDFName.of('DV'), PDFString.of('Default Name'));
  form.updateFieldAppearances();
  return pdf.save();
}

function decodeAnnotationContents(annotation: unknown): string {
  if (
    !annotation ||
    typeof annotation !== 'object' ||
    !('lookupMaybe' in annotation)
  ) {
    return '';
  }

  const value = (annotation as any).lookupMaybe(
    PDFName.of('Contents'),
    PDFString,
    PDFHexString
  );
  return value ? value.decodeText() : '';
}

test('SaveManager imports native external text comments', async () => {
  await withTempPdf(createPdfWithNativeComment, async (_pdfPath, uri) => {
    const manager = new SaveManager();
    const annotations = await manager.getAnnotations(uri as any);

    assert.equal(annotations.comments.length, 1);
    assert.equal(annotations.comments[0]?.text, 'External note');
    assert.equal(annotations.comments[0]?.author, 'Adobe User');
    assert.equal(annotations.comments[0]?.id, 'external-comment-1');
    assert.equal(annotations.highlights.length, 0);
  });
});

test('SaveManager preserves imported markup notes on round-trip save', async () => {
  await withTempPdf(
    createPdfWithImportedHighlightNote,
    async (pdfPath, uri) => {
      const manager = new SaveManager();
      const annotations = await manager.getAnnotations(uri as any);
      const formFields = await manager.getFormFields(uri as any);

      assert.equal(annotations.highlights.length, 1);
      assert.equal(
        annotations.highlights[0]?.attachedNote?.text,
        'Imported highlight note'
      );

      await manager.saveDocument(uri as any, annotations, formFields);

      const saved = await PDFDocument.load(await fs.readFile(pdfPath));
      const page = saved.getPages()[0];
      const annots = page.node.Annots();
      assert.ok(annots);

      let highlightCount = 0;
      let foundContents = '';
      for (let index = 0; index < annots.size(); index += 1) {
        const annotation = annots.lookup(index);
        const subtype = (annotation as any)
          .lookupMaybe?.(PDFName.of('Subtype'), PDFName)
          ?.decodeText();
        if (subtype === 'Highlight') {
          highlightCount += 1;
          foundContents = decodeAnnotationContents(annotation);
        }
      }

      assert.equal(highlightCount, 1);
      assert.equal(foundContents, 'Imported highlight note');
    }
  );
});

test('SaveManager removes imported markup when deleted from Studio state', async () => {
  await withTempPdf(
    createPdfWithImportedHighlightNote,
    async (pdfPath, uri) => {
      const manager = new SaveManager();
      const annotations = await manager.getAnnotations(uri as any);
      const formFields = await manager.getFormFields(uri as any);
      const nextAnnotations: AnnotationDocument = {
        ...annotations,
        highlights: [],
      };

      await manager.saveDocument(uri as any, nextAnnotations, formFields);

      const saved = await PDFDocument.load(await fs.readFile(pdfPath));
      const page = saved.getPages()[0];
      const annots = page.node.Annots();
      let hasHighlight = false;

      if (annots) {
        for (let index = 0; index < annots.size(); index += 1) {
          const annotation = annots.lookup(index);
          const subtype = (annotation as any)
            .lookupMaybe?.(PDFName.of('Subtype'), PDFName)
            ?.decodeText();
          if (subtype === 'Highlight') {
            hasHighlight = true;
          }
        }
      }

      assert.equal(hasHighlight, false);
    }
  );
});

test('SaveManager exposes form reset defaults separately from current values', async () => {
  await withTempPdf(createPdfWithTextFieldDefault, async (_pdfPath, uri) => {
    const manager = new SaveManager();
    const formFields = await manager.getFormFields(uri as any);
    const resetFields = await manager.getResetFormFields(uri as any);

    assert.equal(formFields.length, 1);
    assert.equal(formFields[0]?.type, 'text');
    assert.equal((formFields[0] as any).value, 'Current Name');
    assert.equal(resetFields.length, 1);
    assert.equal(resetFields[0]?.type, 'text');
    assert.equal((resetFields[0] as any).value, 'Default Name');
  });
});

test('SaveManager can persist a new Studio comment as a native PDF text annotation', async () => {
  await withTempPdf(
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([400, 500]);
      return pdf.save();
    },
    async (pdfPath, uri) => {
      const manager = new SaveManager();
      const baseAnnotations = await manager.getAnnotations(uri as any);
      const formFields = await manager.getFormFields(uri as any);
      const nextAnnotations: AnnotationDocument = {
        ...emptyAnnotationDocument(),
        updatedAt: new Date().toISOString(),
        comments: [
          {
            id: 'studio-comment-1',
            author: 'PDF Studio Tester',
            modifiedAt: '2026-05-28T12:00:00.000Z',
            color: '#f97316',
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            rects: [{ x: 40, y: 100, width: 80, height: 16 }],
            text: 'Saved from Studio',
          },
        ],
        highlights: baseAnnotations.highlights,
        strokes: baseAnnotations.strokes,
      };

      await manager.saveDocument(uri as any, nextAnnotations, formFields);

      const saved = await PDFDocument.load(await fs.readFile(pdfPath));
      const page = saved.getPages()[0];
      const annots = page.node.Annots();
      assert.ok(annots);

      let foundTextComment = false;
      for (let index = 0; index < annots.size(); index += 1) {
        const annotation = annots.lookup(index);
        const subtype = (annotation as any)
          .lookupMaybe?.(PDFName.of('Subtype'), PDFName)
          ?.decodeText();
        const contents = decodeAnnotationContents(annotation);
        if (subtype === 'Text' && contents === 'Saved from Studio') {
          foundTextComment = true;
        }
      }

      assert.equal(foundTextComment, true);
    }
  );
});

test('SaveManager reads large legacy annotation strings without overflowing the stack', async () => {
  await withTempPdf(
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([400, 500]);
      const points = Array.from({ length: 10_000 }, (_, index) => ({
        x: index % 400,
        y: index % 500,
      }));
      const annotations: AnnotationDocument = {
        ...emptyAnnotationDocument(),
        strokes: [
          {
            id: 'large-legacy-stroke',
            color: '#ef4444',
            width: 3,
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            points,
          },
        ],
      };
      pdf.catalog.set(
        PDFName.of(PDF_STUDIO_DATA_KEY),
        PDFHexString.fromText(JSON.stringify(annotations))
      );
      return pdf.save();
    },
    async (_pdfPath, uri) => {
      const manager = new SaveManager();
      const annotations = await manager.getAnnotations(uri as any);

      assert.equal(annotations.strokes.length, 1);
      assert.equal(annotations.strokes[0]?.points.length, 10_000);
    }
  );
});

test('SaveManager stores annotations in a compressed stream that can be reopened', async () => {
  await withTempPdf(
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([400, 500]);
      return pdf.save();
    },
    async (pdfPath, uri) => {
      const manager = new SaveManager();
      const annotations: AnnotationDocument = {
        ...emptyAnnotationDocument(),
        strokes: [
          {
            id: 'stream-stroke',
            color: '#ef4444',
            width: 3,
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            points: [
              { x: 10, y: 20 },
              { x: 30, y: 40 },
            ],
          },
          {
            id: 'highlighter-stroke',
            kind: 'highlighter',
            opacity: 0.4,
            color: '#eab308',
            width: 14,
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            points: [
              { x: 40, y: 60 },
              { x: 80, y: 60 },
            ],
          },
        ],
      };

      await manager.saveDocument(uri as any, annotations, []);

      const saved = await PDFDocument.load(await fs.readFile(pdfPath));
      const storedData = saved.catalog.lookup(PDFName.of(PDF_STUDIO_DATA_KEY));
      assert.ok(storedData instanceof PDFRawStream);
      const storedJson = new TextDecoder().decode(
        decodePDFRawStream(storedData).decode()
      );
      assert.equal(JSON.parse(storedJson).strokes[0].id, 'stream-stroke');
      assert.equal(JSON.parse(storedJson).strokes[1].opacity, 0.4);

      manager.disposeSession(uri as any);
      const reopened = await manager.getAnnotations(uri as any);
      assert.equal(reopened.strokes[0]?.id, 'stream-stroke');
      assert.equal(reopened.strokes[0]?.kind, 'pen');
      assert.equal(reopened.strokes[0]?.opacity, 1);
      assert.equal(reopened.strokes[1]?.kind, 'highlighter');
      assert.equal(reopened.strokes[1]?.opacity, 0.4);
    }
  );
});

test('SaveManager exports one translucent highlighter path and removes it after erase', async () => {
  await withTempPdf(
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([400, 500]);
      return pdf.save();
    },
    async (pdfPath, uri) => {
      const manager = new SaveManager();
      const annotations: AnnotationDocument = {
        ...emptyAnnotationDocument(),
        strokes: [
          {
            id: 'highlighter-path',
            kind: 'highlighter',
            opacity: 0.4,
            color: '#eab308',
            width: 14,
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            points: [
              { x: 10, y: 20 },
              { x: 100, y: 20 },
              { x: 100, y: 60 },
            ],
          },
        ],
      };

      const getStrokeOperators = async () => {
        const loadingTask = getDocument({
          data: new Uint8Array(await fs.readFile(pdfPath)),
        });
        try {
          const pdf = await loadingTask.promise;
          return await (await pdf.getPage(1)).getOperatorList();
        } finally {
          await loadingTask.destroy();
        }
      };

      await manager.saveDocument(uri as any, annotations, []);
      const savedOperators = await getStrokeOperators();
      assert.equal(
        savedOperators.fnArray.filter((op) => op === OPS.stroke).length,
        1
      );
      const opacitySettings = savedOperators.argsArray
        .filter(
          (_args, index) => savedOperators.fnArray[index] === OPS.setGState
        )
        .flat(3);
      assert.deepEqual(opacitySettings, ['CA', 0.4]);

      manager.disposeSession(uri as any);
      const reopened = await manager.getAnnotations(uri as any);
      assert.equal(reopened.strokes[0]?.kind, 'highlighter');
      assert.equal(reopened.strokes[0]?.opacity, 0.4);

      await manager.saveDocument(uri as any, { ...reopened, strokes: [] }, []);
      const erasedOperators = await getStrokeOperators();
      assert.equal(
        erasedOperators.fnArray.filter((op) => op === OPS.stroke).length,
        0
      );
      manager.disposeSession(uri as any);
      assert.equal(
        (await manager.getAnnotations(uri as any)).strokes.length,
        0
      );
    }
  );
});
