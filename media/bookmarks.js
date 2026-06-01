export function createBookmarkController({
  state,
  cloneBookmarks,
  compareBookmarks,
  createHistoryEntry,
  pushHistoryEntry,
  syncOutlineState,
  renderSidebar,
  updateHistoryState,
  setSidebarTab,
  setSidebarOpen,
  renderSelectionAction,
}) {
  function applyBookmarks(bookmarks, options = {}) {
    state.bookmarks = cloneBookmarks(bookmarks);
    syncOutlineState(state);
    renderSidebar(options.reveal ? { reveal: true } : {});

    if (!options.skipHistory) {
      pushHistoryEntry(
        createHistoryEntry(state.sessionAnnotations, state.bookmarks)
      );
    }

    updateHistoryState();
  }

  function addBookmarkFromSelection() {
    if (!state.selectionSnapshot) {
      return;
    }

    const snapshot = state.selectionSnapshot;
    const firstRect = snapshot.rects[0];
    const rawTitle = (snapshot.text || '').trim().replace(/\s+/g, ' ');
    const title = rawTitle
      ? rawTitle.length > 64
        ? `${rawTitle.slice(0, 61)}...`
        : rawTitle
      : `Bookmark p. ${snapshot.page}`;

    const bookmark = {
      id: `studio-bookmark-${crypto.randomUUID()}`,
      title,
      pageNumber: snapshot.page,
      topRatio: Math.max(
        0,
        Math.min(1, (firstRect?.y ?? 0) / Math.max(snapshot.viewportHeight, 1))
      ),
      depth: 0,
      actionable: true,
      isExternal: false,
      items: [],
    };

    const nextBookmarks = cloneBookmarks(state.bookmarks);
    const insertAt = nextBookmarks.findIndex(
      (candidate) => compareBookmarks(bookmark, candidate) < 0
    );
    if (insertAt === -1) {
      nextBookmarks.push(bookmark);
    } else {
      nextBookmarks.splice(insertAt, 0, bookmark);
    }

    applyBookmarks(nextBookmarks, { reveal: true });
    setSidebarTab('outline');
    setSidebarOpen(true);
    window.getSelection()?.removeAllRanges();
    state.selectionSnapshot = null;
    state.selectionAction = null;
    renderSelectionAction();
  }

  return {
    applyBookmarks,
    addBookmarkFromSelection,
  };
}
