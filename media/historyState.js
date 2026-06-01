export function cloneAnnotations(annotations) {
  return structuredClone(annotations);
}

export function cloneBookmarks(bookmarks) {
  return structuredClone(bookmarks);
}

export function createHistoryEntry(annotations, bookmarks) {
  return {
    annotations: cloneAnnotations(annotations),
    bookmarks: cloneBookmarks(bookmarks),
  };
}

export function pushHistoryEntry(state, entry, maxEntries) {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(entry);
  if (state.history.length > maxEntries) {
    const overflow = state.history.length - maxEntries;
    state.history.splice(0, overflow);
  }
  state.historyIndex = state.history.length - 1;
}

export function compareBookmarks(left, right) {
  if ((left.pageNumber ?? 0) !== (right.pageNumber ?? 0)) {
    return (left.pageNumber ?? 0) - (right.pageNumber ?? 0);
  }
  if ((left.topRatio ?? 0) !== (right.topRatio ?? 0)) {
    return (left.topRatio ?? 0) - (right.topRatio ?? 0);
  }
  return String(left.title || '').localeCompare(String(right.title || ''));
}

export function mergeOutlineItems(bookmarks, outlineItems) {
  const merged = [];
  let bookmarkIndex = 0;
  let outlineIndex = 0;

  while (
    bookmarkIndex < bookmarks.length &&
    outlineIndex < outlineItems.length
  ) {
    if (
      compareBookmarks(bookmarks[bookmarkIndex], outlineItems[outlineIndex]) <=
      0
    ) {
      merged.push(bookmarks[bookmarkIndex]);
      bookmarkIndex += 1;
    } else {
      merged.push(outlineItems[outlineIndex]);
      outlineIndex += 1;
    }
  }

  while (bookmarkIndex < bookmarks.length) {
    merged.push(bookmarks[bookmarkIndex]);
    bookmarkIndex += 1;
  }

  while (outlineIndex < outlineItems.length) {
    merged.push(outlineItems[outlineIndex]);
    outlineIndex += 1;
  }

  return merged;
}

export function syncOutlineState(state) {
  state.outline = mergeOutlineItems(state.bookmarks, state.externalOutline);
}
