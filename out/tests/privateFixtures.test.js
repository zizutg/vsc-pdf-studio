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
const saveManager_1 = require("../storage/saveManager");
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
function validateManifest(value) {
    strict_1.default.ok(value && typeof value === 'object' && 'fixtures' in value);
    const fixtures = value.fixtures;
    strict_1.default.ok(Array.isArray(fixtures) && fixtures.length > 0);
    for (const entry of fixtures) {
        strict_1.default.ok(entry && typeof entry === 'object');
        strict_1.default.match(entry.file, /^[^/\\]+\.pdf$/i);
        strict_1.default.ok(['Acrobat', 'Foxit'].includes(entry.source));
        strict_1.default.ok(Array.isArray(entry.shapeCounts) &&
            entry.shapeCounts.length > 0 &&
            entry.shapeCounts.every((count) => typeof count === 'number' && Number.isInteger(count) && count >= 0));
    }
    return fixtures;
}
async function displayShapes(bytes) {
    const loadingTask = (0, pdfjs_dist_1.getDocument)({ data: new Uint8Array(bytes) });
    const pdf = await loadingTask.promise;
    try {
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const annotations = await page.getAnnotations({ intent: 'display' });
            pages.push(annotations
                .filter((annotation) => shapeSubtypes.has(annotation.subtype))
                .map((annotation) => JSON.stringify({
                subtype: annotation.subtype,
                rect: annotation.rect.map((coordinate) => Math.round(coordinate * 100) / 100),
            }))
                .sort());
        }
        return pages;
    }
    finally {
        await loadingTask.destroy();
    }
}
(0, node_test_1.default)('private Acrobat and Foxit PDFs survive Studio open/save/reopen', async (t) => {
    let manifestText;
    try {
        manifestText = await fs.readFile(manifestPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            if (process.env.REQUIRE_PRIVATE_FIXTURES !== '1') {
                t.skip('No local third-party PDF fixtures are configured.');
                return;
            }
            throw new Error('Private PDF fixtures are required for release. Create tests/fixtures/private/manifest.json as documented in docs/quality-gates.md.', { cause: error });
        }
        throw error;
    }
    const fixtures = validateManifest(JSON.parse(manifestText));
    if (process.env.REQUIRE_PRIVATE_FIXTURES === '1') {
        strict_1.default.deepEqual(new Set(fixtures.map((fixture) => fixture.source)), new Set(['Acrobat', 'Foxit']), 'Release checks require both Acrobat and Foxit fixtures.');
    }
    for (const fixture of fixtures) {
        await t.test(`${fixture.source}: ${fixture.file}`, async () => {
            const sourcePath = path.join(fixtureDir, fixture.file);
            const originalBytes = new Uint8Array(await fs.readFile(sourcePath));
            const originalShapes = await displayShapes(originalBytes);
            strict_1.default.deepEqual(originalShapes.map((page) => page.length), fixture.shapeCounts, 'The source PDF no longer matches its declared shape counts.');
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-private-fixture-'));
            const copyPath = path.join(tempDir, fixture.file);
            await fs.writeFile(copyPath, originalBytes);
            const uri = { fsPath: copyPath, toString: () => `file://${copyPath}` };
            const manager = new saveManager_1.SaveManager();
            try {
                const baseBytes = await manager.getPdfBytes(uri);
                strict_1.default.deepEqual(await displayShapes(baseBytes), originalShapes, 'Studio would not display every native shape and position on open.');
                const annotations = await manager.getAnnotations(uri);
                const fields = await manager.getFormFields(uri);
                await manager.saveDocument(uri, annotations, fields);
                manager.disposeSession(uri);
                const reopenedBase = await manager.getPdfBytes(uri);
                strict_1.default.deepEqual(await displayShapes(reopenedBase), originalShapes, 'Studio lost, moved, or duplicated shapes after saving.');
                strict_1.default.deepEqual((await manager.getFormFields(uri)).map((field) => field.name), fields.map((field) => field.name), 'Form fields changed after saving.');
                const reopenedAnnotations = await manager.getAnnotations(uri);
                strict_1.default.equal(reopenedAnnotations.comments.length, annotations.comments.length);
                strict_1.default.equal(reopenedAnnotations.highlights.length, annotations.highlights.length);
                strict_1.default.equal(reopenedAnnotations.strokes.length, annotations.strokes.length);
            }
            finally {
                manager.disposeSession(uri);
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        });
    }
});
//# sourceMappingURL=privateFixtures.test.js.map