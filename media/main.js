import { createAutoSaver } from './autosave.js';
import { createDrawingLayer } from './drawingLayer.js';
import { renderPdf } from './pdfRenderer.js';

const vscode = acquireVsCodeApi();
const app = document.querySelector('#app');

function createLucideIcon(paths, attrs = '') {
  return `
    <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${attrs}>
      ${paths}
    </svg>
  `;
}

const icons = {
  minus: createLucideIcon('<path d="M5 12h14" />'),
  plus: createLucideIcon('<path d="M12 5v14" /><path d="M5 12h14" />'),
  pen: createLucideIcon(
    '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />'
  ),
  highlighter: createLucideIcon(
    '<path d="m9 11-6 6v3h9l6-6" /><path d="m22 12-4-4" /><path d="M8 16l-2-2" />'
  ),
  comment: createLucideIcon(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h8" /><path d="M8 7h6" />'
  ),
  pointer: createLucideIcon('<path d="m4 4 7.5 18 2.5-7 7-2.5L4 4Z" /><path d="m13 13 6 6" />'),
  eraser: createLucideIcon(
    '<path d="m7 21 10.6-10.6a2 2 0 0 0 0-2.8l-3.2-3.2a2 2 0 0 0-2.8 0L1 15" /><path d="m5 11 8 8" /><path d="M22 21H7" />'
  ),
  undo: createLucideIcon('<path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 1 1 0 14h-1" />'),
  redo: createLucideIcon('<path d="m15 14 5-5-5-5" /><path d="M20 9h-9a7 7 0 1 0 0 14h1" />'),
  menu: createLucideIcon('<path d="M4 12h16" /><path d="M4 6h16" /><path d="M4 18h16" />'),
  floppy: createLucideIcon(
    '<path d="M4 7a2 2 0 0 1 2-2h9l5 5v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M10 5v4h4" /><path d="M8 19v-6h8v6" />'
  ),
  close: createLucideIcon('<path d="m18 6-12 12" /><path d="m6 6 12 12" />'),
  trash: createLucideIcon(
    '<path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />'
  ),
  edit: createLucideIcon('<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />')
};

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
  mode: 'select',
  menuOpen: false,
  pageJumpInProgress: false,
  zoomContext: null,
  gestureZoomBase: null,
  sessionAnnotations: {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    strokes: [],
    highlights: [],
    comments: []
  },
  history: [],
  historyIndex: 0,
  openCommentId: null,
  commentComposer: null,
  selectionSnapshot: null,
  selectionAction: null,
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
      <button type="button" id="zoom-out" aria-label="Zoom out">${icons.minus}</button>
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
      <button type="button" id="zoom-in" aria-label="Zoom in">${icons.plus}</button>
    </div>
    <div class="mode-toggle" id="mode-toggle">
      <button type="button" class="mode-button is-active" data-mode="select" aria-label="Select" title="Select">${icons.pointer}</button>
      <button type="button" class="mode-button" data-mode="highlight" aria-label="Highlight" title="Highlight">${icons.highlighter}</button>
      <button type="button" class="mode-button" data-mode="annotate" aria-label="Annotate" title="Annotate">${icons.pen}</button>
      <button type="button" class="mode-button" data-mode="erase" aria-label="Erase" title="Erase">${icons.eraser}</button>
    </div>
    <button type="button" id="comment-button" aria-label="Add comment" title="Add comment">${icons.comment}</button>
    <button type="button" id="undo-button" aria-label="Undo" title="Undo">${icons.undo}</button>
    <button type="button" id="redo-button" aria-label="Redo" title="Redo">${icons.redo}</button>
    <div class="color-group">
      <div class="color-palette" id="color-palette">
        <button type="button" class="color-swatch is-active" data-color="#ef4444" style="--swatch:#ef4444;" aria-label="Red"></button>
        <button type="button" class="color-swatch" data-color="#eab308" style="--swatch:#eab308;" aria-label="Yellow"></button>
        <button type="button" class="color-swatch" data-color="#f97316" style="--swatch:#f97316;" aria-label="Orange"></button>
        <button type="button" class="color-swatch" data-color="#22c55e" style="--swatch:#22c55e;" aria-label="Green"></button>
        <button type="button" class="color-swatch" data-color="#3b82f6" style="--swatch:#3b82f6;" aria-label="Blue"></button>
      </div>
    </div>
    <div class="menu-wrap">
      <button type="button" id="menu-button" aria-label="More tools" title="More tools">${icons.menu}</button>
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
const commentButtonEl = document.querySelector('#comment-button');
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

state.history = [structuredClone(state.sessionAnnotations)];

function cloneAnnotations(annotations) {
  return structuredClone(annotations);
}

function renderHighlights(highlights) {
  for (const pageEntry of state.pageEntries) {
    pageEntry.highlightLayer.replaceChildren();

    for (const highlight of highlights) {
      if (highlight.page !== pageEntry.pageNumber) {
        continue;
      }

      const scaleX = pageEntry.width / Math.max(highlight.viewportWidth || pageEntry.width, 1);
      const scaleY = pageEntry.height / Math.max(highlight.viewportHeight || pageEntry.height, 1);

      for (const rect of highlight.rects) {
        const box = document.createElement('div');
        box.className = 'highlight-box';
        box.style.left = `${rect.x * scaleX}px`;
        box.style.top = `${rect.y * scaleY}px`;
        box.style.width = `${rect.width * scaleX}px`;
        box.style.height = `${rect.height * scaleY}px`;
        box.style.backgroundColor = highlight.color;
        box.style.opacity = '0.28';
        pageEntry.highlightLayer.append(box);
      }
    }
  }
}

function renderComments(comments) {
  for (const pageEntry of state.pageEntries) {
    pageEntry.commentLayer.replaceChildren();

    for (const comment of comments) {
      if (comment.page !== pageEntry.pageNumber || !comment.rects.length) {
        continue;
      }

      const anchor = comment.rects[0];
      const scaleX = pageEntry.width / Math.max(comment.viewportWidth || pageEntry.width, 1);
      const scaleY = pageEntry.height / Math.max(comment.viewportHeight || pageEntry.height, 1);
      for (const rect of comment.rects) {
        const highlight = document.createElement('div');
        highlight.className = 'highlight-box comment-highlight-box';
        highlight.style.left = `${rect.x * scaleX}px`;
        highlight.style.top = `${rect.y * scaleY}px`;
        highlight.style.width = `${rect.width * scaleX}px`;
        highlight.style.height = `${rect.height * scaleY}px`;
        highlight.style.backgroundColor = comment.color;
        highlight.style.opacity = '0.2';
        pageEntry.commentLayer.append(highlight);
      }

      const markerSize = 13;
      const markerLeft = Math.min(
        pageEntry.width - markerSize - 2,
        Math.max(2, (anchor.x + anchor.width) * scaleX + 2)
      );
      const markerTop = Math.min(
        pageEntry.height - markerSize - 2,
        anchor.y * scaleY + anchor.height * scaleY + 3
      );

      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'comment-marker';
      marker.style.left = `${markerLeft}px`;
      marker.style.top = `${markerTop}px`;
      marker.style.borderColor = comment.color;
      marker.style.color = comment.color;
      marker.innerHTML = icons.comment;
      marker.title = 'Open comment';
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        state.openCommentId = state.openCommentId === comment.id ? null : comment.id;
        renderComments(state.sessionAnnotations.comments);
      });
      pageEntry.commentLayer.append(marker);

      if (state.openCommentId === comment.id) {
        const popup = document.createElement('div');
        popup.className = 'comment-popup';
        popup.style.left = `${Math.min(pageEntry.width - 132, Math.max(2, markerLeft + 8))}px`;
        popup.style.top = `${Math.min(pageEntry.height - 72, markerTop + 2)}px`;
        popup.style.borderColor = comment.color;
        popup.innerHTML = `
          <div class="comment-popup-text"></div>
          <div class="comment-popup-actions">
            <button type="button" class="comment-edit" aria-label="Edit comment" title="Edit">${icons.edit}</button>
            <button type="button" class="comment-delete" aria-label="Delete comment" title="Delete">${icons.trash}</button>
          </div>
        `;
        popup.querySelector('.comment-popup-text').textContent = comment.text;
        popup.querySelector('.comment-edit').addEventListener('click', () => {
          state.commentComposer = {
            id: comment.id,
            page: comment.page,
            viewportWidth: comment.viewportWidth,
            viewportHeight: comment.viewportHeight,
            rects: structuredClone(comment.rects),
            color: comment.color,
            text: comment.text
          };
          renderComments(state.sessionAnnotations.comments);
        });
        popup.querySelector('.comment-delete').addEventListener('click', () => {
          state.openCommentId = null;
          applySessionAnnotations({
            ...state.sessionAnnotations,
            comments: state.sessionAnnotations.comments.filter((candidate) => candidate.id !== comment.id)
          });
        });
        pageEntry.commentLayer.append(popup);
      }
    }

    if (state.commentComposer?.page === pageEntry.pageNumber && state.commentComposer.rects.length) {
      const anchor = state.commentComposer.rects[0];
      const scaleX = pageEntry.width / Math.max(state.commentComposer.viewportWidth || pageEntry.width, 1);
      const scaleY = pageEntry.height / Math.max(state.commentComposer.viewportHeight || pageEntry.height, 1);
      const composer = document.createElement('div');
      composer.className = 'comment-composer';
      composer.style.left = `${Math.min(pageEntry.width - 220, Math.max(2, anchor.x * scaleX))}px`;
      composer.style.top = `${Math.min(
        pageEntry.height - 110,
        anchor.y * scaleY + anchor.height * scaleY + 3
      )}px`;
      composer.innerHTML = `
        <div class="comment-editor-wrap">
          <textarea class="comment-input" placeholder="Add a comment..."></textarea>
          <div class="comment-actions">
            <button type="button" class="comment-save" aria-label="Save comment" title="Save">${icons.floppy}</button>
            <button type="button" class="comment-cancel" aria-label="Close" title="Close">${icons.close}</button>
            ${state.commentComposer.id ? `<button type="button" class="comment-delete" aria-label="Delete comment" title="Delete">${icons.trash}</button>` : ''}
          </div>
        </div>
      `;

      const input = composer.querySelector('.comment-input');
      const saveButton = composer.querySelector('.comment-save');
      const cancelButton = composer.querySelector('.comment-cancel');
      const deleteButton = composer.querySelector('.comment-delete');
      input.value = state.commentComposer.text;
      input.addEventListener('input', () => {
        state.commentComposer.text = input.value;
      });
      saveButton.addEventListener('click', () => {
        submitCommentComposer();
      });
      cancelButton.addEventListener('click', () => {
        cancelCommentComposer();
      });
      deleteButton?.addEventListener('click', () => {
        deleteCommentFromComposer();
      });
      pageEntry.commentLayer.append(composer);
      window.setTimeout(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }, 0);
    }
  }
}

function renderSelectionAction() {
  document.querySelectorAll('.selection-action').forEach((node) => node.remove());

  if (!state.selectionAction) {
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'selection-action';
  actions.style.left = `${state.selectionAction.left}px`;
  actions.style.top = `${state.selectionAction.top}px`;
  actions.innerHTML = `
    <button type="button" class="selection-action-button" aria-label="Highlight selection" title="Highlight">${icons.highlighter}</button>
    <button type="button" class="selection-action-button" aria-label="Comment on selection" title="Comment">${icons.comment}</button>
  `;
  actions.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  const [highlightButton, commentButton] = actions.querySelectorAll('.selection-action-button');
  highlightButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addHighlightFromSelection(true);
  });
  commentButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addCommentFromSelection();
  });
  workspaceEl.append(actions);
}

function applySessionAnnotations(annotations, options = {}) {
  const nextAnnotations = cloneAnnotations(annotations);
  state.sessionAnnotations = nextAnnotations;
  drawingLayer?.load(nextAnnotations.strokes);
  renderHighlights(nextAnnotations.highlights);
  renderComments(nextAnnotations.comments);
  renderSelectionAction();

  if (!options.skipHistory) {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(nextAnnotations);
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
        ...cloneAnnotations(state.sessionAnnotations),
        updatedAt: new Date().toISOString()
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
    getHighlights: () => state.sessionAnnotations.highlights,
    getMode: () => state.mode,
    onChange(allStrokes) {
      applySessionAnnotations({
        ...state.sessionAnnotations,
        strokes: allStrokes
      });
    },
    onErase(_erasedStroke, remainingStrokes) {
      applySessionAnnotations({
        ...state.sessionAnnotations,
        strokes: remainingStrokes
      });
    },
    onEraseHighlight(_erasedHighlight, remainingHighlights) {
      applySessionAnnotations({
        ...state.sessionAnnotations,
        highlights: remainingHighlights
      });
    }
  });
  drawingLayer.load(state.sessionAnnotations.strokes);
  renderHighlights(state.sessionAnnotations.highlights);
  renderComments(state.sessionAnnotations.comments);
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
    const textInteractionEnabled = state.mode === 'select' || state.mode === 'highlight';
    pageEntry.drawingCanvas.style.pointerEvents = textInteractionEnabled ? 'none' : 'auto';
    pageEntry.drawingCanvas.style.cursor =
      state.mode === 'erase' ? 'not-allowed' : textInteractionEnabled ? 'text' : 'crosshair';
    pageEntry.textLayer.style.userSelect = textInteractionEnabled ? 'text' : 'none';
    pageEntry.textLayer.style.pointerEvents = textInteractionEnabled ? 'auto' : 'none';
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

function findPageEntryFromNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const textLayer = element?.closest('.text-layer, .textLayer');
  if (!textLayer) {
    return null;
  }

  return state.pageEntries.find((pageEntry) => pageEntry.textLayer === textLayer) ?? null;
}

function addHighlightFromSelection(force = false) {
  if (!force && state.mode !== 'highlight') {
    return;
  }

  const snapshot = state.selectionSnapshot;
  if (!snapshot) {
    return;
  }

  applySessionAnnotations({
    ...state.sessionAnnotations,
    highlights: state.sessionAnnotations.highlights.concat({
      id: crypto.randomUUID(),
      page: snapshot.page,
      color: state.color,
      viewportWidth: snapshot.viewportWidth,
      viewportHeight: snapshot.viewportHeight,
      rects: structuredClone(snapshot.rects)
    })
  });

  window.getSelection()?.removeAllRanges();
  state.selectionSnapshot = null;
  state.selectionAction = null;
  commentButtonEl.disabled = true;
  renderSelectionAction();
}

function snapshotSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    commentButtonEl.disabled = true;
    renderSelectionAction();
    return;
  }

  const range = selection.getRangeAt(0);
  const pageEntry = findPageEntryFromNode(range.commonAncestorContainer);
  if (!pageEntry) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    commentButtonEl.disabled = true;
    renderSelectionAction();
    return;
  }

  const pageRect = pageEntry.textLayer.getBoundingClientRect();
  if (!pageRect.width || !pageRect.height) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    commentButtonEl.disabled = true;
    renderSelectionAction();
    return;
  }

  const scaleX = pageEntry.width / pageRect.width;
  const scaleY = pageEntry.height / pageRect.height;
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: (rect.left - pageRect.left) * scaleX,
      y: (rect.top - pageRect.top) * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY
    }));

  if (!rects.length) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    commentButtonEl.disabled = true;
    renderSelectionAction();
    return;
  }

  state.selectionSnapshot = {
    page: pageEntry.pageNumber,
    viewportWidth: pageEntry.width,
    viewportHeight: pageEntry.height,
    rects,
    text: selection.toString().trim()
  };
  const firstRect = rects[0];
  state.selectionAction = {
    left: Math.min(
      pageEntry.pageShell.offsetLeft + firstRect.x,
      workspaceEl.scrollLeft + workspaceEl.clientWidth - 88
    ),
    top: Math.min(
      workspaceEl.scrollTop + workspaceEl.clientHeight - 26,
      pageEntry.pageShell.offsetTop + firstRect.y + firstRect.height + 3
    )
  };
  commentButtonEl.disabled = false;
  renderSelectionAction();
}

function addCommentFromSelection() {
  if (!state.selectionSnapshot) {
    return;
  }

  state.commentComposer = {
    id: null,
    page: state.selectionSnapshot.page,
    viewportWidth: state.selectionSnapshot.viewportWidth,
    viewportHeight: state.selectionSnapshot.viewportHeight,
    rects: structuredClone(state.selectionSnapshot.rects),
    color: state.color,
    text: ''
  };
  state.selectionAction = null;
  renderComments(state.sessionAnnotations.comments);
  renderSelectionAction();
}

function cancelCommentComposer() {
  state.commentComposer = null;
  renderComments(state.sessionAnnotations.comments);
}

function deleteCommentFromComposer() {
  if (!state.commentComposer?.id) {
    cancelCommentComposer();
    return;
  }

  const commentId = state.commentComposer.id;
  state.commentComposer = null;
  state.openCommentId = null;
  applySessionAnnotations({
    ...state.sessionAnnotations,
    comments: state.sessionAnnotations.comments.filter((comment) => comment.id !== commentId)
  });
}

function submitCommentComposer() {
  if (!state.commentComposer || !state.commentComposer.text.trim()) {
    return;
  }

  const nextComment = {
    id: state.commentComposer.id ?? crypto.randomUUID(),
    page: state.commentComposer.page,
    viewportWidth: state.commentComposer.viewportWidth,
    viewportHeight: state.commentComposer.viewportHeight,
    rects: structuredClone(state.commentComposer.rects),
    color: state.commentComposer.color,
    text: state.commentComposer.text.trim()
  };

  state.openCommentId = nextComment.id;
  state.commentComposer = null;
  applySessionAnnotations({
    ...state.sessionAnnotations,
    comments: state.sessionAnnotations.comments.some((comment) => comment.id === nextComment.id)
      ? state.sessionAnnotations.comments.map((comment) =>
          comment.id === nextComment.id ? nextComment : comment
        )
      : state.sessionAnnotations.comments.concat(nextComment)
  });
  window.getSelection()?.removeAllRanges();
  state.selectionSnapshot = null;
  state.selectionAction = null;
  commentButtonEl.disabled = true;
  renderSelectionAction();
}

function undo() {
  if (state.historyIndex <= 0) {
    return;
  }

  state.historyIndex -= 1;
  applySessionAnnotations(state.history[state.historyIndex], {
    skipHistory: true
  });
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) {
    return;
  }

  state.historyIndex += 1;
  applySessionAnnotations(state.history[state.historyIndex], {
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

commentButtonEl.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

commentButtonEl.addEventListener('click', () => {
  addCommentFromSelection();
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
  if (!event.target.closest('.selection-action')) {
    state.selectionAction = null;
    renderSelectionAction();
  }

  if (!event.target.closest('.comment-marker, .comment-popup, .comment-composer')) {
    state.openCommentId = null;
    renderComments(state.sessionAnnotations.comments);
  }

  if (menuPanelEl.hidden) {
    return;
  }

  if (menuPanelEl.contains(event.target) || menuButtonEl.contains(event.target)) {
    return;
  }

  setMenuOpen(false);
});

window.addEventListener('mouseup', () => {
  window.setTimeout(() => {
    snapshotSelection();
    addHighlightFromSelection();
  }, 0);
});

document.addEventListener('selectionchange', () => {
  snapshotSelection();
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
    state.sessionAnnotations = structuredClone(message.payload.annotations);
    state.history = [structuredClone(state.sessionAnnotations)];
    state.historyIndex = 0;
    state.openCommentId = null;
    state.commentComposer = null;
    state.selectionSnapshot = null;
    state.selectionAction = null;
    commentButtonEl.disabled = true;

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
