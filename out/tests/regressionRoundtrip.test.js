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
const saveManager_1 = require("../storage/saveManager");
async function nativeCounts(bytes) {
    const task = (0, pdfjs_dist_1.getDocument)({ data: new Uint8Array(bytes) });
    const pdf = await task.promise;
    try {
        const page = await pdf.getPage(1);
        const annotations = await page.getAnnotations({ intent: 'display' });
        return Object.fromEntries(['Square', 'Text', 'Highlight'].map((subtype) => [
            subtype,
            annotations.filter((annotation) => annotation.subtype === subtype)
                .length,
        ]));
    }
    finally {
        await task.destroy();
    }
}
function addSquare(pdf, id, y) {
    const page = pdf.getPage(0);
    const appearance = pdf.context.flateStream('q 0 0 1 RG 2 w 0 0 70 35 re S Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: pdf.context.obj([0, 0, 70, 35]),
        Resources: pdf.context.obj({}),
    });
    const shape = pdf.context.obj({
        Type: pdf_lib_1.PDFName.of('Annot'),
        Subtype: pdf_lib_1.PDFName.of('Square'),
        Rect: pdf.context.obj([200, y, 270, y + 35]),
        NM: pdf_lib_1.PDFHexString.fromText(id),
        F: 4,
        AP: pdf.context.obj({ N: pdf.context.register(appearance) }),
        P: page.ref,
    });
    page.node.addAnnot(pdf.context.register(shape));
}
(0, node_test_1.default)('mixed native annotations, forms, and Studio ink survive external edit and round trip', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-mixed-'));
    const pdfPath = path.join(tempDir, 'mixed.pdf');
    const uri = { fsPath: pdfPath, toString: () => `file://${pdfPath}` };
    const manager = new saveManager_1.SaveManager();
    try {
        const source = await pdf_lib_1.PDFDocument.create();
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
            Type: pdf_lib_1.PDFName.of('Annot'),
            Subtype: pdf_lib_1.PDFName.of('Text'),
            Rect: source.context.obj([30, 300, 48, 318]),
            NM: pdf_lib_1.PDFHexString.fromText('external-comment'),
            Contents: pdf_lib_1.PDFHexString.fromText('External note'),
            T: pdf_lib_1.PDFHexString.fromText('Acrobat User'),
            F: 4,
        });
        page.node.addAnnot(source.context.register(comment));
        const markup = source.context.obj({
            Type: pdf_lib_1.PDFName.of('Annot'),
            Subtype: pdf_lib_1.PDFName.of('Highlight'),
            Rect: source.context.obj([30, 250, 150, 270]),
            QuadPoints: source.context.obj([30, 270, 150, 270, 30, 250, 150, 250]),
            NM: pdf_lib_1.PDFHexString.fromText('external-markup'),
            Contents: pdf_lib_1.PDFHexString.fromText('Markup note'),
            M: pdf_lib_1.PDFString.of('D:20261023000000Z'),
            C: source.context.obj([1, 1, 0]),
            F: 4,
        });
        page.node.addAnnot(source.context.register(markup));
        await fs.writeFile(pdfPath, await source.save());
        const firstAnnotations = await manager.getAnnotations(uri);
        const firstFields = await manager.getFormFields(uri);
        strict_1.default.equal(firstAnnotations.comments.length, 1);
        strict_1.default.equal(firstAnnotations.highlights.length, 1);
        strict_1.default.equal(firstFields.length, 1);
        await manager.saveDocument(uri, {
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
        }, firstFields);
        const externalEdit = await pdf_lib_1.PDFDocument.load(await fs.readFile(pdfPath));
        addSquare(externalEdit, 'new-adobe-shape', 350);
        externalEdit.getForm().getTextField('FullName').setText('After');
        externalEdit.getForm().updateFieldAppearances();
        await fs.writeFile(pdfPath, await externalEdit.save());
        manager.disposeSession(uri);
        strict_1.default.deepEqual(await nativeCounts(await manager.getPdfBytes(uri)), {
            Square: 2,
            Text: 1,
            Highlight: 1,
        });
        const reopenedAnnotations = await manager.getAnnotations(uri);
        const reopenedFields = await manager.getFormFields(uri);
        strict_1.default.equal(reopenedAnnotations.strokes.length, 1);
        strict_1.default.equal(reopenedAnnotations.comments.length, 1);
        strict_1.default.equal(reopenedAnnotations.highlights.length, 1);
        strict_1.default.equal(reopenedFields[0]?.type, 'text');
        if (reopenedFields[0]?.type === 'text') {
            strict_1.default.equal(reopenedFields[0].value, 'After');
        }
        await manager.saveDocument(uri, reopenedAnnotations, reopenedFields);
        manager.disposeSession(uri);
        strict_1.default.deepEqual(await nativeCounts(await manager.getPdfBytes(uri)), {
            Square: 2,
            Text: 1,
            Highlight: 1,
        });
        strict_1.default.equal((await manager.getAnnotations(uri)).strokes.length, 1);
        const finalFields = await manager.getFormFields(uri);
        strict_1.default.equal(finalFields[0]?.type, 'text');
        if (finalFields[0]?.type === 'text') {
            strict_1.default.equal(finalFields[0].value, 'After');
        }
    }
    finally {
        manager.disposeSession(uri);
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=regressionRoundtrip.test.js.map