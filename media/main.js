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
  search: createLucideIcon('<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />'),
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
  ,
  copy: createLucideIcon('<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />'),
  sidebar: createLucideIcon('<path d="M4 5h16v14H4z" /><path d="M9 5v14" />'),
  chevronLeft: createLucideIcon('<path d="m15 18-6-6 6-6" />', 'stroke-width="2.25"'),
  chevronRight: createLucideIcon('<path d="m9 18 6-6-6-6" />', 'stroke-width="2.25"'),
  chevronDown: createLucideIcon('<path d="m6 9 6 6 6-6" />', 'stroke-width="2.25"')
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
  saveQueued: false,
  sidebarOpen: false,
  sidebarTab: 'outline',
  activeOutlineKey: null,
  collapsedOutline: {},
  outline: [],
  searchOpen: false,
  searchQuery: '',
  searchMatches: [],
  activeSearchMatchIndex: -1,
  colorPopoverOwner: null
};

app.innerHTML = `
  <div class="toolbar">
    <button type="button" id="sidebar-toggle" aria-label="Toggle navigation" title="Toggle navigation">${icons.sidebar}</button>
    <label>
      Page
      <input id="page-input" type="number" min="1" value="1" />
      <span class="toolbar-label" id="page-total">/ 1</span>
    </label>
    <div class="zoom-controls">
      <button type="button" id="zoom-out" aria-label="Zoom out">${icons.minus}</button>
      <select id="zoom-preset">
        <option value="automatic">Auto</option>
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
    <div class="mode-wrap">
      <div class="mode-toggle" id="mode-toggle">
        <button type="button" class="mode-button is-active" data-mode="select" aria-label="Select" title="Select">${icons.pointer}</button>
        <button type="button" class="mode-button" data-mode="highlight" aria-label="Highlight" title="Highlight">${icons.highlighter}</button>
        <button type="button" class="mode-button" data-mode="annotate" aria-label="Annotate" title="Annotate">${icons.pen}</button>
        <button type="button" class="mode-button" data-mode="erase" aria-label="Erase" title="Erase">${icons.eraser}</button>
      </div>
    </div>
    <button type="button" id="comment-button" aria-label="Add comment" title="Add comment">${icons.comment}</button>
    <div class="color-popover" id="color-popover" hidden>
      <div class="color-palette" id="color-palette">
        <button type="button" class="color-swatch is-active" data-color="#ef4444" style="--swatch:#ef4444;" aria-label="Red"></button>
        <button type="button" class="color-swatch" data-color="#eab308" style="--swatch:#eab308;" aria-label="Yellow"></button>
        <button type="button" class="color-swatch" data-color="#f97316" style="--swatch:#f97316;" aria-label="Orange"></button>
        <button type="button" class="color-swatch" data-color="#22c55e" style="--swatch:#22c55e;" aria-label="Green"></button>
        <button type="button" class="color-swatch" data-color="#3b82f6" style="--swatch:#3b82f6;" aria-label="Blue"></button>
      </div>
    </div>
    <div class="search-wrap">
      <button type="button" id="search-button" aria-label="Search document" title="Search document">${icons.search}</button>
      <div class="search-panel" id="search-panel" hidden>
        <input id="search-input" type="search" placeholder="Search" spellcheck="false" />
        <span class="search-count" id="search-count">0 / 0</span>
        <button type="button" id="search-prev" aria-label="Previous result" title="Previous">${icons.chevronLeft}</button>
        <button type="button" id="search-next" aria-label="Next result" title="Next">${icons.chevronRight}</button>
        <button type="button" id="search-close" aria-label="Close search" title="Close">${icons.close}</button>
      </div>
    </div>
    <button type="button" id="undo-button" aria-label="Undo" title="Undo">${icons.undo}</button>
    <button type="button" id="redo-button" aria-label="Redo" title="Redo">${icons.redo}</button>
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
  <div class="content-shell" id="content-shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-tabs" id="sidebar-tabs">
        <button type="button" class="sidebar-tab is-active" data-tab="outline" id="outline-tab" hidden>Outline</button>
        <button type="button" class="sidebar-tab" data-tab="pages">Pages</button>
      </div>
      <div class="sidebar-panel" id="outline-panel" hidden>
        <div class="sidebar-list sidebar-outline" id="outline-list"></div>
      </div>
      <div class="sidebar-panel" id="pages-panel">
        <div class="sidebar-list sidebar-pages" id="page-list"></div>
      </div>
    </aside>
    <div class="workspace">
      <div id="pages"></div>
      <div class="empty-state" id="message-box" hidden></div>
    </div>
  </div>
`;

const contentShellEl = document.querySelector('#content-shell');
const toolbarEl = document.querySelector('.toolbar');
const sidebarToggleEl = document.querySelector('#sidebar-toggle');
const sidebarEl = document.querySelector('#sidebar');
const sidebarTabsEl = document.querySelector('#sidebar-tabs');
const outlineTabEl = document.querySelector('#outline-tab');
const pagesPanelEl = document.querySelector('#pages-panel');
const outlinePanelEl = document.querySelector('#outline-panel');
const pageListEl = document.querySelector('#page-list');
const outlineListEl = document.querySelector('#outline-list');
const pageInputEl = document.querySelector('#page-input');
const pageTotalEl = document.querySelector('#page-total');
const zoomInEl = document.querySelector('#zoom-in');
const zoomOutEl = document.querySelector('#zoom-out');
const zoomPresetEl = document.querySelector('#zoom-preset');
const modeToggleEl = document.querySelector('#mode-toggle');
const colorPopoverEl = document.querySelector('#color-popover');
const undoButtonEl = document.querySelector('#undo-button');
const redoButtonEl = document.querySelector('#redo-button');
const commentButtonEl = document.querySelector('#comment-button');
const searchButtonEl = document.querySelector('#search-button');
const searchPanelEl = document.querySelector('#search-panel');
const searchInputEl = document.querySelector('#search-input');
const searchCountEl = document.querySelector('#search-count');
const searchPrevEl = document.querySelector('#search-prev');
const searchNextEl = document.querySelector('#search-next');
const searchCloseEl = document.querySelector('#search-close');
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

function findTextNode(node) {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node;
  }

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSelectedText(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getOutlineKey(item, path) {
  return `${path.join('.')}:${item.pageNumber ?? ''}:${item.title}`;
}

function ensureSidebarItemVisible(container, item) {
  if (!container || !item || container.hidden || sidebarEl.hidden) {
    return;
  }

  const sidebarRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const padding = 12;

  if (itemRect.top < sidebarRect.top + padding) {
    container.scrollTop -= sidebarRect.top + padding - itemRect.top;
    return;
  }

  if (itemRect.bottom > sidebarRect.bottom - padding) {
    container.scrollTop += itemRect.bottom - (sidebarRect.bottom - padding);
  }
}

function expandOutlinePathForPage(items, pageNumber, path = []) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPath = path.concat(index);
    const itemKey = getOutlineKey(item, itemPath);
    if (item.pageNumber === pageNumber) {
      for (let ancestorLength = 1; ancestorLength < itemPath.length; ancestorLength += 1) {
        const ancestorPath = itemPath.slice(0, ancestorLength);
        const ancestor = ancestorPath.reduce((current, pathIndex) => current?.items?.[pathIndex], { items });
        if (ancestor) {
          state.collapsedOutline[getOutlineKey(ancestor, ancestorPath)] = false;
        }
      }
      return true;
    }

    if (item.items?.length && expandOutlinePathForPage(item.items, pageNumber, itemPath)) {
      state.collapsedOutline[itemKey] = false;
      return true;
    }
  }

  return false;
}

function renderSidebar(options = {}) {
  pageListEl.replaceChildren();

  for (const pageEntry of state.pageEntries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sidebar-item page-nav-item';
    button.dataset.page = String(pageEntry.pageNumber);
    button.innerHTML = `
      <img class="page-nav-thumb" src="${pageEntry.thumbnailDataUrl}" alt="Page ${pageEntry.pageNumber} preview" />
      <span class="page-nav-copy">
        <span class="sidebar-item-title">Page ${pageEntry.pageNumber}</span>
      </span>
    `;
    button.addEventListener('click', () => {
        jumpToPage(pageEntry.pageNumber);
      });
    pageListEl.append(button);
  }

  outlineListEl.replaceChildren();
  outlineTabEl.hidden = state.outline.length === 0;
  if (!state.outline.length && state.sidebarTab === 'outline') {
    state.sidebarTab = 'pages';
  } else if (state.outline.length && state.sidebarTab !== 'outline' && !state.sidebarOpen) {
    state.sidebarTab = 'outline';
  }

  function appendOutlineItems(items, path = []) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemPath = path.concat(index);
      const itemKey = getOutlineKey(item, itemPath);
      const isCollapsed = Boolean(state.collapsedOutline[itemKey]);
      const hasChildren = Boolean(item.items?.length);
      const entry = document.createElement(item.pageNumber ? 'button' : 'div');
      entry.className = 'sidebar-item outline-item';
      entry.style.setProperty('--depth', String(item.depth ?? path.length));
      entry.dataset.outlineKey = itemKey;
      if (item.pageNumber) {
        entry.dataset.page = String(item.pageNumber);
        entry.dataset.outlineTop = String(item.topRatio ?? 0);
      }
      entry.innerHTML = `
        <span class="outline-chevron">${hasChildren ? (isCollapsed ? icons.chevronRight : icons.chevronDown) : ''}</span>
        <span class="sidebar-item-title">${escapeHtml(item.title)}</span>
        <span class="sidebar-item-meta"></span>
      `;

      if (item.pageNumber) {
        entry.type = 'button';
        entry.addEventListener('click', () => {
          jumpToPage(item.pageNumber, itemKey);
        });
      } else {
        entry.classList.add('is-static');
      }

      if (hasChildren) {
        entry.classList.add('has-children');
        const chevron = entry.querySelector('.outline-chevron');
        if (chevron) {
          chevron.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            state.collapsedOutline[itemKey] = !isCollapsed;
            renderSidebar();
          });
        }
      }

      outlineListEl.append(entry);

      if (hasChildren && !isCollapsed) {
        appendOutlineItems(item.items, itemPath);
      }
    }
  }

  appendOutlineItems(state.outline);
  updateSidebarTabUI();
  updateSidebarActiveState(options);
}

function updateSidebarActiveState(options = {}) {
  const pageNumber = String(state.currentPage);
  const currentPageEntry = state.pageEntries.find((entry) => entry.pageNumber === state.currentPage);
  const currentPageProgress = currentPageEntry
    ? Math.max(
        0,
        Math.min(1, (workspaceEl.scrollTop - getPageScrollTop(currentPageEntry)) / Math.max(currentPageEntry.height, 1))
      )
    : 0;
  let activePageItem = null;
  for (const item of pageListEl.querySelectorAll('.sidebar-item')) {
    const isActive = item.dataset.page === pageNumber;
    item.classList.toggle('is-active', isActive);
    if (isActive) {
      activePageItem = item;
    }
  }

  const preferredOutlineItem =
    state.activeOutlineKey && outlineListEl.querySelector(`.sidebar-item[data-outline-key="${CSS.escape(state.activeOutlineKey)}"]`);
  let activeOutlineItem = null;
  let bestOutlineDistance = Number.POSITIVE_INFINITY;
  let bestOutlineDepth = -1;

  for (const item of outlineListEl.querySelectorAll('.sidebar-item')) {
    item.classList.remove('is-active');

    if (preferredOutlineItem === item && item.dataset.page === pageNumber) {
      activeOutlineItem = item;
      continue;
    }

    if (!preferredOutlineItem && item.dataset.page === pageNumber) {
      const depth = Number(item.style.getPropertyValue('--depth'));
      const outlineTop = Number(item.dataset.outlineTop ?? '0');
      const distance = Math.abs(outlineTop - currentPageProgress);
      if (
        distance < bestOutlineDistance - 0.0001 ||
        (Math.abs(distance - bestOutlineDistance) <= 0.0001 && depth >= bestOutlineDepth)
      ) {
        bestOutlineDistance = distance;
        bestOutlineDepth = depth;
        activeOutlineItem = item;
      }
    }
  }

  if (activeOutlineItem) {
    activeOutlineItem.classList.add('is-active');
  }

  const activeItem = state.sidebarTab === 'outline' ? activeOutlineItem : activePageItem;
  if (options.reveal && activeItem) {
    ensureSidebarItemVisible(state.sidebarTab === 'outline' ? outlinePanelEl : pagesPanelEl, activeItem);
  }
}

function setSidebarTab(nextTab) {
  state.sidebarTab = nextTab;
  updateSidebarTabUI();
  updateSidebarActiveState({ reveal: true });
}

function updateSidebarTabUI() {
  for (const tab of sidebarTabsEl.querySelectorAll('.sidebar-tab')) {
    tab.classList.toggle('is-active', tab.dataset.tab === state.sidebarTab);
  }

  pagesPanelEl.hidden = state.sidebarTab !== 'pages';
  outlinePanelEl.hidden = state.sidebarTab !== 'outline';
}

function setSidebarOpen(nextOpen) {
  state.sidebarOpen = nextOpen;
  contentShellEl.classList.toggle('is-sidebar-collapsed', !nextOpen);
  sidebarEl.hidden = !nextOpen;
  sidebarToggleEl.classList.toggle('is-active', nextOpen);
  sidebarToggleEl.setAttribute('aria-pressed', String(nextOpen));
  if (nextOpen) {
    updateSidebarTabUI();
    updateSidebarActiveState({ reveal: true });
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function renderSearchHighlights() {
  for (const pageEntry of state.pageEntries) {
    pageEntry.searchLayer.replaceChildren();
  }

  for (let index = 0; index < state.searchMatches.length; index += 1) {
    const match = state.searchMatches[index];
    const pageEntry = state.pageEntries.find((entry) => entry.pageNumber === match.pageNumber);
    if (!pageEntry) {
      continue;
    }

    for (const rect of match.rects) {
      const box = document.createElement('div');
      box.className = `search-box${index === state.activeSearchMatchIndex ? ' is-active' : ''}`;
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      pageEntry.searchLayer.append(box);
    }
  }
}

function setSearchOpen(nextOpen) {
  state.searchOpen = nextOpen;
  searchPanelEl.hidden = !nextOpen;
  searchButtonEl.classList.toggle('is-active', nextOpen);
  if (nextOpen) {
    window.setTimeout(() => {
      searchInputEl.focus();
      searchInputEl.select();
    }, 0);
  }
}

function updateSearchUI() {
  const total = state.searchMatches.length;
  const current = total && state.activeSearchMatchIndex >= 0 ? state.activeSearchMatchIndex + 1 : 0;
  searchCountEl.textContent = `${current} / ${total}`;
  searchPrevEl.disabled = total === 0;
  searchNextEl.disabled = total === 0;
}

function computePageSearchMatches(pageEntry, query) {
  const textItems = pageEntry.textContentItemsStr ?? [];
  const textDivs = pageEntry.textDivs ?? [];
  if (!textItems.length || !textDivs.length) {
    return [];
  }

  const pageText = textItems.join('');
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedText = pageText.toLocaleLowerCase();
  const matches = [];
  const starts = [];
  let total = 0;
  for (const item of textItems) {
    starts.push(total);
    total += item.length;
  }

  function findItemIndex(offset) {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = starts[mid];
      const end = start + textItems[mid].length;
      if (offset < start) {
        high = mid - 1;
      } else if (offset >= end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  let searchIndex = 0;
  while (searchIndex <= normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);
    if (matchIndex === -1) {
      break;
    }

    const endIndex = matchIndex + normalizedQuery.length;
    const startItemIndex = findItemIndex(matchIndex);
    const endItemIndex = findItemIndex(Math.max(matchIndex, endIndex - 1));
    if (startItemIndex === -1 || endItemIndex === -1) {
      searchIndex = matchIndex + 1;
      continue;
    }

    const startNode = findTextNode(textDivs[startItemIndex]);
    const endNode = findTextNode(textDivs[endItemIndex]);
    if (!startNode || !endNode) {
      searchIndex = matchIndex + 1;
      continue;
    }

    const range = document.createRange();
    range.setStart(startNode, matchIndex - starts[startItemIndex]);
    range.setEnd(endNode, endIndex - starts[endItemIndex]);
    const layerRect = pageEntry.textLayer.getBoundingClientRect();
    const scaleX = pageEntry.width / Math.max(layerRect.width, 1);
    const scaleY = pageEntry.height / Math.max(layerRect.height, 1);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: (rect.left - layerRect.left) * scaleX,
        y: (rect.top - layerRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY
      }));

    if (rects.length) {
      matches.push({
        pageNumber: pageEntry.pageNumber,
        rects
      });
    }

    searchIndex = matchIndex + Math.max(normalizedQuery.length, 1);
  }

  return matches;
}

function updateSearchResults(options = {}) {
  const query = state.searchQuery.trim();
  if (!query) {
    state.searchMatches = [];
    state.activeSearchMatchIndex = -1;
    renderSearchHighlights();
    updateSearchUI();
    return;
  }

  const previousMatch = options.preserveActive ? state.searchMatches[state.activeSearchMatchIndex] : null;
  state.searchMatches = state.pageEntries.flatMap((pageEntry) => computePageSearchMatches(pageEntry, query));

  if (!state.searchMatches.length) {
    state.activeSearchMatchIndex = -1;
  } else if (previousMatch) {
    const restoredIndex = state.searchMatches.findIndex(
      (match) =>
        match.pageNumber === previousMatch.pageNumber &&
        Math.abs((match.rects[0]?.y ?? 0) - (previousMatch.rects[0]?.y ?? 0)) < 1
    );
    state.activeSearchMatchIndex = restoredIndex >= 0 ? restoredIndex : 0;
  } else if (state.activeSearchMatchIndex < 0 || state.activeSearchMatchIndex >= state.searchMatches.length) {
    state.activeSearchMatchIndex = 0;
  }

  renderSearchHighlights();
  updateSearchUI();
}

function revealSearchMatch(index) {
  const match = state.searchMatches[index];
  if (!match) {
    return;
  }

  const pageEntry = state.pageEntries.find((entry) => entry.pageNumber === match.pageNumber);
  if (!pageEntry || !match.rects.length) {
    return;
  }

  state.pageJumpInProgress = true;
  state.currentPage = match.pageNumber;
  updatePageIndicator();
  const rect = match.rects[0];
  workspaceEl.scrollTo({
    top: getPageScrollTop(pageEntry) + Math.max(0, rect.y - 32),
    left: Math.max(0, rect.x - 24),
    behavior: 'auto'
  });
  window.setTimeout(() => {
    state.pageJumpInProgress = false;
    updateCurrentPageFromScroll();
  }, 120);
}

function moveSearchMatch(direction) {
  if (!state.searchMatches.length) {
    return;
  }

  const total = state.searchMatches.length;
  const nextIndex =
    state.activeSearchMatchIndex < 0
      ? 0
      : (state.activeSearchMatchIndex + direction + total) % total;
  state.activeSearchMatchIndex = nextIndex;
  renderSearchHighlights();
  updateSearchUI();
  revealSearchMatch(nextIndex);
}

function renderComments(comments) {
  for (const pageEntry of state.pageEntries) {
    pageEntry.commentLayer.replaceChildren();

    for (const comment of comments) {
      if (comment.page !== pageEntry.pageNumber || !comment.rects.length) {
        continue;
      }

      const firstRect = comment.rects[0];
      const anchor = comment.rects[comment.rects.length - 1];
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

      const markerSize = 10;
      const markerLeft = Math.min(
        pageEntry.width - markerSize - 2,
        Math.max(2, (anchor.x + anchor.width) * scaleX + 1)
      );
      const markerTop = Math.min(
        pageEntry.height - markerSize - 2,
        Math.max(2, anchor.y * scaleY - markerSize * 0.7)
      );
      const anchorRight = (anchor.x + anchor.width) * scaleX;
      const anchorTop = firstRect.y * scaleY;
      const anchorBottom = firstRect.y * scaleY + firstRect.height * scaleY;

      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'comment-marker';
      marker.style.left = `${markerLeft}px`;
      marker.style.top = `${markerTop}px`;
      marker.style.backgroundColor = comment.color;
      marker.innerHTML = icons.comment;
      marker.title = 'Open comment';
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.commentComposer) {
          submitCommentComposer();
          if (state.commentComposer) {
            cancelCommentComposer();
          }
        }
        if (state.openCommentId !== comment.id) {
          ensureRightDockVisible(comment.page, 260, 10);
        }
        state.openCommentId = state.openCommentId === comment.id ? null : comment.id;
        renderComments(state.sessionAnnotations.comments);
      });
      pageEntry.commentLayer.append(marker);

      if (state.openCommentId === comment.id) {
        const popupWidth = 260;
        const popupHeight = 72;
        const popupGap = 10;
        const rightDockLeft = pageEntry.width + popupGap;
        const popupTop = Math.min(
          pageEntry.height - popupHeight,
          Math.max(2, anchorTop - 2)
        );
        const connector = document.createElement('div');
        connector.className = 'comment-connector';
        connector.style.left = `${markerLeft + markerSize}px`;
        connector.style.top = `${markerTop + markerSize / 2}px`;
        connector.style.width = `${Math.max(8, rightDockLeft + popupWidth / 2 - (markerLeft + markerSize))}px`;
        connector.style.setProperty('--comment-accent', comment.color);
        pageEntry.commentLayer.append(connector);

        const popup = document.createElement('div');
        popup.className = 'comment-popup';
        popup.style.left = `${rightDockLeft}px`;
        popup.style.top = `${popupTop}px`;
        popup.style.borderColor = comment.color;
        popup.style.setProperty('--comment-accent', comment.color);
        popup.innerHTML = `
          <div class="comment-popup-text"></div>
          <div class="comment-popup-actions">
            <button type="button" class="comment-edit" aria-label="Edit comment" title="Edit">${icons.edit}</button>
            <button type="button" class="comment-delete" aria-label="Delete comment" title="Delete">${icons.trash}</button>
          </div>
        `;
        popup.querySelector('.comment-popup-text').textContent = comment.text;
        popup.querySelector('.comment-edit').addEventListener('click', () => {
          state.openCommentId = null;
          ensureRightDockVisible(comment.page, 210, 10);
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
      const composerWidth = 210;
      const composerHeight = 110;
      const composerGap = 10;
      const anchorTop = anchor.y * scaleY;
      const markerAnchorLeft = Math.max(2, (anchor.x + anchor.width) * scaleX + 1);
      const markerAnchorTop = Math.max(2, anchor.y * scaleY + Math.max(anchor.height * scaleY * 0.5, 4));
      const composer = document.createElement('div');
      composer.className = 'comment-composer';
      const rightDockLeft = pageEntry.width + composerGap;
      const composerTop = Math.min(
        pageEntry.height - composerHeight,
        Math.max(2, anchorTop - 2)
      );
      const connector = document.createElement('div');
      connector.className = 'comment-connector';
      connector.style.left = `${markerAnchorLeft}px`;
      connector.style.top = `${markerAnchorTop}px`;
      connector.style.width = `${Math.max(8, rightDockLeft + composerWidth / 2 - markerAnchorLeft)}px`;
      connector.style.setProperty('--comment-accent', state.commentComposer.color);
      pageEntry.commentLayer.append(connector);

      composer.style.left = `${rightDockLeft}px`;
      composer.style.top = `${composerTop}px`;
      composer.style.borderColor = state.commentComposer.color;
      composer.style.setProperty('--comment-accent', state.commentComposer.color);
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
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          submitCommentComposer();
        }
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
    <button type="button" class="selection-action-button selection-action-copy" aria-label="Copy selection" title="Copy">${icons.copy}</button>
    <button type="button" class="selection-action-button selection-action-highlight" aria-label="Highlight selection" title="Highlight">${icons.highlighter}</button>
    <button type="button" class="selection-action-button selection-action-comment" aria-label="Comment on selection" title="Comment">${icons.comment}</button>
  `;
  actions.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  const [copyButton, highlightButton, commentButton] = actions.querySelectorAll('.selection-action-button');
  copyButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = state.selectionSnapshot?.text?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Best-effort fallback for older clipboard paths.
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.append(fallback);
      fallback.select();
      document.execCommand('copy');
      fallback.remove();
    }
    state.selectionAction = null;
    renderSelectionAction();
  });
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
  const { pages, outline, resolvedScale, fragment } = await renderPdf(
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
  state.outline = outline;
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
  if (state.commentComposer) {
    ensureRightDockVisible(state.commentComposer.page, 210, 10);
  } else if (state.openCommentId) {
    const openComment = state.sessionAnnotations.comments.find((comment) => comment.id === state.openCommentId);
    if (openComment) {
      ensureRightDockVisible(openComment.page, 130, 10);
    }
  }
  updateSearchResults({ preserveActive: true });
  renderSidebar();
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
  if (state.activeOutlineKey) {
    const activeOutlineItem = outlineListEl.querySelector(
      `.sidebar-item[data-outline-key="${CSS.escape(state.activeOutlineKey)}"]`
    );
    if (!activeOutlineItem || activeOutlineItem.dataset.page !== String(closestPage)) {
      state.activeOutlineKey = null;
    }
  }
  updatePageIndicator();
  updateSidebarActiveState();
}

function setActiveColor(color) {
  state.color = color;
  strokeColorEl.value = color;

  for (const swatch of colorPaletteEl.querySelectorAll('.color-swatch')) {
    swatch.classList.toggle('is-active', swatch.dataset.color === color);
  }
}

function ensureRightDockVisible(pageNumber, overlayWidth, gap = 10) {
  const pageEntry = state.pageEntries.find((entry) => entry.pageNumber === pageNumber);
  if (!pageEntry) {
    return;
  }

  const padding = 8;
  const requiredRight = pageEntry.pageShell.offsetLeft + pageEntry.width + gap + overlayWidth + padding;
  const visibleRight = workspaceEl.scrollLeft + workspaceEl.clientWidth;
  if (requiredRight <= visibleRight) {
    return;
  }

  workspaceEl.scrollLeft = Math.max(0, requiredRight - workspaceEl.clientWidth);
}

function setColorPopoverOpen(nextOpen, owner = state.colorPopoverOwner ?? state.mode) {
  const canOpen = owner === 'highlight' || owner === 'annotate' || owner === 'comment';
  const shouldOpen = nextOpen && canOpen;
  state.colorPopoverOwner = shouldOpen ? owner : null;
  colorPopoverEl.hidden = !shouldOpen;

  if (!shouldOpen) {
    colorPopoverEl.style.removeProperty('--popover-left');
    return;
  }

  const triggerButton =
    owner === 'comment'
      ? commentButtonEl
      : modeToggleEl.querySelector(`.mode-button[data-mode="${owner}"]`);
  const toolbarRect = toolbarEl.getBoundingClientRect();
  const buttonRect = triggerButton?.getBoundingClientRect();
  if (!buttonRect) {
    colorPopoverEl.style.setProperty('--popover-left', '0px');
    return;
  }

  const left = buttonRect.left - toolbarRect.left + buttonRect.width / 2;
  colorPopoverEl.style.setProperty('--popover-left', `${left}px`);
}

function jumpToPage(pageNumber, outlineKey = null) {
  const targetPage = state.pageEntries.find((entry) => entry.pageNumber === pageNumber);
  if (!targetPage) {
    return;
  }

  state.pageJumpInProgress = true;
  state.currentPage = pageNumber;
  state.activeOutlineKey = outlineKey;
  const expandedOutline = expandOutlinePathForPage(state.outline, pageNumber);
  updatePageIndicator();
  if (expandedOutline) {
    renderSidebar({ reveal: true });
  } else {
    updateSidebarActiveState({ reveal: true });
  }
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
  setColorPopoverOpen(mode === 'highlight' || mode === 'annotate' || mode === 'comment', mode);
  updateInteractionMode();
}

function updateInteractionMode() {
  for (const button of modeToggleEl.querySelectorAll('.mode-button')) {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  }
  commentButtonEl.classList.toggle('is-active', state.mode === 'comment');

  for (const pageEntry of state.pageEntries) {
    const textInteractionEnabled = state.mode === 'select' || state.mode === 'highlight' || state.mode === 'comment';
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
  renderSelectionAction();
}

function snapshotSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    renderSelectionAction();
    return;
  }

  const range = selection.getRangeAt(0);
  const pageEntry = findPageEntryFromNode(range.commonAncestorContainer);
  if (!pageEntry) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
    renderSelectionAction();
    return;
  }

  const pageRect = pageEntry.textLayer.getBoundingClientRect();
  if (!pageRect.width || !pageRect.height) {
    state.selectionSnapshot = null;
    state.selectionAction = null;
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
    renderSelectionAction();
    return;
  }

  state.selectionSnapshot = {
    page: pageEntry.pageNumber,
    viewportWidth: pageEntry.width,
    viewportHeight: pageEntry.height,
    rects,
    text: normalizeSelectedText(selection.toString())
  };
  const firstRect = rects[0];
  const lastRect = rects[rects.length - 1];
  state.selectionAction = {
    left: Math.min(
      pageEntry.pageShell.offsetLeft + lastRect.x + lastRect.width,
      workspaceEl.scrollLeft + workspaceEl.clientWidth - 88
    ),
    top: Math.min(
      workspaceEl.scrollTop + workspaceEl.clientHeight - 26,
      pageEntry.pageShell.offsetTop + firstRect.y + firstRect.height + 16
    )
  };
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

function isTextEditingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

zoomInEl.addEventListener('click', () => {
  void adjustZoom(0.25);
});

sidebarToggleEl.addEventListener('click', () => {
  setSidebarOpen(!state.sidebarOpen);
});

searchButtonEl.addEventListener('click', () => {
  setSearchOpen(!state.searchOpen);
});

searchInputEl.addEventListener('input', () => {
  state.searchQuery = searchInputEl.value;
  state.activeSearchMatchIndex = -1;
  updateSearchResults();
});

searchInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    moveSearchMatch(event.shiftKey ? -1 : 1);
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    setSearchOpen(false);
  }
});

searchPrevEl.addEventListener('click', () => {
  moveSearchMatch(-1);
});

searchNextEl.addEventListener('click', () => {
  moveSearchMatch(1);
});

searchCloseEl.addEventListener('click', () => {
  setSearchOpen(false);
});

sidebarTabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('.sidebar-tab');
  if (!tab || tab.hidden) {
    return;
  }

  setSidebarTab(tab.dataset.tab);
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
  setMode('comment');
  if (state.selectionSnapshot) {
    addCommentFromSelection();
  }
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
  if (!event.target.closest('.mode-wrap, #comment-button, #color-popover')) {
    setColorPopoverOpen(false);
  }

  if (!event.target.closest('.selection-action')) {
    state.selectionAction = null;
    renderSelectionAction();
  }

  if (!event.target.closest('.comment-marker, .comment-popup, .comment-composer')) {
    state.openCommentId = null;
    renderComments(state.sessionAnnotations.comments);
  }

  if (state.searchOpen && !event.target.closest('.search-wrap')) {
    setSearchOpen(false);
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
    if (state.mode === 'comment') {
      addCommentFromSelection();
      return;
    }
    addHighlightFromSelection();
  }, 0);
});

document.addEventListener('selectionchange', () => {
  snapshotSelection();
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    setSearchOpen(true);
    return;
  }

  if (event.key === 'Escape' && state.searchOpen && !isTextEditingTarget(event.target)) {
    setSearchOpen(false);
    return;
  }

  if (isTextEditingTarget(event.target) || (!event.ctrlKey && !event.metaKey) || event.altKey) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
      return;
    }

    undo();
    return;
  }

  if (key === 'y') {
    event.preventDefault();
    redo();
  }
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
    state.outline = [];
    state.searchOpen = false;
    state.searchQuery = '';
    state.searchMatches = [];
    state.activeSearchMatchIndex = -1;
    setColorPopoverOpen(false);
    searchInputEl.value = '';
    updateSearchUI();
    setSidebarOpen(false);
    setSidebarTab('outline');

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
