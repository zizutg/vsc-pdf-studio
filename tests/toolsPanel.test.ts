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

class PanelElement extends EventTarget {
  hidden = false;
  textContent = '';
  attributes = new Map<string, string>();
  children = new Map<string, PanelElement>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  constructor(readonly ownerDocument: { activeElement: PanelElement | null }) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  querySelector(selector: string) {
    return this.children.get(selector);
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
  const document = { activeElement: null as PanelElement | null };
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

test('color shortcut opens existing panel; Escape closes and returns focus', async () => {
  const f = await fixture(true);
  f.controller.updateMode('select');
  f.colorButtonEl.click();
  assert.equal(f.document.activeElement, f.swatch);
  f.colorButtonEl.click();
  assert.equal(f.panelEl.hidden, false);
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  f.panelEl.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.panelEl.hidden, true);
  assert.equal(f.document.activeElement, f.colorButtonEl);
  assert.equal(f.layoutChanges(), 0, 'overlay must not rerender PDF pages');
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

test('panel retains all preset colors, custom color, and existing pen widths', async () => {
  const { toolsPanelMarkup } = await panelModule;
  const markup = toolsPanelMarkup('');
  assert.doesNotMatch(markup, /tools-panel-title|tools-panel-context|<h[23]/);
  assert.match(
    markup,
    /<section id="tools-width-section" aria-label="Pen size">/
  );
  assert.equal((markup.match(/class="color-swatch/g) ?? []).length, 5);
  assert.match(markup, /id="stroke-color" type="color"/);
  assert.deepEqual(
    [...markup.matchAll(/option value="(\d+)"/g)].map((match) =>
      Number(match[1])
    ),
    [1, 2, 3, 4, 6]
  );
});
