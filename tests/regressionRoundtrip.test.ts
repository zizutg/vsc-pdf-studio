import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDocument } from 'pdfjs-dist';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { SaveManager } from '../storage/saveManager';

async function nativeCounts(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const annotations = await page.getAnnotations({ intent: 'display' });
    return Object.fromEntries(
      ['Square', 'Text', 'Highlight'].map((subtype) => [
        subtype,
        annotations.filter((annotation) => annotation.subtype === subtype)
          .length,
      ])
    );
  } finally {
    await task.destroy();
  }
}

function addSquare(pdf: PDFDocument, id: string, y: number) {
  const page = pdf.getPage(0);
  const appearance = pdf.context.flateStream(
    'q 0 0 1 RG 2 w 0 0 70 35 re S Q',
    {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: pdf.context.obj([0, 0, 70, 35]),
      Resources: pdf.context.obj({}),
    }
  );
  const shape = pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: pdf.context.obj([200, y, 270, y + 35]),
    NM: PDFHexString.fromText(id),
    F: 4,
    AP: pdf.context.obj({ N: pdf.context.register(appearance) }),
    P: page.ref,
  });
  page.node.addAnnot(pdf.context.register(shape));
}

test('mixed native annotations, forms, and Studio ink survive external edit and round trip', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-mixed-'));
  const pdfPath = path.join(tempDir, 'mixed.pdf');
  const uri = { fsPath: pdfPath, toString: () => `file://${pdfPath}` };
  const manager = new SaveManager();
  try {
    const source = await PDFDocument.create();
    const page = source.addPage([400, 500]);
    const form = source.getForm();
    form.createTextField('FullName').addToPage(page, {
      x: 40,
      y: 420,
      width: 150,
      height: 24,
    });
    form.getTextField('FullName').setText('Before');
    form.updateFieldAppearances();
    addSquare(source, 'original-shape', 300);

    const comment = source.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: source.context.obj([30, 300, 48, 318]),
      NM: PDFHexString.fromText('external-comment'),
      Contents: PDFHexString.fromText('External note'),
      T: PDFHexString.fromText('Acrobat User'),
      F: 4,
    });
    page.node.addAnnot(source.context.register(comment));
    const markup = source.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Highlight'),
      Rect: source.context.obj([30, 250, 150, 270]),
      QuadPoints: source.context.obj([30, 270, 150, 270, 30, 250, 150, 250]),
      NM: PDFHexString.fromText('external-markup'),
      Contents: PDFHexString.fromText('Markup note'),
      M: PDFString.of('D:20261023000000Z'),
      C: source.context.obj([1, 1, 0]),
      F: 4,
    });
    page.node.addAnnot(source.context.register(markup));
    await fs.writeFile(pdfPath, await source.save());

    const firstAnnotations = await manager.getAnnotations(uri as any);
    const firstFields = await manager.getFormFields(uri as any);
    assert.equal(firstAnnotations.comments.length, 1);
    assert.equal(firstAnnotations.highlights.length, 1);
    assert.equal(firstFields.length, 1);
    await manager.saveDocument(
      uri as any,
      {
        ...firstAnnotations,
        strokes: [
          {
            id: 'studio-ink',
            color: '#ef4444',
            width: 3,
            page: 1,
            viewportWidth: 400,
            viewportHeight: 500,
            points: [
              { x: 20, y: 40 },
              { x: 80, y: 60 },
            ],
          },
        ],
      },
      firstFields
    );

    const externalEdit = await PDFDocument.load(await fs.readFile(pdfPath));
    addSquare(externalEdit, 'new-adobe-shape', 350);
    externalEdit.getForm().getTextField('FullName').setText('After');
    externalEdit.getForm().updateFieldAppearances();
    await fs.writeFile(pdfPath, await externalEdit.save());
    manager.disposeSession(uri as any);

    assert.deepEqual(
      await nativeCounts(await manager.getPdfBytes(uri as any)),
      {
        Square: 2,
        Text: 1,
        Highlight: 1,
      }
    );
    const reopenedAnnotations = await manager.getAnnotations(uri as any);
    const reopenedFields = await manager.getFormFields(uri as any);
    assert.equal(reopenedAnnotations.strokes.length, 1);
    assert.equal(reopenedAnnotations.comments.length, 1);
    assert.equal(reopenedAnnotations.highlights.length, 1);
    assert.equal(reopenedFields[0]?.type, 'text');
    if (reopenedFields[0]?.type === 'text') {
      assert.equal(reopenedFields[0].value, 'After');
    }

    await manager.saveDocument(uri as any, reopenedAnnotations, reopenedFields);
    manager.disposeSession(uri as any);
    assert.deepEqual(
      await nativeCounts(await manager.getPdfBytes(uri as any)),
      {
        Square: 2,
        Text: 1,
        Highlight: 1,
      }
    );
    assert.equal((await manager.getAnnotations(uri as any)).strokes.length, 1);
    const finalFields = await manager.getFormFields(uri as any);
    assert.equal(finalFields[0]?.type, 'text');
    if (finalFields[0]?.type === 'text') {
      assert.equal(finalFields[0].value, 'After');
    }
  } finally {
    manager.disposeSession(uri as any);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
