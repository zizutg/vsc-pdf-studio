import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const controllerModule = readFile(
  path.resolve(__dirname, '../../media/toolbarVisibility.js'),
  'utf8'
).then(
  (source) =>
    import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
);

class FakeElement extends EventTarget {
  hidden = false;
  inert = false;
  title = '';
  innerHTML = '';
  hovered = false;
  focusVisible = false;
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  matches(selector: string) {
    return selector === ':hover' ? this.hovered : this.focusVisible;
  }
  contains(element: FakeElement | null) {
    return element === this;
  }
  focus() {
    this.focusVisible = true;
  }
  blur() {
    this.focusVisible = false;
  }
}

async function fixture() {
  const { createToolbarVisibilityController } = await controllerModule;
  const appEl = new FakeElement();
  const toolbarEl = new FakeElement();
  const revealEl = new FakeElement();
  revealEl.hidden = true;
  const pinButtonEl = new FakeElement();
  const documentEl: { activeElement: FakeElement | null } = {
    activeElement: null,
  };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let layoutChanges = 0;
  let popupOpen = false;
  const controller = createToolbarVisibilityController({
    appEl,
    toolbarEl,
    revealEl,
    pinButtonEl,
    icons: { pin: 'pin', pinOff: 'pin-off' },
    isPopupOpen: () => popupOpen,
    onLayoutChange: () => layoutChanges++,
    documentEl,
    setTimer: (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id: number) => timers.delete(id),
  });
  const tick = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const callback of pending) callback();
  };
  return {
    appEl,
    toolbarEl,
    revealEl,
    pinButtonEl,
    documentEl,
    controller,
    tick,
    get layoutChanges() {
      return layoutChanges;
    },
    set popupOpen(value: boolean) {
      popupOpen = value;
    },
  };
}

test('toolbar is pinned by default and only pin changes request layout', async () => {
  const view = await fixture();
  view.tick();
  assert.equal(view.revealEl.hidden, true);
  assert.equal(view.toolbarEl.inert, false);
  assert.equal(view.layoutChanges, 0);

  view.pinButtonEl.dispatchEvent(new Event('click'));
  assert.equal(view.pinButtonEl.attributes.get('aria-pressed'), 'false');
  assert.equal(view.appEl.classes.has('is-toolbar-unpinned'), true);
  assert.equal(view.layoutChanges, 1);
  view.tick();
  assert.equal(view.toolbarEl.inert, true);
  assert.equal(view.revealEl.hidden, false);
  assert.equal(view.layoutChanges, 1);

  view.pinButtonEl.dispatchEvent(new Event('click'));
  assert.equal(view.pinButtonEl.attributes.get('aria-pressed'), 'true');
  assert.equal(view.toolbarEl.inert, false);
  assert.equal(view.revealEl.hidden, true);
  assert.equal(view.layoutChanges, 2);
});

test('top edge and keyboard reveal toolbar; popups defer hiding', async () => {
  const view = await fixture();
  view.controller.setPinned(false);
  view.tick();
  view.revealEl.dispatchEvent(new Event('pointerenter'));
  assert.equal(view.toolbarEl.inert, false);
  assert.equal(view.revealEl.hidden, true);

  view.popupOpen = true;
  view.tick();
  assert.equal(view.toolbarEl.inert, false);
  view.popupOpen = false;
  view.tick();
  assert.equal(view.toolbarEl.inert, true);

  view.revealEl.dispatchEvent(new Event('focus'));
  assert.equal(view.toolbarEl.inert, false);
  assert.equal(view.pinButtonEl.focusVisible, true);
});
