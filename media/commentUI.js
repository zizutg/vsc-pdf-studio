export function renderCommentLayer({
  pageEntry,
  state,
  icons,
  formatCommentDate,
  getCommentOverlayPlacement,
  renderComments,
  applySessionAnnotations,
  updateCommentViewsToggleState,
  submitCommentComposer,
  cancelCommentComposer,
  renderSelectionAction,
}) {
  pageEntry.commentLayer.replaceChildren();

  for (const comment of state.sessionAnnotations.comments) {
    if (comment.page !== pageEntry.pageNumber || !comment.rects.length) {
      continue;
    }

    const firstRect = comment.rects[0];
    const anchor = comment.rects[comment.rects.length - 1];
    const scaleX =
      pageEntry.width / Math.max(comment.viewportWidth || pageEntry.width, 1);
    const scaleY =
      pageEntry.height /
      Math.max(comment.viewportHeight || pageEntry.height, 1);

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
      if (state.showAllComments) {
        return;
      }
      state.openMarkupNoteId = null;
      state.openCommentId =
        state.openCommentId === comment.id ? null : comment.id;
      renderComments();
    });
    pageEntry.commentLayer.append(marker);

    if (state.showAllComments || state.openCommentId === comment.id) {
      const popupWidth = 260;
      const popupHeight = 72;
      const popupGap = 10;
      const placement = getCommentOverlayPlacement({
        pageEntry,
        overlayWidth: popupWidth,
        overlayHeight: popupHeight,
        gap: popupGap,
        anchorRight,
        anchorTop,
        markerAnchorX: markerLeft + markerSize,
      });
      const connector = document.createElement('div');
      connector.className = 'comment-connector';
      connector.style.left = `${placement.connectorLeft}px`;
      connector.style.top = `${markerTop + markerSize / 2}px`;
      connector.style.width = `${placement.connectorWidth}px`;
      connector.style.setProperty('--comment-accent', comment.color);
      pageEntry.commentLayer.append(connector);

      const popup = document.createElement('div');
      popup.className = 'comment-popup';
      popup.style.left = `${placement.left}px`;
      popup.style.top = `${placement.top}px`;
      popup.style.borderColor = comment.color;
      popup.style.setProperty('--comment-accent', comment.color);
      popup.innerHTML = `
        <div class="comment-popup-author"></div>
        <div class="comment-popup-text"></div>
        <div class="comment-popup-actions">
          <button type="button" class="comment-edit" aria-label="Edit comment" title="Edit">${icons.edit}</button>
          <button type="button" class="comment-delete" aria-label="Delete comment" title="Delete">${icons.trash}</button>
        </div>
      `;
      const authorLabel = comment.author || state.commentAuthor;
      const dateLabel = formatCommentDate(comment.modifiedAt);
      popup.querySelector('.comment-popup-author').textContent = dateLabel
        ? `${authorLabel}: ${dateLabel}`
        : authorLabel;
      popup.querySelector('.comment-popup-text').textContent = comment.text;
      popup.querySelector('.comment-edit').addEventListener('click', () => {
        state.openCommentId = null;
        state.openMarkupNoteId = null;
        state.showAllComments = false;
        updateCommentViewsToggleState();
        state.commentComposer = {
          id: comment.id,
          sourceHighlightId: null,
          author: comment.author || state.commentAuthor,
          modifiedAt: comment.modifiedAt,
          page: comment.page,
          viewportWidth: comment.viewportWidth,
          viewportHeight: comment.viewportHeight,
          rects: structuredClone(comment.rects),
          color: comment.color,
          text: comment.text,
        };
        renderComments();
      });
      popup.querySelector('.comment-delete').addEventListener('click', () => {
        state.openCommentId = null;
        state.openMarkupNoteId = null;
        applySessionAnnotations({
          ...state.sessionAnnotations,
          comments: state.sessionAnnotations.comments.filter(
            (candidate) => candidate.id !== comment.id
          ),
        });
      });
      pageEntry.commentLayer.append(popup);
    }
  }

  for (const highlight of state.sessionAnnotations.highlights) {
    if (
      highlight.page !== pageEntry.pageNumber ||
      !highlight.rects.length ||
      !highlight.attachedNote?.text
    ) {
      continue;
    }

    const firstRect = highlight.rects[0];
    const anchor = highlight.rects[highlight.rects.length - 1];
    const scaleX =
      pageEntry.width / Math.max(highlight.viewportWidth || pageEntry.width, 1);
    const scaleY =
      pageEntry.height /
      Math.max(highlight.viewportHeight || pageEntry.height, 1);
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

    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'comment-marker markup-note-marker';
    marker.style.left = `${markerLeft}px`;
    marker.style.top = `${markerTop}px`;
    marker.style.backgroundColor = highlight.color;
    marker.innerHTML = icons.comment;
    marker.title = 'Open attached note';
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.commentComposer) {
        submitCommentComposer();
        if (state.commentComposer) {
          cancelCommentComposer();
        }
      }
      if (state.showAllComments) {
        return;
      }
      state.showAllComments = false;
      state.openCommentId = null;
      state.openMarkupNoteId =
        state.openMarkupNoteId === highlight.id ? null : highlight.id;
      updateCommentViewsToggleState();
      renderComments();
    });
    pageEntry.commentLayer.append(marker);

    if (!state.showAllComments && state.openMarkupNoteId !== highlight.id) {
      continue;
    }

    const popupWidth = 260;
    const popupHeight = 72;
    const popupGap = 10;
    const placement = getCommentOverlayPlacement({
      pageEntry,
      overlayWidth: popupWidth,
      overlayHeight: popupHeight,
      gap: popupGap,
      anchorRight,
      anchorTop,
      markerAnchorX: markerLeft + markerSize,
    });
    const connector = document.createElement('div');
    connector.className = 'comment-connector';
    connector.style.left = `${placement.connectorLeft}px`;
    connector.style.top = `${markerTop + markerSize / 2}px`;
    connector.style.width = `${placement.connectorWidth}px`;
    connector.style.setProperty('--comment-accent', highlight.color);
    pageEntry.commentLayer.append(connector);

    const popup = document.createElement('div');
    popup.className = 'comment-popup';
    popup.style.left = `${placement.left}px`;
    popup.style.top = `${placement.top}px`;
    popup.style.borderColor = highlight.color;
    popup.style.setProperty('--comment-accent', highlight.color);
    popup.innerHTML = `
      <div class="comment-popup-author"></div>
      <div class="comment-popup-text"></div>
      <div class="comment-popup-actions">
        <button type="button" class="comment-edit" aria-label="Edit attached note" title="Edit">${icons.edit}</button>
        <button type="button" class="comment-delete" aria-label="Delete attached note" title="Delete">${icons.trash}</button>
      </div>
    `;
    const authorLabel = highlight.attachedNote.author || state.commentAuthor;
    const dateLabel = formatCommentDate(highlight.attachedNote.modifiedAt);
    popup.querySelector('.comment-popup-author').textContent = dateLabel
      ? `${authorLabel}: ${dateLabel}`
      : authorLabel;
    popup.querySelector('.comment-popup-text').textContent =
      highlight.attachedNote.text;
    popup.querySelector('.comment-edit').addEventListener('click', () => {
      if (state.commentComposer) {
        submitCommentComposer();
        if (state.commentComposer) {
          cancelCommentComposer();
        }
      }
      state.openMarkupNoteId = null;
      state.showAllComments = false;
      updateCommentViewsToggleState();
      state.commentComposer = {
        id: null,
        sourceHighlightId: highlight.id,
        author: highlight.attachedNote.author || state.commentAuthor,
        modifiedAt: highlight.attachedNote.modifiedAt,
        page: highlight.page,
        viewportWidth: highlight.viewportWidth,
        viewportHeight: highlight.viewportHeight,
        rects: structuredClone(highlight.rects),
        color: highlight.color,
        text: highlight.attachedNote.text,
      };
      renderComments();
    });
    popup.querySelector('.comment-delete').addEventListener('click', () => {
      state.openMarkupNoteId = null;
      applySessionAnnotations({
        ...state.sessionAnnotations,
        highlights: state.sessionAnnotations.highlights.filter(
          (candidate) => candidate.id !== highlight.id
        ),
      });
    });
    pageEntry.commentLayer.append(popup);
  }

  if (
    state.commentComposer?.page === pageEntry.pageNumber &&
    state.commentComposer.rects.length
  ) {
    const anchor = state.commentComposer.rects[0];
    const scaleX =
      pageEntry.width /
      Math.max(state.commentComposer.viewportWidth || pageEntry.width, 1);
    const scaleY =
      pageEntry.height /
      Math.max(state.commentComposer.viewportHeight || pageEntry.height, 1);
    const composerWidth = 210;
    const composerHeight = 110;
    const composerGap = 10;
    const anchorTop = anchor.y * scaleY;
    const markerAnchorLeft = Math.max(
      2,
      (anchor.x + anchor.width) * scaleX + 1
    );
    const markerAnchorTop = Math.max(
      2,
      anchor.y * scaleY + Math.max(anchor.height * scaleY * 0.5, 4)
    );
    const placement = getCommentOverlayPlacement({
      pageEntry,
      overlayWidth: composerWidth,
      overlayHeight: composerHeight,
      gap: composerGap,
      anchorRight: (anchor.x + anchor.width) * scaleX,
      anchorTop,
      markerAnchorX: markerAnchorLeft,
    });
    const composer = document.createElement('div');
    composer.className = 'comment-composer';
    const connector = document.createElement('div');
    connector.className = 'comment-connector';
    connector.style.left = `${placement.connectorLeft}px`;
    connector.style.top = `${markerAnchorTop}px`;
    connector.style.width = `${placement.connectorWidth}px`;
    connector.style.setProperty(
      '--comment-accent',
      state.commentComposer.color
    );
    pageEntry.commentLayer.append(connector);

    composer.style.left = `${placement.left}px`;
    composer.style.top = `${placement.top}px`;
    composer.style.borderColor = state.commentComposer.color;
    composer.style.setProperty('--comment-accent', state.commentComposer.color);
    composer.innerHTML = `
      <div class="comment-editor-wrap">
        <div class="comment-author-line"></div>
        <textarea class="comment-input" placeholder="Add a comment..."></textarea>
        <div class="comment-actions">
          <button type="button" class="comment-save" aria-label="Save comment" title="Save">${icons.floppy}</button>
          <button type="button" class="comment-cancel" aria-label="Close" title="Close">${icons.close}</button>
          ${state.commentComposer.id || state.commentComposer.sourceHighlightId ? `<button type="button" class="comment-delete" aria-label="Delete comment" title="Delete">${icons.trash}</button>` : ''}
        </div>
      </div>
    `;

    const input = composer.querySelector('.comment-input');
    const authorLine = composer.querySelector('.comment-author-line');
    const saveButton = composer.querySelector('.comment-save');
    const cancelButton = composer.querySelector('.comment-cancel');
    const deleteButton = composer.querySelector('.comment-delete');
    const composerAuthorLabel =
      state.commentComposer.author || state.commentAuthor;
    const composerDateLabel = formatCommentDate(
      state.commentComposer.modifiedAt
    );
    authorLine.textContent = composerDateLabel
      ? `${composerAuthorLabel}: ${composerDateLabel}`
      : composerAuthorLabel;
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
      if (state.commentComposer?.sourceHighlightId) {
        const sourceHighlightId = state.commentComposer.sourceHighlightId;
        state.commentComposer = null;
        state.openMarkupNoteId = null;
        applySessionAnnotations({
          ...state.sessionAnnotations,
          highlights: state.sessionAnnotations.highlights.filter(
            (highlight) => highlight.id !== sourceHighlightId
          ),
        });
        return;
      }

      if (!state.commentComposer?.id) {
        cancelCommentComposer();
        return;
      }

      const commentId = state.commentComposer.id;
      state.commentComposer = null;
      state.openCommentId = null;
      applySessionAnnotations({
        ...state.sessionAnnotations,
        comments: state.sessionAnnotations.comments.filter(
          (comment) => comment.id !== commentId
        ),
      });
    });
    pageEntry.commentLayer.append(composer);
    window.setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }
}

export function renderSelectionActionOverlay({
  state,
  workspaceEl,
  icons,
  addHighlightFromSelection,
  addCommentFromSelection,
  addBookmarkFromSelection,
}) {
  document
    .querySelectorAll('.selection-action')
    .forEach((node) => node.remove());

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
    <button type="button" class="selection-action-button selection-action-underline" aria-label="Underline selection" title="Underline">${icons.underline}</button>
    <button type="button" class="selection-action-button selection-action-strikeout" aria-label="Strike out selection" title="Strike Out">${icons.strikeout}</button>
    <button type="button" class="selection-action-button selection-action-bookmark" aria-label="Bookmark selection" title="Bookmark">${icons.bookmark}</button>
  `;
  actions.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  const [
    copyButton,
    highlightButton,
    commentButton,
    underlineButton,
    strikeoutButton,
    bookmarkButton,
  ] = actions.querySelectorAll('.selection-action-button');

  copyButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const text = state.selectionSnapshot?.text?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
    renderSelectionActionOverlay({
      state,
      workspaceEl,
      icons,
      addHighlightFromSelection,
      addCommentFromSelection,
      addBookmarkFromSelection,
    });
  });
  highlightButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addHighlightFromSelection(true, 'highlight');
  });
  commentButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addCommentFromSelection();
  });
  underlineButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addHighlightFromSelection(true, 'underline');
  });
  strikeoutButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addHighlightFromSelection(true, 'strikeout');
  });
  bookmarkButton.addEventListener('click', (event) => {
    event.stopPropagation();
    addBookmarkFromSelection();
  });
  workspaceEl.append(actions);
}
