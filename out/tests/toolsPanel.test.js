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
const panelModule = (0, promises_1.readFile)(path.resolve(__dirname, '../../media/toolsPanel.js'), 'utf8').then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
class PanelElement extends EventTarget {
    ownerDocument;
    hidden = false;
    textContent = '';
    attributes = new Map();
    children = new Map();
    classes = new Set();
    classList = {
        toggle: (name, enabled) => {
            if (enabled)
                this.classes.add(name);
            else
                this.classes.delete(name);
        },
    };
    constructor(ownerDocument) {
        super();
        this.ownerDocument = ownerDocument;
    }
    setAttribute(name, value) {
        this.attributes.set(name, value);
    }
    querySelector(selector) {
        return this.children.get(selector);
    }
    focus() {
        this.ownerDocument.activeElement = this;
    }
    contains(element) {
        return (element === this ||
            [...this.children.values()].some((child) => child.contains(element)));
    }
    click() {
        this.dispatchEvent(new Event('click'));
    }
}
async function fixture(overlay = false) {
    const { createToolsPanelController } = await panelModule;
    const document = { activeElement: null };
    const panelEl = new PanelElement(document);
    const toggleEl = new PanelElement(document);
    const colorButtonEl = new PanelElement(document);
    const contentShellEl = new PanelElement(document);
    const closeEl = new PanelElement(document);
    const colorSection = new PanelElement(document);
    const widthSection = new PanelElement(document);
    const swatch = new PanelElement(document);
    colorSection.children.set('.color-swatch', swatch);
    panelEl.children.set('#tools-panel-close', closeEl);
    panelEl.children.set('#tools-color-section', colorSection);
    panelEl.children.set('#tools-width-section', widthSection);
    let layoutChanges = 0;
    const controller = createToolsPanelController({
        panelEl,
        toggleEl,
        colorButtonEl,
        contentShellEl,
        workspaceEl: {
            get clientWidth() {
                return overlay || !contentShellEl.classes.has('is-tools-open')
                    ? 1200
                    : 960;
            },
        },
        onLayoutChange: () => {
            layoutChanges += 1;
        },
    });
    return {
        controller,
        panelEl,
        toggleEl,
        colorButtonEl,
        contentShellEl,
        closeEl,
        colorSection,
        widthSection,
        swatch,
        document,
        layoutChanges: () => layoutChanges,
    };
}
(0, node_test_1.default)('tools panel toggles independently and restores keyboard focus on close', async () => {
    const f = await fixture();
    f.contentShellEl.classes.add('is-sidebar-collapsed');
    strict_1.default.equal(f.panelEl.hidden, true);
    f.toggleEl.click();
    strict_1.default.equal(f.panelEl.hidden, false);
    strict_1.default.equal(f.toggleEl.attributes.get('aria-expanded'), 'true');
    strict_1.default.equal(f.document.activeElement, f.closeEl);
    strict_1.default.ok(f.contentShellEl.classes.has('is-sidebar-collapsed'));
    f.closeEl.click();
    strict_1.default.equal(f.panelEl.hidden, true);
    strict_1.default.equal(f.document.activeElement, f.toggleEl);
    strict_1.default.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'false');
    strict_1.default.equal(f.layoutChanges(), 2);
});
(0, node_test_1.default)('pen size stays visible in every mode without closing panel or replacing controls', async () => {
    const f = await fixture();
    f.toggleEl.click();
    for (const mode of ['select', 'annotate', 'highlight', 'comment', 'erase']) {
        f.controller.updateMode(mode);
        strict_1.default.equal(f.panelEl.hidden, false);
        strict_1.default.equal(f.widthSection.hidden, false);
        strict_1.default.equal(f.colorSection.hidden, mode === 'erase');
        strict_1.default.equal(f.panelEl.querySelector('#tools-width-section'), f.widthSection);
    }
    strict_1.default.equal(f.layoutChanges(), 1);
});
(0, node_test_1.default)('color shortcut opens existing panel; Escape closes and returns focus', async () => {
    const f = await fixture(true);
    f.controller.updateMode('select');
    f.colorButtonEl.click();
    strict_1.default.equal(f.document.activeElement, f.swatch);
    f.colorButtonEl.click();
    strict_1.default.equal(f.panelEl.hidden, false);
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    f.panelEl.dispatchEvent(escape);
    strict_1.default.equal(escape.defaultPrevented, true);
    strict_1.default.equal(f.panelEl.hidden, true);
    strict_1.default.equal(f.document.activeElement, f.colorButtonEl);
    strict_1.default.equal(f.layoutChanges(), 0, 'overlay must not rerender PDF pages');
});
(0, node_test_1.default)('document initialization can close tools without scheduling a duplicate PDF render', async () => {
    const f = await fixture();
    f.toggleEl.click();
    strict_1.default.equal(f.layoutChanges(), 1);
    f.controller.setOpen(false, { notifyLayout: false });
    strict_1.default.equal(f.panelEl.hidden, true);
    strict_1.default.equal(f.toggleEl.attributes.get('aria-expanded'), 'false');
    strict_1.default.equal(f.layoutChanges(), 1);
});
(0, node_test_1.default)('panel retains all preset colors, custom color, and existing pen widths', async () => {
    const { toolsPanelMarkup } = await panelModule;
    const markup = toolsPanelMarkup('');
    strict_1.default.doesNotMatch(markup, /tools-panel-title|tools-panel-context|<h[23]/);
    strict_1.default.match(markup, /<section id="tools-width-section" aria-label="Pen size">/);
    strict_1.default.equal((markup.match(/class="color-swatch/g) ?? []).length, 5);
    strict_1.default.match(markup, /id="stroke-color" type="color"/);
    strict_1.default.deepEqual([...markup.matchAll(/option value="(\d+)"/g)].map((match) => Number(match[1])), [1, 2, 3, 4, 6]);
});
//# sourceMappingURL=toolsPanel.test.js.map