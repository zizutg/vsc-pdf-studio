const HIDE_DELAY_MS = 1200;

export function createToolbarVisibilityController({
  appEl,
  toolbarEl,
  revealEl,
  pinButtonEl,
  icons,
  isPopupOpen,
  onLayoutChange,
  documentEl = document,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let pinned = true;
  let visible = true;
  let hideTimer = null;

  function clearHideTimer() {
    if (hideTimer !== null) {
      clearTimer(hideTimer);
      hideTimer = null;
    }
  }

  function setVisible(nextVisible) {
    visible = nextVisible;
    toolbarEl.classList.toggle('is-revealed', visible);
    toolbarEl.inert = !visible;
    toolbarEl.setAttribute('aria-hidden', String(!visible));
    revealEl.hidden = pinned || visible;
  }

  function shouldStayVisible() {
    const activeElement = documentEl.activeElement;
    return (
      toolbarEl.matches(':hover') ||
      isPopupOpen() ||
      (toolbarEl.contains(activeElement) &&
        activeElement?.matches(':focus-visible'))
    );
  }

  function scheduleHide() {
    clearHideTimer();
    if (pinned) return;
    hideTimer = setTimer(() => {
      hideTimer = null;
      if (shouldStayVisible()) {
        scheduleHide();
      } else {
        setVisible(false);
      }
    }, HIDE_DELAY_MS);
  }

  function show() {
    if (pinned) return;
    clearHideTimer();
    setVisible(true);
    scheduleHide();
  }

  function setPinned(nextPinned) {
    if (pinned === nextPinned) return;
    pinned = nextPinned;
    clearHideTimer();
    appEl.classList.toggle('is-toolbar-unpinned', !pinned);
    pinButtonEl.setAttribute('aria-pressed', String(pinned));
    pinButtonEl.setAttribute(
      'aria-label',
      pinned ? 'Unpin toolbar' : 'Pin toolbar'
    );
    pinButtonEl.title = pinned ? 'Unpin toolbar' : 'Pin toolbar';
    pinButtonEl.innerHTML = pinned ? icons.pin : icons.pinOff;
    setVisible(true);
    onLayoutChange();
    if (!pinned) scheduleHide();
  }

  pinButtonEl.addEventListener('click', (event) => {
    setPinned(!pinned);
    if (event.detail > 0) pinButtonEl.blur();
  });
  revealEl.addEventListener('pointerenter', show);
  revealEl.addEventListener('click', show);
  revealEl.addEventListener('focus', () => {
    show();
    pinButtonEl.focus();
  });
  toolbarEl.addEventListener('pointerenter', show);
  toolbarEl.addEventListener('pointerleave', scheduleHide);
  toolbarEl.addEventListener('focusin', show);
  toolbarEl.addEventListener('focusout', scheduleHide);

  return { setPinned, show };
}
