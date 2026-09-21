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
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const pdf_lib_1 = require("pdf-lib");
const pdfjs_dist_1 = require("pdfjs-dist");
const messages_1 = require("../src/validation/messages");
const linksModule = (0, promises_1.readFile)(path.resolve(__dirname, '../../media/pdfLinks.js'), 'utf8').then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
(0, node_test_1.default)('external PDF link messages accept web and email URLs only', () => {
    for (const url of [
        'https://example.com/path?q=a%20b#section',
        'http://localhost:3000/',
        'mailto:reader@example.com?subject=PDF%20review',
    ]) {
        strict_1.default.deepEqual((0, messages_1.parseWebviewMessage)({ type: 'openExternalLink', payload: { url } }), {
            type: 'openExternalLink',
            payload: { url },
        });
    }
    for (const url of [
        'javascript:alert(1)',
        'command:workbench.action.closeWindow',
        'file:///etc/passwd',
        'vscode://publisher.extension/action',
        'data:text/html,test',
        '/relative/link',
        'https://',
        '',
        null,
        42,
        `https://example.com/${'a'.repeat(8_192)}`,
    ]) {
        strict_1.default.equal((0, messages_1.parseWebviewMessage)({ type: 'openExternalLink', payload: { url } }), null);
    }
    strict_1.default.equal((0, messages_1.parseWebviewMessage)({ type: 'openExternalLink' }), null);
});
async function withLinkPdf(run) {
    const document = await pdf_lib_1.PDFDocument.create();
    const page = document.addPage([400, 500]);
    const target = document.addPage([400, 500]);
    const addLink = (extra, rect = [40, 420, 140, 440]) => {
        page.node.addAnnot(document.context.register(document.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: rect,
            ...extra,
        })));
    };
    addLink({ A: { S: 'URI', URI: pdf_lib_1.PDFString.of('https://example.com/review') } });
    addLink({ A: { S: 'URI', URI: pdf_lib_1.PDFString.of('mailto:reader@example.com') } });
    addLink({ Dest: [target.ref, 'XYZ', 50, 400, null] });
    addLink({ Dest: pdf_lib_1.PDFString.of('chapter-two') });
    document.catalog.set(pdf_lib_1.PDFName.of('Names'), document.context.obj({
        Dests: {
            Names: [
                pdf_lib_1.PDFString.of('chapter-two'),
                { D: [target.ref, 'FitR', 20, 250, 150, 350] },
            ],
        },
    }));
    addLink({ A: { S: 'URI', URI: pdf_lib_1.PDFString.of('javascript:alert(1)') } });
    addLink({
        A: { S: 'URI', URI: pdf_lib_1.PDFString.of('file:///private/document.pdf') },
    });
    addLink({ Dest: pdf_lib_1.PDFString.of('missing-destination') });
    addLink({
        F: 2,
        A: { S: 'URI', URI: pdf_lib_1.PDFString.of('https://example.com/hidden') },
    });
    addLink({
        Subtype: 'Text',
        Contents: pdf_lib_1.PDFString.of('Keep this as a comment'),
    });
    addLink({
        Subtype: 'Highlight',
        Contents: pdf_lib_1.PDFString.of('Keep this as markup'),
    });
    addLink({ A: { S: 'URI', URI: pdf_lib_1.PDFString.of('https://example.com/zero') } }, [0, 0, 0, 0]);
    const loadingTask = (0, pdfjs_dist_1.getDocument)({ data: await document.save() });
    try {
        await run(await loadingTask.promise);
    }
    finally {
        await loadingTask.destroy();
    }
}
(0, node_test_1.default)('PDF.js links resolve external URLs and explicit/named destinations without importing comments', async () => {
    const { createPdfLinkReader } = await linksModule;
    await withLinkPdf(async (pdf) => {
        const page = await pdf.getPage(1);
        const readLinks = createPdfLinkReader(pdf);
        const links = await readLinks(1, page.getViewport({ scale: 1 }));
        strict_1.default.equal(links.length, 4);
        strict_1.default.equal(links[0].url, 'https://example.com/review');
        strict_1.default.equal(links[1].url, 'mailto:reader@example.com');
        strict_1.default.deepEqual(links[2].destination, {
            pageNumber: 2,
            leftRatio: 0.125,
            topRatio: 0.2,
        });
        strict_1.default.deepEqual(links[3].destination, {
            pageNumber: 2,
            leftRatio: 0.05,
            topRatio: 0.3,
        });
        strict_1.default.deepEqual(links[0].rects, [
            { left: 40, top: 60, width: 100, height: 20 },
        ]);
        strict_1.default.equal((await readLinks(2, (await pdf.getPage(2)).getViewport({ scale: 1 })))
            .length, 0);
    });
});
(0, node_test_1.default)('link hit regions follow page zoom and rotation', async () => {
    const { createPdfLinkReader } = await linksModule;
    await withLinkPdf(async (pdf) => {
        const page = await pdf.getPage(1);
        const readLinks = createPdfLinkReader(pdf);
        const zoomed = await readLinks(1, page.getViewport({ scale: 2 }));
        strict_1.default.deepEqual(zoomed[0].rects, [
            { left: 80, top: 120, width: 200, height: 40 },
        ]);
        const rotated = await readLinks(1, page.getViewport({ scale: 1, rotation: 90 }));
        strict_1.default.deepEqual(rotated[0].rects, [
            { left: 420, top: 40, width: 20, height: 100 },
        ]);
    });
});
(0, node_test_1.default)('wrapped links use their individual quad regions instead of covering intervening text', async () => {
    const { createPdfLinkReader } = await linksModule;
    await withLinkPdf(async (pdf) => {
        const page = await pdf.getPage(1);
        const readLinks = createPdfLinkReader({
            getPage: async () => ({
                getAnnotations: async () => [
                    {
                        subtype: 'Link',
                        url: 'https://example.com/',
                        quadPoints: [
                            [
                                { x: 40, y: 440 },
                                { x: 140, y: 440 },
                                { x: 40, y: 420 },
                                { x: 140, y: 420 },
                            ],
                            [
                                { x: 40, y: 400 },
                                { x: 100, y: 400 },
                                { x: 40, y: 380 },
                                { x: 100, y: 380 },
                            ],
                        ],
                    },
                ],
            }),
        });
        const links = await readLinks(1, page.getViewport({ scale: 1 }));
        strict_1.default.deepEqual(links[0].rects, [
            { left: 40, top: 60, width: 100, height: 20 },
            { left: 40, top: 100, width: 60, height: 20 },
        ]);
    });
});
class TestElement extends EventTarget {
    ownerDocument;
    children = [];
    style = {};
    className = '';
    title = '';
    hidden = false;
    href = '';
    tabIndex = 0;
    draggable = true;
    classes = new Set();
    classList = {
        add: (value) => this.classes.add(value),
        remove: (value) => this.classes.delete(value),
    };
    attributes = new Map();
    constructor(ownerDocument) {
        super();
        this.ownerDocument = ownerDocument;
    }
    append(child) {
        this.children.push(child);
    }
    contains(child) {
        return (this === child || this.children.some((entry) => entry.contains(child)));
    }
    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
    removeAttribute(name) {
        this.attributes.delete(name);
    }
    getBoundingClientRect() {
        return { left: 20, top: 30, width: 400, height: 500 };
    }
}
async function createInteractionFixture() {
    const { attachPdfLinks } = await linksModule;
    const selection = { isCollapsed: true };
    const document = {
        createElement: () => new TestElement(document),
        defaultView: { getSelection: () => selection },
    };
    const pageShell = new TestElement(document);
    const textLayer = new TestElement(document);
    const pdfCanvas = new TestElement(document);
    const formControl = new TestElement(document);
    pageShell.append(textLayer);
    pageShell.append(pdfCanvas);
    pageShell.append(formControl);
    const opened = [];
    const navigated = [];
    const destination = { pageNumber: 2, leftRatio: 0, topRatio: 0.3 };
    const controller = attachPdfLinks({
        pageShell,
        textLayer,
        pdfCanvas,
        width: 400,
        height: 500,
        links: [
            {
                rects: [{ left: 40, top: 60, width: 100, height: 20 }],
                url: 'https://example.com/',
            },
            {
                rects: [{ left: 40, top: 100, width: 100, height: 20 }],
                destination,
            },
        ],
    }, {
        openExternal: (url) => opened.push(url),
        navigate: (value) => navigated.push(value),
    });
    const fire = (type, properties = {}) => {
        const event = new Event(type, { cancelable: true });
        for (const [key, value] of Object.entries({
            clientX: 80,
            clientY: 100,
            button: 0,
            buttons: 0,
            pointerId: 1,
            isPrimary: true,
            target: textLayer,
            ...properties,
        })) {
            Object.defineProperty(event, key, { value });
        }
        pageShell.dispatchEvent(event);
        return event;
    };
    return {
        controller,
        pageShell,
        textLayer,
        formControl,
        selection,
        opened,
        navigated,
        fire,
        destination,
    };
}
(0, node_test_1.default)('Select-mode pointer and keyboard links activate once', async () => {
    const fixture = await createInteractionFixture();
    fixture.controller.setEnabled(true);
    fixture.fire('pointerdown');
    fixture.fire('click');
    strict_1.default.deepEqual(fixture.opened, ['https://example.com/']);
    fixture.fire('pointerdown', { clientY: 140 });
    fixture.fire('click', { clientY: 140 });
    strict_1.default.deepEqual(fixture.navigated, [fixture.destination]);
    const layer = fixture.pageShell.children.at(-1);
    const event = new Event('click', { cancelable: true });
    layer.children[0].dispatchEvent(event);
    strict_1.default.equal(event.defaultPrevented, true);
    strict_1.default.equal(fixture.opened.length, 2);
});
(0, node_test_1.default)('disabled links do not intercept drawing or remain keyboard-focusable', async () => {
    const fixture = await createInteractionFixture();
    fixture.controller.setEnabled(false);
    strict_1.default.equal(fixture.fire('pointerdown').defaultPrevented, false);
    strict_1.default.equal(fixture.fire('click').defaultPrevented, false);
    const layer = fixture.pageShell.children.at(-1);
    strict_1.default.equal(layer.hidden, true);
    layer.children[0].dispatchEvent(new Event('click', { cancelable: true }));
    strict_1.default.deepEqual(fixture.opened, []);
});
(0, node_test_1.default)('text selection, pointer cancellation, eraser/right-click, and form clicks never activate a link', async () => {
    const fixture = await createInteractionFixture();
    fixture.controller.setEnabled(true);
    fixture.fire('pointerdown');
    fixture.fire('pointermove', { clientX: 100 });
    fixture.fire('click');
    fixture.fire('pointerdown');
    fixture.selection.isCollapsed = false;
    fixture.fire('click');
    fixture.selection.isCollapsed = true;
    fixture.fire('pointerdown');
    fixture.fire('pointercancel');
    fixture.fire('click');
    fixture.fire('pointerdown', { button: 5 });
    fixture.fire('click', { button: 5 });
    fixture.fire('pointerdown', { button: 2 });
    fixture.fire('click', { button: 2 });
    fixture.fire('pointerdown', { target: fixture.formControl });
    fixture.fire('click', { target: fixture.formControl });
    strict_1.default.deepEqual(fixture.opened, []);
    strict_1.default.deepEqual(fixture.navigated, []);
});
//# sourceMappingURL=pdfLinks.test.js.map