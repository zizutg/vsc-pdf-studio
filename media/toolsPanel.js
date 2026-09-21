export function toolsPanelMarkup(closeIcon) {
  return `
    <aside class="tools-panel" id="tools-panel" aria-label="Annotation tools" hidden>
      <div class="tools-panel-header">
        <button type="button" id="tools-panel-close" aria-label="Close tools panel" title="Close tools panel">${closeIcon}</button>
      </div>
      <section id="tools-color-section" aria-label="Annotation color">
        <div class="color-palette" id="color-palette">
          <button type="button" class="color-swatch is-active" data-color="#ef4444" style="--swatch:#ef4444;" aria-label="Red" aria-pressed="true"></button>
          <button type="button" class="color-swatch" data-color="#eab308" style="--swatch:#eab308;" aria-label="Yellow" aria-pressed="false"></button>
          <button type="button" class="color-swatch" data-color="#f97316" style="--swatch:#f97316;" aria-label="Orange" aria-pressed="false"></button>
          <button type="button" class="color-swatch" data-color="#22c55e" style="--swatch:#22c55e;" aria-label="Green" aria-pressed="false"></button>
          <button type="button" class="color-swatch" data-color="#3b82f6" style="--swatch:#3b82f6;" aria-label="Blue" aria-pressed="false"></button>
        </div>
        <label class="tools-field" for="stroke-color">More colors
          <input id="stroke-color" type="color" value="#ef4444" />
        </label>
      </section>
      <section id="tools-width-section" aria-label="Pen size">
        <label class="tools-field" for="stroke-width">Pen size
          <select id="stroke-width">
            <option value="1">1 pt</option>
            <option value="2">2 pt</option>
            <option value="3" selected>3 pt</option>
            <option value="4">4 pt</option>
            <option value="6">6 pt</option>
          </select>
        </label>
      </section>
    </aside>
  `;
}

export function createToolsPanelController({
  panelEl,
  toggleEl,
  colorButtonEl,
  contentShellEl,
  workspaceEl,
  onLayoutChange,
}) {
  const closeEl = panelEl.querySelector('#tools-panel-close');
  const colorSectionEl = panelEl.querySelector('#tools-color-section');
  let returnFocusEl = toggleEl;

  function setOpen(
    open,
    { focus = false, opener = toggleEl, notifyLayout = true } = {}
  ) {
    const previousWidth = workspaceEl.clientWidth;
    panelEl.hidden = !open;
    contentShellEl.classList.toggle('is-tools-open', open);
    for (const button of [toggleEl, colorButtonEl]) {
      button.classList.toggle('is-active', open);
      button.setAttribute('aria-expanded', String(open));
    }
    if (open) {
      returnFocusEl = opener;
      if (focus) closeEl.focus();
    } else if (panelEl.contains(panelEl.ownerDocument.activeElement)) {
      returnFocusEl.focus();
    }
    if (notifyLayout && workspaceEl.clientWidth !== previousWidth)
      onLayoutChange();
  }

  function updateMode(mode) {
    colorSectionEl.hidden = mode === 'erase';
  }

  toggleEl.addEventListener('click', () => {
    setOpen(panelEl.hidden, { focus: true });
  });
  colorButtonEl.addEventListener('click', () => {
    setOpen(true, { opener: colorButtonEl });
    if (!colorSectionEl.hidden) {
      colorSectionEl.querySelector('.color-swatch').focus();
    } else {
      closeEl.focus();
    }
  });
  closeEl.addEventListener('click', () => setOpen(false));
  panelEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  });

  setOpen(false);
  return { setOpen, updateMode };
}
