export function createSelectionController({
  state,
  workspaceEl,
  normalizeSelectedText,
  applySessionAnnotations,
  renderSelectionAction,
  renderComments,
}) {
  function findPageEntryFromNode(node) {
    const element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const textLayer = element?.closest('.text-layer, .textLayer');
    if (!textLayer) {
      return null;
    }

    return (
      state.pageEntries.find(
        (pageEntry) => pageEntry.textLayer === textLayer
      ) ?? null
    );
  }

  function addHighlightFromSelection(force = false, kind = 'highlight') {
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
        kind,
        page: snapshot.page,
        color: state.color,
        viewportWidth: snapshot.viewportWidth,
        viewportHeight: snapshot.viewportHeight,
        rects: structuredClone(snapshot.rects),
      }),
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
        height: rect.height * scaleY,
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
      text: normalizeSelectedText(selection.toString()),
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
      ),
    };
    renderSelectionAction();
  }

  function addCommentFromSelection() {
    if (!state.selectionSnapshot) {
      return;
    }

    state.commentComposer = {
      id: null,
      sourceHighlightId: null,
      author: state.commentAuthor,
      modifiedAt: new Date().toISOString(),
      page: state.selectionSnapshot.page,
      viewportWidth: state.selectionSnapshot.viewportWidth,
      viewportHeight: state.selectionSnapshot.viewportHeight,
      rects: structuredClone(state.selectionSnapshot.rects),
      color: state.color,
      text: '',
    };
    state.selectionAction = null;
    renderComments();
    renderSelectionAction();
  }

  return {
    findPageEntryFromNode,
    addHighlightFromSelection,
    snapshotSelection,
    addCommentFromSelection,
  };
}
