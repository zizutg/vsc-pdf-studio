import { createAutoSaver } from './autosave.js';
import { createDrawingLayer } from './drawingLayer.js';
import { renderPdf } from './pdfRenderer.js';

const vscode = acquireVsCodeApi();
const app = document.querySelector('#app');

const state = {
  fileName: 'PDF',
  pdfBase64: '',
  pageEntries: [],
  zoomMode: 'automatic',
  zoom: 1.25,
  renderedZoom: 1.25,
  currentPage: 1,
  totalPages: 0,
  color: '#ef4444',
  mode: 'annotate',
  menuOpen: false,
  pageJumpInProgress: false,
  zoomContext: null,
  gestureZoomBase: null,
  sessionStrokes: [],
  history: [[]],
  historyIndex: 0,
  saveInFlight: false,
  saveQueued: false
};

app.innerHTML = `
  <div class="toolbar">
    <label>
      Page
      <input id="page-input" type="number" min="1" value="1" />
      <span class="toolbar-label" id="page-total">/ 1</span>
    </label>
    <div class="zoom-controls">
      <button type="button" id="zoom-out" aria-label="Zoom out">-</button>
      <select id="zoom-preset">
        <option value="automatic">Automatic Zoom</option>
        <option value="actual-size">Actual Size</option>
        <option value="page-fit">Page Fit</option>
        <option value="page-width">Page Width</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="3">300%</option>
        <option value="4">400%</option>
        <option value="10">1000%</option>
        <option value="custom">Custom</option>
      </select>
      <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
    </div>
    <div class="mode-toggle" id="mode-toggle">
      <button type="button" class="mode-button is-active" data-mode="annotate" aria-label="Annotate" title="Annotate">✎</button>
      <button type="button" class="mode-button" data-mode="select" aria-label="Select" title="Select">↖</button>
      <button type="button" class="mode-button" data-mode="erase" aria-label="Erase" title="Erase">⌫</button>
    </div>
    <button type="button" id="undo-button" aria-label="Undo" title="Undo">↩</button>
    <button type="button" id="redo-button" aria-label="Redo" title="Redo">↪</button>
    <div class="color-group">
      <div class="color-palette" id="color-palette">
        <button type="button" class="color-swatch is-active" data-color="#ef4444" style="--swatch:#ef4444;" aria-label="Red"></button>
        <button type="button" class="color-swatch" data-color="#f97316" style="--swatch:#f97316;" aria-label="Orange"></button>
        <button type="button" class="color-swatch" data-color="#22c55e" style="--swatch:#22c55e;" aria-label="Green"></button>
        <button type="button" class="color-swatch" data-color="#3b82f6" style="--swatch:#3b82f6;" aria-label="Blue"></button>
      </div>
    </div>
    <div class="menu-wrap">
      <button type="button" id="menu-button" aria-label="More tools" title="More tools">☰</button>
      <div class="menu-panel" id="menu-panel" hidden>
        <label>
          Custom Color
          <input id="stroke-color" type="color" value="#ef4444" />
        </label>
        <label>
          Width
          <select id="stroke-width">
            <option value="1">1 pt</option>
            <option value="2">2 pt</option>
            <option value="3" selected>3 pt</option>
            <option value="4">4 pt</option>
            <option value="6">6 pt</option>
          </select>
        </label>
      </div>
    </div>
  </div>
  <div class="workspace">
    <div id="pages"></div>
    <div class="empty-state" id="message-box" hidden></div>
  </div>
`;

const pageInputEl = document.querySelector('#page-input');
const pageTotalEl = document.querySelector('#page-total');
const zoomInEl = document.querySelector('#zoom-in');
const zoomOutEl = document.querySelector('#zoom-out');
const zoomPresetEl = document.querySelector('#zoom-preset');
const modeToggleEl = document.querySelector('#mode-toggle');
const undoButtonEl = document.querySelector('#undo-button');
const redoButtonEl = document.querySelector('#redo-button');
const menuButtonEl = document.querySelector('#menu-button');
const menuPanelEl = document.querySelector('#menu-panel');
const colorPaletteEl = document.querySelector('#color-palette');
const strokeColorEl = document.querySelector('#stroke-color');
const strokeWidthEl = document.querySelector('#stroke-width');
const workspaceEl = document.querySelector('.workspace');
const pagesEl = document.querySelector('#pages');
const messageBoxEl = document.querySelector('#message-box');

let drawingLayer = null;
let zoomRerenderTimer = null;
let zoomRenderRequestId = 0;
let resizeRerenderTimer = null;

const autoSaver = createAutoSaver(() => {
  requestSave();
});

function cloneStrokes(strokes) {
  return structuredClone(strokes);
}

function applySessionStrokes(strokes, options = {}) {
  const nextStrokes = cloneStrokes(strokes);
  state.sessionStrokes = nextStrokes;
  drawingLayer?.load(nextStrokes);

  if (!options.skipHistory) {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(nextStrokes);
    state.historyIndex = state.history.length - 1;
  }

  updateHistoryState();

  if (!options.skipSave) {
    autoSaver.queue();
  }
}

function requestSave() {
  if (state.saveInFlight) {
    state.saveQueued = true;
    return;
  }

  state.saveInFlight = true;
  state.saveQueued = false;

  vscode.postMessage({
    type: 'annotationsChanged',
    payload: {
      annotations: {
        version: 1,
        updatedAt: new Date().toISOString(),
        strokes: cloneStrokes(state.sessionStrokes)
      }
    }
  });
}

async function rerenderPages() {
  const requestId = ++zoomRenderRequestId;
  const workspaceSize = {
    width: workspaceEl.clientWidth,
    height: workspaceEl.clientHeight
  };
  const { pages, resolvedScale, fragment } = await renderPdf(
    state.pdfBase64,
    pagesEl,
    getZoomConfig(),
    workspaceSize
  );

  if (requestId !== zoomRenderRequestId) {
    return;
  }

  pagesEl.replaceChildren(fragment);
  state.pageEntries = pages;
  state.zoom = resolvedScale;
  state.renderedZoom = resolvedScale;
  state.totalPages = state.pageEntries.length;
  state.currentPage = Math.min(state.currentPage, state.totalPages || 1);

  drawingLayer = createDrawingLayer(state.pageEntries, {
    getColor: () => state.color,
    getWidth: () => Number(strokeWidthEl.value),
    getMode: () => state.mode,
    onChange(allStrokes) {
      applySessionStrokes(allStrokes);
    },
    onErase(_erasedStroke, remainingStrokes) {
      applySessionStrokes(remainingStrokes);
    }
  });
  drawingLayer.load(state.sessionStrokes);
  updatePageIndicator();
  updateZoomPresetIndicator();
  updateInteractionMode();
  restoreZoomViewport();
}

function updatePageIndicator() {
  pageInputEl.value = String(state.currentPage);
  pageInputEl.max = String(Math.max(state.totalPages, 1));
  pageTotalEl.textContent = `/ ${Math.max(state.totalPages, 1)}`;
}

function updateZoomPresetIndicator() {
  if (state.zoomMode !== 'custom') {
    zoomPresetEl.value = state.zoomMode;
    return;
  }

  const matchingOption = Array.from(zoomPresetEl.options).find(
    (option) => !Number.isNaN(Number(option.value)) && Math.abs(Number(option.value) - state.zoom) < 0.01
  );

  zoomPresetEl.value = matchingOption ? matchingOption.value : 'custom';
}

function updateCurrentPageFromScroll() {
  if (!state.pageEntries.length || state.pageJumpInProgress) {
    return;
  }

  const viewportTop = workspaceEl.scrollTop;
  let closestPage = state.pageEntries[0].pageNumber;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const pageEntry of state.pageEntries) {
    const distance = Math.abs(getPageScrollTop(pageEntry) - viewportTop);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = pageEntry.pageNumber;
    }
  }

  state.currentPage = closestPage;
  updatePageIndicator();
}

function setActiveColor(color) {
  state.color = color;
  strokeColorEl.value = color;

  for (const swatch of colorPaletteEl.querySelectorAll('.color-swatch')) {
    swatch.classList.toggle('is-active', swatch.dataset.color === color);
  }
}

function jumpToPage(pageNumber) {
  const targetPage = state.pageEntries.find((entry) => entry.pageNumber === pageNumber);
  if (!targetPage) {
    return;
  }

  state.pageJumpInProgress = true;
  state.currentPage = pageNumber;
  updatePageIndicator();
  targetPage.pageShell.scrollIntoView({
    behavior: 'auto',
    block: 'start',
    inline: 'nearest'
  });

  window.setTimeout(() => {
    state.pageJumpInProgress = false;
    updateCurrentPageFromScroll();
  }, 150);
}

function setMode(mode) {
  state.mode = mode;
  updateInteractionMode();
}

function updateInteractionMode() {
  for (const button of modeToggleEl.querySelectorAll('.mode-button')) {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  }

  for (const pageEntry of state.pageEntries) {
    pageEntry.drawingCanvas.style.pointerEvents = state.mode === 'select' ? 'none' : 'auto';
    pageEntry.drawingCanvas.style.cursor =
      state.mode === 'erase' ? 'not-allowed' : state.mode === 'select' ? 'default' : 'crosshair';
    pageEntry.textLayer.style.userSelect = state.mode === 'select' ? 'text' : 'none';
    pageEntry.textLayer.style.pointerEvents = state.mode === 'select' ? 'auto' : 'none';
  }
}

function updateHistoryState() {
  undoButtonEl.disabled = state.historyIndex <= 0;
  redoButtonEl.disabled = state.historyIndex >= state.history.length - 1;
}

function setMenuOpen(nextOpen) {
  state.menuOpen = nextOpen;
  menuPanelEl.hidden = !nextOpen;
  menuButtonEl.classList.toggle('is-active', nextOpen);
}

function undo() {
  if (state.historyIndex <= 0) {
    return;
  }

  state.historyIndex -= 1;
  applySessionStrokes(state.history[state.historyIndex], {
    skipHistory: true
  });
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) {
    return;
  }

  state.historyIndex += 1;
  applySessionStrokes(state.history[state.historyIndex], {
    skipHistory: true
  });
}

async function adjustZoom(delta) {
  const nextZoom = Math.max(0.5, Math.min(10, Number((state.zoom + delta).toFixed(2))));
  if (nextZoom === state.zoom || !state.pdfBase64) {
    return;
  }

  state.zoomMode = 'custom';
  state.zoomContext = createZoomContext();
  state.zoom = nextZoom;
  scheduleZoomRerender();
}

function scheduleZoomRerender() {
  if (zoomRerenderTimer) {
    window.clearTimeout(zoomRerenderTimer);
  }

  zoomRerenderTimer = window.setTimeout(() => {
    zoomRerenderTimer = null;
    void rerenderPages();
  }, 140);
}

function scheduleResponsiveRerender() {
  if (resizeRerenderTimer) {
    window.clearTimeout(resizeRerenderTimer);
  }

  resizeRerenderTimer = window.setTimeout(() => {
    resizeRerenderTimer = null;

    if (!state.pdfBase64) {
      return;
    }

    if (!['automatic', 'page-fit', 'page-width'].includes(state.zoomMode)) {
      return;
    }

    state.zoomContext = createZoomContext();
    void rerenderPages();
  }, 120);
}

function createZoomContext(anchorClientX, anchorClientY) {
  const workspaceRect = workspaceEl.getBoundingClientRect();
  const clientX = anchorClientX ?? workspaceRect.left + workspaceRect.width / 2;
  const clientY = anchorClientY ?? workspaceRect.top + workspaceRect.height / 2;
  const anchorX = workspaceEl.scrollLeft + (clientX - workspaceRect.left);
  const anchorY = workspaceEl.scrollTop + (clientY - workspaceRect.top);

  return {
    previousZoom: state.renderedZoom,
    anchorX,
    anchorY,
    offsetX: clientX - workspaceRect.left,
    offsetY: clientY - workspaceRect.top
  };
}

function restoreZoomViewport() {
  const zoomContext = state.zoomContext;
  if (!zoomContext) {
    return;
  }

  const ratio = state.zoom / zoomContext.previousZoom;
  workspaceEl.scrollLeft = zoomContext.anchorX * ratio - zoomContext.offsetX;
  workspaceEl.scrollTop = zoomContext.anchorY * ratio - zoomContext.offsetY;
  state.zoomContext = null;
  clearVisualZoomPreview();
}

function ensureZoomContext(anchorClientX, anchorClientY) {
  if (!state.zoomContext) {
    state.zoomContext = createZoomContext(anchorClientX, anchorClientY);
  }
}

function applyVisualZoomPreview() {
  if (!state.zoomContext) {
    return;
  }

  const ratio = state.zoom / state.zoomContext.previousZoom;
  pagesEl.style.transformOrigin = `${state.zoomContext.anchorX}px ${state.zoomContext.anchorY}px`;
  pagesEl.style.transform = `scale(${ratio})`;
  pagesEl.classList.add('is-zooming');
}

function clearVisualZoomPreview() {
  pagesEl.style.transform = '';
  pagesEl.style.transformOrigin = '';
  pagesEl.classList.remove('is-zooming');
}

function applyWheelZoom(event) {
  if (!state.pdfBase64 || (!event.ctrlKey && !event.metaKey)) {
    return;
  }

  event.preventDefault();

  const zoomFactor = Math.exp(-event.deltaY * 0.0025);
  const nextZoom = Math.max(0.5, Math.min(10, Number((state.zoom * zoomFactor).toFixed(2))));
  if (nextZoom === state.zoom) {
    return;
  }

  state.zoomMode = 'custom';
  ensureZoomContext(event.clientX, event.clientY);
  state.zoom = nextZoom;
  applyVisualZoomPreview();
  scheduleZoomRerender();
}

function applyGestureZoomStart(event) {
  if (!state.pdfBase64) {
    return;
  }

  event.preventDefault();
  state.gestureZoomBase = state.zoom;
  state.zoomContext = createZoomContext(event.clientX, event.clientY);
  applyVisualZoomPreview();
}

function applyGestureZoomChange(event) {
  if (!state.pdfBase64 || state.gestureZoomBase === null) {
    return;
  }

  event.preventDefault();
  state.zoomMode = 'custom';
  state.zoom = Math.max(0.5, Math.min(10, Number((state.gestureZoomBase * event.scale).toFixed(2))));
  applyVisualZoomPreview();
  scheduleZoomRerender();
}

function applyGestureZoomEnd() {
  state.gestureZoomBase = null;
}

function applyZoomPreset(value) {
  if (value === 'custom') {
    return;
  }

  if (value === 'automatic' || value === 'actual-size' || value === 'page-fit' || value === 'page-width') {
    state.zoomMode = value;
    state.zoomContext = createZoomContext();
    scheduleZoomRerender();
    return;
  }

  const numericZoom = Number(value);
  if (!Number.isFinite(numericZoom)) {
    return;
  }

  state.zoomMode = 'custom';
  state.zoom = Math.max(0.5, Math.min(10, numericZoom));
  state.zoomContext = createZoomContext();
  applyVisualZoomPreview();
  scheduleZoomRerender();
}

function getZoomConfig() {
  if (state.zoomMode === 'custom') {
    return {
      mode: 'custom',
      scale: state.zoom
    };
  }

  return {
    mode: state.zoomMode,
    scale: state.zoom
  };
}

function getPageScrollTop(pageEntry) {
  return pageEntry.pageShell.offsetTop;
}

zoomInEl.addEventListener('click', () => {
  void adjustZoom(0.25);
});

zoomOutEl.addEventListener('click', () => {
  void adjustZoom(-0.25);
});

zoomPresetEl.addEventListener('change', () => {
  applyZoomPreset(zoomPresetEl.value);
});

function applyTypedPageJump() {
  const requestedPage = Number(pageInputEl.value);
  if (!Number.isFinite(requestedPage)) {
    updatePageIndicator();
    return;
  }

  const clampedPage = Math.min(Math.max(Math.round(requestedPage), 1), Math.max(state.totalPages, 1));
  jumpToPage(clampedPage);
}

pageInputEl.addEventListener('change', applyTypedPageJump);
pageInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    applyTypedPageJump();
  }
});

modeToggleEl.addEventListener('click', (event) => {
  const button = event.target.closest('.mode-button');
  if (!button) {
    return;
  }

  setMode(button.dataset.mode);
});

undoButtonEl.addEventListener('click', () => {
  undo();
});

redoButtonEl.addEventListener('click', () => {
  redo();
});

menuButtonEl.addEventListener('click', () => {
  setMenuOpen(!state.menuOpen);
});

colorPaletteEl.addEventListener('click', (event) => {
  const swatch = event.target.closest('.color-swatch');
  if (!swatch) {
    return;
  }

  setActiveColor(swatch.dataset.color);
});

strokeColorEl.addEventListener('input', () => {
  setActiveColor(strokeColorEl.value);
});

window.addEventListener('click', (event) => {
  if (menuPanelEl.hidden) {
    return;
  }

  if (menuPanelEl.contains(event.target) || menuButtonEl.contains(event.target)) {
    return;
  }

  setMenuOpen(false);
});

workspaceEl.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });
workspaceEl.addEventListener('wheel', applyWheelZoom, { passive: false });
window.addEventListener('resize', scheduleResponsiveRerender, { passive: true });
window.addEventListener('wheel', applyWheelZoom, { passive: false, capture: true });
window.addEventListener('gesturestart', applyGestureZoomStart, { passive: false, capture: true });
window.addEventListener('gesturechange', applyGestureZoomChange, { passive: false, capture: true });
window.addEventListener('gestureend', applyGestureZoomEnd, { passive: true, capture: true });

window.addEventListener('message', async (event) => {
  const message = event.data;

  if (message.type === 'init') {
    state.fileName = message.payload.fileName;
    state.pdfBase64 = message.payload.pdfBase64;

    try {
      await rerenderPages();
      messageBoxEl.hidden = true;
    } catch (error) {
      messageBoxEl.hidden = false;
      messageBoxEl.textContent = error instanceof Error ? error.message : 'Failed to load PDF.';
    }
  }

  if (message.type === 'saved') {
    state.saveInFlight = false;
    if (state.saveQueued) {
      requestSave();
    }
  }

  if (message.type === 'error') {
    state.saveInFlight = false;
    state.saveQueued = true;
    messageBoxEl.hidden = false;
    messageBoxEl.textContent = message.payload.message;
  }
});

setActiveColor(state.color);
updateHistoryState();
vscode.postMessage({ type: 'ready' });
