import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const panelModule = readFile(
  path.resolve(__dirname, '../../media/toolsPanel.js'),
  'utf8'
).then(
  (source) =>
    import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
);

class PanelDocument extends EventTarget {
  activeElement: PanelElement | null = null;
}

class PanelElement extends EventTarget {
  hidden = false;
  textContent = '';
  value = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children = new Map<string, PanelElement>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  constructor(readonly ownerDocument: PanelDocument) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  querySelector(selector: string): PanelElement | undefined {
    return (
      this.children.get(selector) ??
      [...this.children.values()]
        .map((child) => child.querySelector(selector))
        .find(Boolean)
    );
  }
  querySelectorAll(selector: string): PanelElement[] {
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
  contains(element: PanelElement | null): boolean {
    return (
      element === this ||
      [...this.children.values()].some((child) => child.contains(element))
    );
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
  const swatches = ['#ef4444', '#eab308', '#f97316', '#22c55e', '#3b82f6'].map(
    (color) => {
      const swatch = new PanelElement(document);
      swatch.classes.add('color-swatch');
      swatch.dataset.color = color;
      return swatch;
    }
  );
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
  const selectedColors: string[] = [];
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
    onColorSelect: (color: string) => selectedColors.push(color),
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

test('tools panel toggles independently and restores keyboard focus on close', async () => {
  const f = await fixture();
  f.contentShellEl.classes.add('is-sidebar-collapsed');
  assert.equal(f.panelEl.hidden, true);
  f.toggleEl.click();
  assert.equal(f.panelEl.hidden, false);
  assert.equal(f.toggleEl.attributes.get('aria-expanded'), 'true');
  assert.equal(f.document.activeElement, f.closeEl);
  assert.ok(f.contentShellEl.classes.has('is-sidebar-collapsed'));
  f.closeEl.click();
  assert.equal(f.panelEl.hidden, true);
  assert.equal(f.document.activeElement, f.toggleEl);
  assert.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'false');
  assert.equal(f.layoutChanges(), 2);
});

test('pen size stays visible in every mode without closing panel or replacing controls', async () => {
  const f = await fixture();
  f.toggleEl.click();
  for (const mode of ['select', 'annotate', 'highlight', 'comment', 'erase']) {
    f.controller.updateMode(mode);
    assert.equal(f.panelEl.hidden, false);
    assert.equal(f.widthSection.hidden, false);
    assert.equal(f.colorSection.hidden, mode === 'erase');
    assert.equal(
      f.panelEl.querySelector('#tools-width-section'),
      f.widthSection
    );
  }
  assert.equal(f.layoutChanges(), 1);
});

test('freehand highlighter controls are mode-specific and retain their settings', async () => {
  const f = await fixture();
  f.toggleEl.click();
  f.controller.updateMode('freehand-highlight');
  assert.equal(f.widthSection.hidden, false);
  assert.equal(f.penWidthField.hidden, false);
  assert.equal(f.highlighterWidthField.hidden, false);
  assert.equal(f.opacitySection.hidden, false);
  assert.equal(f.colorSection.hidden, false);
  f.opacityInput.value = '45';
  f.opacityInput.dispatchEvent(new Event('input'));
  assert.equal(f.opacityValue.textContent, '45%');
  f.controller.updateMode('annotate');
  assert.equal(f.penWidthField.hidden, false);
  assert.equal(f.highlighterWidthField.hidden, true);
  assert.equal(f.opacitySection.hidden, true);
  f.controller.updateMode('freehand-highlight');
  assert.equal(f.opacityInput.value, '45');
  assert.equal(f.panelEl.hidden, false);
});

test('color chip opens basic colors, selects a swatch, and closes on Escape or outside click', async () => {
  const f = await fixture(true);
  f.controller.updateMode('select');
  f.colorButtonEl.click();
  assert.equal(f.colorPopoverEl.hidden, false);
  assert.equal(f.panelEl.hidden, true);
  assert.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'true');
  assert.equal(f.document.activeElement, f.swatches[0]);
  f.swatches[1].click();
  assert.deepEqual(f.selectedColors, ['#eab308']);
  assert.equal(f.colorPopoverEl.hidden, true);
  assert.equal(f.document.activeElement, f.colorButtonEl);
  f.colorButtonEl.click();
  assert.equal(f.colorPopoverEl.hidden, false);
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  f.colorWrapEl.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.colorPopoverEl.hidden, true);
  assert.equal(f.document.activeElement, f.colorButtonEl);
  f.colorButtonEl.click();
  f.document.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.colorPopoverEl.hidden, true);
  f.colorButtonEl.click();
  const focusOut = new Event('focusout');
  Object.defineProperty(focusOut, 'relatedTarget', { value: f.toggleEl });
  f.colorWrapEl.dispatchEvent(focusOut);
  assert.equal(f.colorPopoverEl.hidden, true);
  assert.equal(f.layoutChanges(), 0, 'popover must not rerender PDF pages');
});

test('More colors opens Tools, focuses the custom picker, and Escape returns to the chip', async () => {
  const f = await fixture(true);
  f.colorButtonEl.click();
  f.moreColorsEl.click();
  assert.equal(f.colorPopoverEl.hidden, true);
  assert.equal(f.panelEl.hidden, false);
  assert.equal(f.document.activeElement, f.customColorEl);
  assert.equal(f.colorButtonEl.attributes.get('aria-expanded'), 'false');
  assert.equal(f.toggleEl.attributes.get('aria-expanded'), 'true');
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  f.panelEl.dispatchEvent(escape);
  assert.equal(f.panelEl.hidden, true);
  assert.equal(f.document.activeElement, f.colorButtonEl);
  assert.equal(f.layoutChanges(), 0, 'overlay must not rerender PDF pages');
});

test('Tools toggle closes the preset popup without changing its color selection', async () => {
  const f = await fixture();
  f.colorButtonEl.click();
  f.toggleEl.click();
  assert.equal(f.colorPopoverEl.hidden, true);
  assert.equal(f.panelEl.hidden, false);
  assert.deepEqual(f.selectedColors, []);
  assert.equal(f.layoutChanges(), 1);
});

test('document initialization can close tools without scheduling a duplicate PDF render', async () => {
  const f = await fixture();
  f.toggleEl.click();
  assert.equal(f.layoutChanges(), 1);
  f.controller.setOpen(false, { notifyLayout: false });
  assert.equal(f.panelEl.hidden, true);
  assert.equal(f.toggleEl.attributes.get('aria-expanded'), 'false');
  assert.equal(f.layoutChanges(), 1);
});

test('popover owns the presets while Tools retains custom color and pen widths', async () => {
  const { colorPopoverMarkup, toolsPanelMarkup } = await panelModule;
  const markup = toolsPanelMarkup('');
  const popupMarkup = colorPopoverMarkup('<svg id="more-icon"></svg>');
  assert.doesNotMatch(markup, /tools-panel-title|tools-panel-context|<h[23]/);
  assert.match(
    markup,
    /<section id="tools-width-section" aria-label="Pen size">/
  );
  assert.equal((popupMarkup.match(/class="color-swatch/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /class="color-swatch/);
  assert.match(
    popupMarkup,
    /data-color="#3b82f6"[\s\S]*id="more-colors-button" aria-label="More colors"/
  );
  assert.match(popupMarkup, /id="more-icon"/);
  assert.match(markup, /id="stroke-color" type="color"/);
  assert.match(markup, /id="highlighter-width"/);
  assert.match(markup, /id="highlighter-opacity" type="range"/);
  assert.deepEqual(
    [
      ...(markup
        .match(/<select id="stroke-width">([\s\S]*?)<\/select>/)?.[1]
        .matchAll(/option value="(\d+)"/g) ?? []),
    ].map((match) => Number(match[1])),
    [1, 2, 3, 4, 6]
  );
});
