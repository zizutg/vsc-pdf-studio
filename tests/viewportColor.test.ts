import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const viewportModule = readFile(
  path.resolve(__dirname, '../../media/viewport.js'),
  'utf8'
).then(
  (source) =>
    import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
);

test('preset and custom colors share the chip and swatch state', async () => {
  const { createViewportController } = await viewportModule;
  const state = { color: '#ef4444' };
  const strokeColorEl = { value: '' };
  const colorChipEl = { style: { backgroundColor: '' } };
  const colorButtonEl = {
    style: {
      setProperty(name: string, color: string) {
        assert.equal(name, '--active-color');
        assert.equal(color, state.color);
      },
    },
  };
  const swatches = ['#ef4444', '#eab308'].map((color) => {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    return {
      dataset: { color },
      classes,
      attributes,
      classList: {
        toggle(name: string, active: boolean) {
          if (active) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    };
  });
  const controller = createViewportController({
    state,
    strokeColorEl,
    colorChipEl,
    colorButtonEl,
    colorPaletteEl: { querySelectorAll: () => swatches },
  });

  controller.setActiveColor('#eab308');
  assert.equal(strokeColorEl.value, '#eab308');
  assert.equal(colorChipEl.style.backgroundColor, '#eab308');
  assert.equal(swatches[1].attributes.get('aria-pressed'), 'true');

  controller.setActiveColor('#123456');
  assert.equal(strokeColorEl.value, '#123456');
  assert.equal(colorChipEl.style.backgroundColor, '#123456');
  assert.ok(swatches.every((swatch) => !swatch.classes.has('is-active')));
});
