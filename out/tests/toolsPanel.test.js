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
class PanelDocument extends EventTarget {
    activeElement = null;
}
class PanelElement extends EventTarget {
    ownerDocument;
    hidden = false;
    textContent = '';
    value = '';
    dataset = {};
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
        return (this.children.get(selector) ??
            [...this.children.values()]
                .map((child) => child.querySelector(selector))
                .find(Boolean));
    }
    querySelectorAll(selector) {
        return [...this.children.values()].flatMap((child) => [
            ...(selector === '.color-swatch' && child.classes.has('color-swatch')
                ? [child]
                : []),
            ...child.querySelectorAll(selector),
        ]);
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
    const document = new PanelDocument();
    const panelEl = new PanelElement(document);
    const toggleEl = new PanelElement(document);
    const colorButtonEl = new PanelElement(document);
    const colorWrapEl = new PanelElement(document);
    const colorPopoverEl = new PanelElement(document);
    const colorPaletteEl = new PanelElement(document);
    const customColorEl = new PanelElement(document);
    const moreColorsEl = new PanelElement(document);
    const contentShellEl = new PanelElement(document);
    const closeEl = new PanelElement(document);
    const colorSection = new PanelElement(document);
    const widthSection = new PanelElement(document);
    const penWidthField = new PanelElement(document);
    const highlighterWidthField = new PanelElement(document);
    const opacitySection = new PanelElement(document);
    const opacityInput = new PanelElement(document);
    const opacityValue = new PanelElement(document);
    const swatches = ['#ef4444', '#eab308', '#f97316', '#22c55e', '#3b82f6'].map((color) => {
        const swatch = new PanelElement(document);
        swatch.classes.add('color-swatch');
        swatch.dataset.color = color;
        return swatch;
    });
    opacityInput.value = '30';
    colorWrapEl.children.set('#color-button', colorButtonEl);
    colorWrapEl.children.set('#color-popover', colorPopoverEl);
    colorPopoverEl.children.set('#color-palette', colorPaletteEl);
    colorPaletteEl.children.set('.color-swatch', swatches[0]);
    swatches.slice(1).forEach((swatch, index) => {
        colorPaletteEl.children.set(`.color-swatch-${index + 1}`, swatch);
    });
    colorPaletteEl.children.set('#more-colors-button', moreColorsEl);
    colorSection.children.set('#stroke-color', customColorEl);
    panelEl.children.set('#tools-panel-close', closeEl);
    panelEl.children.set('#tools-color-section', colorSection);
    panelEl.children.set('#tools-width-section', widthSection);
    panelEl.children.set('#pen-width-field', penWidthField);
    panelEl.children.set('#highlighter-width-field', highlighterWidthField);
    panelEl.children.set('#tools-opacity-section', opacitySection);
    panelEl.children.set('#highlighter-opacity', opacityInput);
    panelEl.children.set('#highlighter-opacity-value', opacityValue);
    let layoutChanges = 0;
    const selectedColors = [];
    const controller = createToolsPanelController({
        panelEl,
        toggleEl,
        colorButtonEl,
        colorWrapEl,
        colorPopoverEl,
        customColorEl,
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
        onColorSelect: (color) => selectedColors.push(color),
    });
    return {
        controller,
        panelEl,
        toggleEl,
        colorButtonEl,
        colorWrapEl,
        colorPopoverEl,
        customColorEl,
        moreColorsEl,
        contentShellEl,
        closeEl,
        colorSection,
        widthSection,
        penWidthField,
        highlighterWidthField,
        opacitySection,
        opacityInput,
        opacityValue,
        swatches,
        selectedColors,
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
(0, node_test_1.default)('freehand highlighter controls are mode-specific and retain their settings', async () => {
    const f = await fixture();
    f.toggleEl.click();
    f.controller.updateMode('freehand-highlight');
    strict_1.default.equal(f.widthSection.hidden, false);
    strict_1.default.equal(f.penWidthField.hidden, false);
    strict_1.default.equal(f.highlighterWidthField.hidden, false);
    strict_1.default.equal(f.opacitySection.hidden, false);
    strict_1.default.equal(f.colorSection.hidden, false);
    f.opacityInput.value = '45';
    f.opacityInput.dispatchEvent(new Event('input'));
    strict_1.default.equal(f.opacityValue.textContent, '45%');
    f.controller.updateMode('annotate');
    strict_1.default.equal(f.penWidthField.hidden, false);
    strict_1.default.equal(f.highlighterWidthField.hidden, true);
    strict_1.default.equal(f.opacitySection.hidden, true);
    f.controller.updateMode('freehand-highlight');
    strict_1.default.equal(f.opacityInput.value, '45');
    strict_1.default.equal(f.panelEl.hidden, false);
});
(0, node_test_1.default)('color chip opens basic colors, selects a swatch, and closes on Escape or outside click', async () => {
    const f = await fixture(true);
    f.controller.updateMode('select');
    f.colorButtonEl.click();
    strict_1.default.equal(f.colorPopoverEl.hidden, false);
    strict_1.default.equal(f.panelEl.hidden, true);
    strict_1.default.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'true');
    strict_1.default.equal(f.document.activeElement, f.swatches[0]);
    f.swatches[1].click();
    strict_1.default.deepEqual(f.selectedColors, ['#eab308']);
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    strict_1.default.equal(f.document.activeElement, f.colorButtonEl);
    f.colorButtonEl.click();
    strict_1.default.equal(f.colorPopoverEl.hidden, false);
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    f.colorWrapEl.dispatchEvent(escape);
    strict_1.default.equal(escape.defaultPrevented, true);
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    strict_1.default.equal(f.document.activeElement, f.colorButtonEl);
    f.colorButtonEl.click();
    f.document.dispatchEvent(new Event('pointerdown'));
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    f.colorButtonEl.click();
    const focusOut = new Event('focusout');
    Object.defineProperty(focusOut, 'relatedTarget', { value: f.toggleEl });
    f.colorWrapEl.dispatchEvent(focusOut);
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    strict_1.default.equal(f.layoutChanges(), 0, 'popover must not rerender PDF pages');
});
(0, node_test_1.default)('More colors opens Tools, focuses the custom picker, and Escape returns to the chip', async () => {
    const f = await fixture(true);
    f.colorButtonEl.click();
    f.moreColorsEl.click();
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    strict_1.default.equal(f.panelEl.hidden, false);
    strict_1.default.equal(f.document.activeElement, f.customColorEl);
    strict_1.default.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'false');
    strict_1.default.equal(f.toggleEl.attributes.get('aria-expanded'), 'true');
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    f.panelEl.dispatchEvent(escape);
    strict_1.default.equal(f.panelEl.hidden, true);
    strict_1.default.equal(f.document.activeElement, f.colorButtonEl);
    strict_1.default.equal(f.layoutChanges(), 0, 'overlay must not rerender PDF pages');
});
(0, node_test_1.default)('Tools toggle closes the preset popup without changing its color selection', async () => {
    const f = await fixture();
    f.colorButtonEl.click();
    f.toggleEl.click();
    strict_1.default.equal(f.colorPopoverEl.hidden, true);
    strict_1.default.equal(f.panelEl.hidden, false);
    strict_1.default.deepEqual(f.selectedColors, []);
    strict_1.default.equal(f.layoutChanges(), 1);
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
(0, node_test_1.default)('popover owns the presets while Tools retains custom color and pen widths', async () => {
    const { colorPopoverMarkup, toolsPanelMarkup } = await panelModule;
    const markup = toolsPanelMarkup('');
    const popupMarkup = colorPopoverMarkup('<svg id="more-icon"></svg>');
    strict_1.default.doesNotMatch(markup, /tools-panel-title|tools-panel-context|<h[23]/);
    strict_1.default.match(markup, /<section id="tools-width-section" aria-label="Pen size">/);
    strict_1.default.equal((popupMarkup.match(/class="color-swatch/g) ?? []).length, 5);
    strict_1.default.doesNotMatch(markup, /class="color-swatch/);
    strict_1.default.match(popupMarkup, /data-color="#3b82f6"[\s\S]*id="more-colors-button" aria-label="More colors"/);
    strict_1.default.match(popupMarkup, /id="more-icon"/);
    strict_1.default.match(markup, /id="stroke-color" type="color"/);
    strict_1.default.match(markup, /id="highlighter-width"/);
    strict_1.default.match(markup, /id="highlighter-opacity" type="range"/);
    strict_1.default.deepEqual([
        ...(markup
            .match(/<select id="stroke-width">([\s\S]*?)<\/select>/)?.[1]
            .matchAll(/option value="(\d+)"/g) ?? []),
    ].map((match) => Number(match[1])), [1, 2, 3, 4, 6]);
});
//# sourceMappingURL=toolsPanel.test.js.map