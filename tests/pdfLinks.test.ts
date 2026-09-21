import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { parseWebviewMessage } from '../src/validation/messages';

const linksModule = readFile(
  path.resolve(__dirname, '../../media/pdfLinks.js'),
  'utf8'
).then(
  (source) =>
    import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
);

test('external PDF link messages accept web and email URLs only', () => {
  for (const url of [
    'https://example.com/path?q=a%20b#section',
    'http://localhost:3000/',
    'mailto:reader@example.com?subject=PDF%20review',
  ]) {
    assert.deepEqual(
      parseWebviewMessage({ type: 'openExternalLink', payload: { url } }),
      {
        type: 'openExternalLink',
        payload: { url },
      }
    );
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
    assert.equal(
      parseWebviewMessage({ type: 'openExternalLink', payload: { url } }),
      null
    );
  }
  assert.equal(parseWebviewMessage({ type: 'openExternalLink' }), null);
});

async function withLinkPdf(run: (pdf: PDFDocumentProxy) => Promise<void>) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  const target = document.addPage([400, 500]);
  const addLink = (extra: Record<string, any>, rect = [40, 420, 140, 440]) => {
    page.node.addAnnot(
      document.context.register(
        document.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: rect,
          ...extra,
        })
      )
    );
  };
  addLink({ A: { S: 'URI', URI: PDFString.of('https://example.com/review') } });
  addLink({ A: { S: 'URI', URI: PDFString.of('mailto:reader@example.com') } });
  addLink({ Dest: [target.ref, 'XYZ', 50, 400, null] });
  addLink({ Dest: PDFString.of('chapter-two') });
  document.catalog.set(
    PDFName.of('Names'),
    document.context.obj({
      Dests: {
        Names: [
          PDFString.of('chapter-two'),
          { D: [target.ref, 'FitR', 20, 250, 150, 350] },
        ],
      },
    })
  );
  addLink({ A: { S: 'URI', URI: PDFString.of('javascript:alert(1)') } });
  addLink({
    A: { S: 'URI', URI: PDFString.of('file:///private/document.pdf') },
  });
  addLink({ Dest: PDFString.of('missing-destination') });
  addLink({
    F: 2,
    A: { S: 'URI', URI: PDFString.of('https://example.com/hidden') },
  });
  addLink({
    Subtype: 'Text',
    Contents: PDFString.of('Keep this as a comment'),
  });
  addLink({
    Subtype: 'Highlight',
    Contents: PDFString.of('Keep this as markup'),
  });
  addLink(
    { A: { S: 'URI', URI: PDFString.of('https://example.com/zero') } },
    [0, 0, 0, 0]
  );

  const loadingTask = getDocument({ data: await document.save() });
  try {
    await run(await loadingTask.promise);
  } finally {
    await loadingTask.destroy();
  }
}

test('PDF.js links resolve external URLs and explicit/named destinations without importing comments', async () => {
  const { createPdfLinkReader } = await linksModule;
  await withLinkPdf(async (pdf) => {
    const page = await pdf.getPage(1);
    const readLinks = createPdfLinkReader(pdf);
    const links = await readLinks(1, page.getViewport({ scale: 1 }));
    assert.equal(links.length, 4);
    assert.equal(links[0].url, 'https://example.com/review');
    assert.equal(links[1].url, 'mailto:reader@example.com');
    assert.deepEqual(links[2].destination, {
      pageNumber: 2,
      leftRatio: 0.125,
      topRatio: 0.2,
    });
    assert.deepEqual(links[3].destination, {
      pageNumber: 2,
      leftRatio: 0.05,
      topRatio: 0.3,
    });
    assert.deepEqual(links[0].rects, [
      { left: 40, top: 60, width: 100, height: 20 },
    ]);
    assert.equal(
      (await readLinks(2, (await pdf.getPage(2)).getViewport({ scale: 1 })))
        .length,
      0
    );
  });
});

test('link hit regions follow page zoom and rotation', async () => {
  const { createPdfLinkReader } = await linksModule;
  await withLinkPdf(async (pdf) => {
    const page = await pdf.getPage(1);
    const readLinks = createPdfLinkReader(pdf);
    const zoomed = await readLinks(1, page.getViewport({ scale: 2 }));
    assert.deepEqual(zoomed[0].rects, [
      { left: 80, top: 120, width: 200, height: 40 },
    ]);
    const rotated = await readLinks(
      1,
      page.getViewport({ scale: 1, rotation: 90 })
    );
    assert.deepEqual(rotated[0].rects, [
      { left: 420, top: 40, width: 20, height: 100 },
    ]);
  });
});

test('wrapped links use their individual quad regions instead of covering intervening text', async () => {
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
    assert.deepEqual(links[0].rects, [
      { left: 40, top: 60, width: 100, height: 20 },
      { left: 40, top: 100, width: 60, height: 20 },
    ]);
  });
});

class TestElement extends EventTarget {
  children: TestElement[] = [];
  style: Record<string, string> = {};
  className = '';
  title = '';
  hidden = false;
  href = '';
  tabIndex = 0;
  draggable = true;
  private classes = new Set<string>();
  classList = {
    add: (value: string) => this.classes.add(value),
    remove: (value: string) => this.classes.delete(value),
  };
  attributes = new Map<string, string>();

  constructor(readonly ownerDocument: any) {
    super();
  }
  append(child: TestElement) {
    this.children.push(child);
  }
  contains(child: TestElement): boolean {
    return (
      this === child || this.children.some((entry) => entry.contains(child))
    );
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return { left: 20, top: 30, width: 400, height: 500 };
  }
}

async function createInteractionFixture() {
  const { attachPdfLinks } = await linksModule;
  const selection = { isCollapsed: true };
  const document: any = {
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
  const opened: string[] = [];
  const navigated: unknown[] = [];
  const destination = { pageNumber: 2, leftRatio: 0, topRatio: 0.3 };
  const controller = attachPdfLinks(
    {
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
    },
    {
      openExternal: (url: string) => opened.push(url),
      navigate: (value: unknown) => navigated.push(value),
    }
  );
  const fire = (type: string, properties: Record<string, unknown> = {}) => {
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

test('Select-mode pointer and keyboard links activate once', async () => {
  const fixture = await createInteractionFixture();
  fixture.controller.setEnabled(true);
  fixture.fire('pointerdown');
  fixture.fire('click');
  assert.deepEqual(fixture.opened, ['https://example.com/']);
  fixture.fire('pointerdown', { clientY: 140 });
  fixture.fire('click', { clientY: 140 });
  assert.deepEqual(fixture.navigated, [fixture.destination]);
  const layer = fixture.pageShell.children.at(-1)!;
  const event = new Event('click', { cancelable: true });
  layer.children[0].dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.opened.length, 2);
});

test('disabled links do not intercept drawing or remain keyboard-focusable', async () => {
  const fixture = await createInteractionFixture();
  fixture.controller.setEnabled(false);
  assert.equal(fixture.fire('pointerdown').defaultPrevented, false);
  assert.equal(fixture.fire('click').defaultPrevented, false);
  const layer = fixture.pageShell.children.at(-1)!;
  assert.equal(layer.hidden, true);
  layer.children[0].dispatchEvent(new Event('click', { cancelable: true }));
  assert.deepEqual(fixture.opened, []);
});

test('text selection, pointer cancellation, eraser/right-click, and form clicks never activate a link', async () => {
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
  assert.deepEqual(fixture.opened, []);
  assert.deepEqual(fixture.navigated, []);
});
