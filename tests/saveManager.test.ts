import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFString, rgb } from 'pdf-lib';
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
