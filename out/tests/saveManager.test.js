"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const pdfjs_dist_1 = require("pdfjs-dist");
const pdf_lib_1 = require("pdf-lib");
const constants_1 = require("../src/constants");
const saveManager_1 = require("../storage/saveManager");
const annotation_1 = require("../models/annotation");
async function withTempPdf(build, run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-tests-'));
    const pdfPath = path.join(tempDir, 'fixture.pdf');
    await fs.writeFile(pdfPath, await build());
    const uri = {
        fsPath: pdfPath,
        toString: () => `file://${pdfPath}`,
    };
    try {
        await run(pdfPath, uri);
    }
    finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
async function createPdfWithNativeComment() {
    const pdf = await pdf_lib_1.PDFDocument.create();
    const page = pdf.addPage([400, 500]);
    const annotation = pdf.context.obj({
        Type: pdf_lib_1.PDFName.of('Annot'),
        Subtype: pdf_lib_1.PDFName.of('Text'),
        Rect: pdf.context.obj([300, 420, 316, 436]),
        Contents: pdf_lib_1.PDFHexString.fromText('External note'),
        NM: pdf_lib_1.PDFHexString.fromText('external-comment-1'),
        T: pdf_lib_1.PDFHexString.fromText('Adobe User'),
        M: pdf_lib_1.PDFString.of('D:20260528120000Z'),
        C: pdf.context.obj([1, 0.5, 0]),
        Open: false,
        F: 4,
    });
    page.node.addAnnot(pdf.context.register(annotation));
    return pdf.save();
}
async function createPdfWithImportedHighlightNote() {
    const pdf = await pdf_lib_1.PDFDocument.create();
    const page = pdf.addPage([400, 500]);
    const annotation = pdf.context.obj({
        Type: pdf_lib_1.PDFName.of('Annot'),
        Subtype: pdf_lib_1.PDFName.of('Highlight'),
        Rect: pdf.context.obj([100, 280, 220, 300]),
        QuadPoints: pdf.context.obj([100, 300, 220, 300, 100, 280, 220, 280]),
        Contents: pdf_lib_1.PDFHexString.fromText('Imported highlight note'),
        NM: pdf_lib_1.PDFHexString.fromText('external-highlight-1'),
        T: pdf_lib_1.PDFHexString.fromText('Foxit User'),
        Subj: pdf_lib_1.PDFHexString.fromText('Comment on Text'),
        M: pdf_lib_1.PDFString.of('D:20260528121530Z'),
        C: pdf.context.obj([1, 1, 0]),
        F: 4,
    });
    page.node.addAnnot(pdf.context.register(annotation));
    return pdf.save();
}
async function createPdfWithTextFieldDefault() {
    const pdf = await pdf_lib_1.PDFDocument.create();
    const page = pdf.addPage([400, 500]);
    const form = pdf.getForm();
    const field = form.createTextField('SignerFullName');
    field.addToPage(page, {
        x: 40,
        y: 420,
        width: 180,
        height: 22,
        borderColor: (0, pdf_lib_1.rgb)(0, 0, 0),
        backgroundColor: (0, pdf_lib_1.rgb)(1, 1, 1),
        textColor: (0, pdf_lib_1.rgb)(0, 0, 0),
    });
    field.setText('Current Name');
    field.acroField.dict.set(pdf_lib_1.PDFName.of('DV'), pdf_lib_1.PDFString.of('Default Name'));
    form.updateFieldAppearances();
    return pdf.save();
}
function decodeAnnotationContents(annotation) {
    if (!annotation ||
        typeof annotation !== 'object' ||
        !('lookupMaybe' in annotation)) {
        return '';
    }
    const value = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Contents'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString);
    return value ? value.decodeText() : '';
}
(0, node_test_1.default)('SaveManager imports native external text comments', async () => {
    await withTempPdf(createPdfWithNativeComment, async (_pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = await manager.getAnnotations(uri);
        strict_1.default.equal(annotations.comments.length, 1);
        strict_1.default.equal(annotations.comments[0]?.text, 'External note');
        strict_1.default.equal(annotations.comments[0]?.author, 'Adobe User');
        strict_1.default.equal(annotations.comments[0]?.id, 'external-comment-1');
        strict_1.default.equal(annotations.highlights.length, 0);
    });
});
(0, node_test_1.default)('SaveManager preserves imported markup notes on round-trip save', async () => {
    await withTempPdf(createPdfWithImportedHighlightNote, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = await manager.getAnnotations(uri);
        const formFields = await manager.getFormFields(uri);
        strict_1.default.equal(annotations.highlights.length, 1);
        strict_1.default.equal(annotations.highlights[0]?.attachedNote?.text, 'Imported highlight note');
        await manager.saveDocument(uri, annotations, formFields);
        const saved = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        const page = saved.getPages()[0];
        const annots = page.node.Annots();
        strict_1.default.ok(annots);
        let highlightCount = 0;
        let foundContents = '';
        for (let index = 0; index < annots.size(); index += 1) {
            const annotation = annots.lookup(index);
            const subtype = annotation
                .lookupMaybe?.(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)
                ?.decodeText();
            if (subtype === 'Highlight') {
                highlightCount += 1;
                foundContents = decodeAnnotationContents(annotation);
            }
        }
        strict_1.default.equal(highlightCount, 1);
        strict_1.default.equal(foundContents, 'Imported highlight note');
    });
});
(0, node_test_1.default)('SaveManager removes imported markup when deleted from Studio state', async () => {
    await withTempPdf(createPdfWithImportedHighlightNote, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = await manager.getAnnotations(uri);
        const formFields = await manager.getFormFields(uri);
        const nextAnnotations = {
            ...annotations,
            highlights: [],
        };
        await manager.saveDocument(uri, nextAnnotations, formFields);
        const saved = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        const page = saved.getPages()[0];
        const annots = page.node.Annots();
        let hasHighlight = false;
        if (annots) {
            for (let index = 0; index < annots.size(); index += 1) {
                const annotation = annots.lookup(index);
                const subtype = annotation
                    .lookupMaybe?.(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)
                    ?.decodeText();
                if (subtype === 'Highlight') {
                    hasHighlight = true;
                }
            }
        }
        strict_1.default.equal(hasHighlight, false);
    });
});
(0, node_test_1.default)('SaveManager exposes form reset defaults separately from current values', async () => {
    await withTempPdf(createPdfWithTextFieldDefault, async (_pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const formFields = await manager.getFormFields(uri);
        const resetFields = await manager.getResetFormFields(uri);
        strict_1.default.equal(formFields.length, 1);
        strict_1.default.equal(formFields[0]?.type, 'text');
        strict_1.default.equal(formFields[0].value, 'Current Name');
        strict_1.default.equal(resetFields.length, 1);
        strict_1.default.equal(resetFields[0]?.type, 'text');
        strict_1.default.equal(resetFields[0].value, 'Default Name');
    });
});
(0, node_test_1.default)('SaveManager can persist a new Studio comment as a native PDF text annotation', async () => {
    await withTempPdf(async () => {
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.addPage([400, 500]);
        return pdf.save();
    }, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const baseAnnotations = await manager.getAnnotations(uri);
        const formFields = await manager.getFormFields(uri);
        const nextAnnotations = {
            ...(0, annotation_1.emptyAnnotationDocument)(),
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
        await manager.saveDocument(uri, nextAnnotations, formFields);
        const saved = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        const page = saved.getPages()[0];
        const annots = page.node.Annots();
        strict_1.default.ok(annots);
        let foundTextComment = false;
        for (let index = 0; index < annots.size(); index += 1) {
            const annotation = annots.lookup(index);
            const subtype = annotation
                .lookupMaybe?.(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)
                ?.decodeText();
            const contents = decodeAnnotationContents(annotation);
            if (subtype === 'Text' && contents === 'Saved from Studio') {
                foundTextComment = true;
            }
        }
        strict_1.default.equal(foundTextComment, true);
    });
});
(0, node_test_1.default)('Adobe shapes on a Studio-ink page remain visible and survive another save', async () => {
    await withTempPdf(async () => {
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.addPage([400, 500]);
        return pdf.save();
    }, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = {
            ...(0, annotation_1.emptyAnnotationDocument)(),
            strokes: [
                {
                    id: 'studio-ink',
                    color: '#ef4444',
                    width: 3,
                    page: 1,
                    viewportWidth: 400,
                    viewportHeight: 500,
                    points: [
                        { x: 10, y: 20 },
                        { x: 50, y: 60 },
                    ],
                },
            ],
        };
        await manager.getPdfBytes(uri);
        await manager.saveDocument(uri, annotations, []);
        const adobePdf = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        const page = adobePdf.getPage(0);
        const appearance = adobePdf.context.flateStream('q 0 0 1 RG 2 w 0 0 80 40 re S Q', {
            Type: 'XObject',
            Subtype: 'Form',
            BBox: adobePdf.context.obj([0, 0, 80, 40]),
            Resources: adobePdf.context.obj({}),
        });
        const appearanceRef = adobePdf.context.register(appearance);
        for (const [index, subtype] of ['Square', 'Circle', 'Line'].entries()) {
            const shape = adobePdf.context.obj({
                Type: pdf_lib_1.PDFName.of('Annot'),
                Subtype: pdf_lib_1.PDFName.of(subtype),
                Rect: adobePdf.context.obj([
                    100,
                    300 - index * 50,
                    180,
                    340 - index * 50,
                ]),
                NM: pdf_lib_1.PDFHexString.fromText(`adobe-shape-${index}`),
                F: 4,
                AP: adobePdf.context.obj({ N: appearanceRef }),
                P: page.ref,
            });
            if (subtype === 'Line') {
                shape.set(pdf_lib_1.PDFName.of('L'), adobePdf.context.obj([100, 200, 180, 240]));
            }
            page.node.addAnnot(adobePdf.context.register(shape));
        }
        await fs.writeFile(pdfPath, await adobePdf.save());
        manager.disposeSession(uri);
        const renderingBase = await manager.getPdfBytes(uri);
        const pdfjs = await (0, pdfjs_dist_1.getDocument)({ data: renderingBase }).promise;
        const visibleAnnotations = await (await pdfjs.getPage(1)).getAnnotations({
            intent: 'display',
        });
        strict_1.default.equal(visibleAnnotations.length, 3);
        const reopenedAnnotations = await manager.getAnnotations(uri);
        strict_1.default.equal(reopenedAnnotations.strokes.length, 1);
        await manager.saveDocument(uri, reopenedAnnotations, []);
        manager.disposeSession(uri);
        const reopenedBase = await pdf_lib_1.PDFDocument.load(await manager.getPdfBytes(uri));
        const shapeAnnots = reopenedBase.getPage(0).node.Annots();
        strict_1.default.ok(shapeAnnots);
        strict_1.default.equal(shapeAnnots.size(), 3);
        for (let index = 0; index < shapeAnnots.size(); index += 1) {
            const shape = shapeAnnots.lookup(index, pdf_lib_1.PDFDict);
            strict_1.default.ok(shape.lookupMaybe(pdf_lib_1.PDFName.of('AP'), pdf_lib_1.PDFDict));
            strict_1.default.equal(shape.get(pdf_lib_1.PDFName.of('P'))?.toString(), reopenedBase.getPage(0).ref.toString());
        }
        const externallyEdited = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        externallyEdited.getPage(0).node.Annots()?.remove(0);
        await fs.writeFile(pdfPath, await externallyEdited.save());
        manager.disposeSession(uri);
        const baseAfterDeletion = await pdf_lib_1.PDFDocument.load(await manager.getPdfBytes(uri));
        strict_1.default.equal(baseAfterDeletion.getPage(0).node.Annots()?.size(), 2);
    });
});
(0, node_test_1.default)('SaveManager reads large legacy annotation strings without overflowing the stack', async () => {
    await withTempPdf(async () => {
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.addPage([400, 500]);
        const points = Array.from({ length: 10_000 }, (_, index) => ({
            x: index % 400,
            y: index % 500,
        }));
        const annotations = {
            ...(0, annotation_1.emptyAnnotationDocument)(),
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
        pdf.catalog.set(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY), pdf_lib_1.PDFHexString.fromText(JSON.stringify(annotations)));
        return pdf.save();
    }, async (_pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = await manager.getAnnotations(uri);
        strict_1.default.equal(annotations.strokes.length, 1);
        strict_1.default.equal(annotations.strokes[0]?.points.length, 10_000);
    });
});
(0, node_test_1.default)('SaveManager stores annotations in a compressed stream that can be reopened', async () => {
    await withTempPdf(async () => {
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.addPage([400, 500]);
        return pdf.save();
    }, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = {
            ...(0, annotation_1.emptyAnnotationDocument)(),
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
        await manager.saveDocument(uri, annotations, []);
        const saved = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        const storedData = saved.catalog.lookup(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY));
        strict_1.default.ok(storedData instanceof pdf_lib_1.PDFRawStream);
        const storedJson = new TextDecoder().decode((0, pdf_lib_1.decodePDFRawStream)(storedData).decode());
        strict_1.default.equal(JSON.parse(storedJson).strokes[0].id, 'stream-stroke');
        strict_1.default.equal(JSON.parse(storedJson).strokes[1].opacity, 0.4);
        manager.disposeSession(uri);
        const reopened = await manager.getAnnotations(uri);
        strict_1.default.equal(reopened.strokes[0]?.id, 'stream-stroke');
        strict_1.default.equal(reopened.strokes[0]?.kind, 'pen');
        strict_1.default.equal(reopened.strokes[0]?.opacity, 1);
        strict_1.default.equal(reopened.strokes[1]?.kind, 'highlighter');
        strict_1.default.equal(reopened.strokes[1]?.opacity, 0.4);
    });
});
(0, node_test_1.default)('SaveManager exports one translucent highlighter path and removes it after erase', async () => {
    await withTempPdf(async () => {
        const pdf = await pdf_lib_1.PDFDocument.create();
        pdf.addPage([400, 500]);
        return pdf.save();
    }, async (pdfPath, uri) => {
        const manager = new saveManager_1.SaveManager();
        const annotations = {
            ...(0, annotation_1.emptyAnnotationDocument)(),
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
            const loadingTask = (0, pdfjs_dist_1.getDocument)({
                data: new Uint8Array(await fs.readFile(pdfPath)),
            });
            try {
                const pdf = await loadingTask.promise;
                return await (await pdf.getPage(1)).getOperatorList();
            }
            finally {
                await loadingTask.destroy();
            }
        };
        await manager.saveDocument(uri, annotations, []);
        const savedOperators = await getStrokeOperators();
        strict_1.default.equal(savedOperators.fnArray.filter((op) => op === pdfjs_dist_1.OPS.stroke).length, 1);
        const opacitySettings = savedOperators.argsArray
            .filter((_args, index) => savedOperators.fnArray[index] === pdfjs_dist_1.OPS.setGState)
            .flat(3);
        strict_1.default.deepEqual(opacitySettings, ['CA', 0.4]);
        manager.disposeSession(uri);
        const reopened = await manager.getAnnotations(uri);
        strict_1.default.equal(reopened.strokes[0]?.kind, 'highlighter');
        strict_1.default.equal(reopened.strokes[0]?.opacity, 0.4);
        await manager.saveDocument(uri, { ...reopened, strokes: [] }, []);
        const erasedOperators = await getStrokeOperators();
        strict_1.default.equal(erasedOperators.fnArray.filter((op) => op === pdfjs_dist_1.OPS.stroke).length, 0);
        manager.disposeSession(uri);
        strict_1.default.equal((await manager.getAnnotations(uri)).strokes.length, 0);
    });
});
//# sourceMappingURL=saveManager.test.js.map