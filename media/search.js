export function createSearchController({
  state,
  workspaceEl,
  searchPanelEl,
  searchButtonEl,
  searchInputEl,
  searchCountEl,
  searchPrevEl,
  searchNextEl,
  findTextNode,
  getPageScrollTop,
  updateCurrentPageFromScroll,
  updatePageIndicator,
}) {
  function renderSearchHighlights() {
    for (const pageEntry of state.pageEntries) {
      pageEntry.searchLayer.replaceChildren();
    }

    for (let index = 0; index < state.searchMatches.length; index += 1) {
      const match = state.searchMatches[index];
      const pageEntry = state.pageEntries.find(
        (entry) => entry.pageNumber === match.pageNumber
      );
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
    const current =
      total && state.activeSearchMatchIndex >= 0
        ? state.activeSearchMatchIndex + 1
        : 0;
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
          height: rect.height * scaleY,
        }));

      if (rects.length) {
        matches.push({
          pageNumber: pageEntry.pageNumber,
          rects,
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

    const previousMatch = options.preserveActive
      ? state.searchMatches[state.activeSearchMatchIndex]
      : null;
    state.searchMatches = state.pageEntries.flatMap((pageEntry) =>
      computePageSearchMatches(pageEntry, query)
    );

    if (!state.searchMatches.length) {
      state.activeSearchMatchIndex = -1;
    } else if (previousMatch) {
      const restoredIndex = state.searchMatches.findIndex(
        (match) =>
          match.pageNumber === previousMatch.pageNumber &&
          Math.abs(
            (match.rects[0]?.y ?? 0) - (previousMatch.rects[0]?.y ?? 0)
          ) < 1
      );
      state.activeSearchMatchIndex = restoredIndex >= 0 ? restoredIndex : 0;
    } else if (
      state.activeSearchMatchIndex < 0 ||
      state.activeSearchMatchIndex >= state.searchMatches.length
    ) {
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

    const pageEntry = state.pageEntries.find(
      (entry) => entry.pageNumber === match.pageNumber
    );
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
      behavior: 'auto',
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

  return {
    renderSearchHighlights,
    setSearchOpen,
    updateSearchUI,
    updateSearchResults,
    revealSearchMatch,
    moveSearchMatch,
  };
}
