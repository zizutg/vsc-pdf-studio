export function colorPopoverMarkup(moreIcon) {
  return `
    <div class="color-popover" id="color-popover" role="dialog" aria-label="Basic annotation colors" hidden>
      <div class="color-palette" id="color-palette">
        <button type="button" class="color-swatch is-active" data-color="#ef4444" style="--swatch:#ef4444;" aria-label="Red" aria-pressed="true"></button>
        <button type="button" class="color-swatch" data-color="#eab308" style="--swatch:#eab308;" aria-label="Yellow" aria-pressed="false"></button>
        <button type="button" class="color-swatch" data-color="#f97316" style="--swatch:#f97316;" aria-label="Orange" aria-pressed="false"></button>
        <button type="button" class="color-swatch" data-color="#22c55e" style="--swatch:#22c55e;" aria-label="Green" aria-pressed="false"></button>
        <button type="button" class="color-swatch" data-color="#3b82f6" style="--swatch:#3b82f6;" aria-label="Blue" aria-pressed="false"></button>
        <button type="button" id="more-colors-button" aria-label="More colors" title="More colors">${moreIcon}</button>
      </div>
    </div>
  `;
}

export function toolsPanelMarkup(closeIcon) {
  return `
    <aside class="tools-panel" id="tools-panel" aria-label="Annotation tools" hidden>
      <div class="tools-panel-header">
        <button type="button" id="tools-panel-close" aria-label="Close tools panel" title="Close tools panel">${closeIcon}</button>
      </div>
      <section id="tools-color-section" aria-label="Annotation color">
        <label class="tools-field" for="stroke-color">More colors
          <input id="stroke-color" type="color" value="#ef4444" />
        </label>
      </section>
      <section id="tools-width-section" aria-label="Pen size">
        <label class="tools-field" id="pen-width-field" for="stroke-width">Pen size
          <select id="stroke-width">
            <option value="1">1 pt</option>
            <option value="2">2 pt</option>
            <option value="3" selected>3 pt</option>
            <option value="4">4 pt</option>
            <option value="6">6 pt</option>
          </select>
        </label>
        <label class="tools-field" id="highlighter-width-field" for="highlighter-width" hidden>Highlighter size
          <select id="highlighter-width">
            <option value="6">6 pt</option>
            <option value="10">10 pt</option>
            <option value="14" selected>14 pt</option>
            <option value="20">20 pt</option>
            <option value="28">28 pt</option>
          </select>
        </label>
      </section>
      <section id="tools-opacity-section" aria-label="Highlighter opacity" hidden>
        <label class="tools-field" for="highlighter-opacity">Opacity
          <input id="highlighter-opacity" type="range" min="10" max="60" step="5" value="30" />
          <output id="highlighter-opacity-value" for="highlighter-opacity">30%</output>
        </label>
      </section>
    </aside>
  `;
}

export function createToolsPanelController({
  panelEl,
  toggleEl,
  colorButtonEl,
  colorWrapEl,
  colorPopoverEl,
  customColorEl,
  contentShellEl,
  workspaceEl,
  onLayoutChange,
  onColorSelect,
}) {
  const closeEl = panelEl.querySelector('#tools-panel-close');
  const moreColorsEl = colorPopoverEl.querySelector('#more-colors-button');
  const colorSectionEl = panelEl.querySelector('#tools-color-section');
  const highlighterWidthFieldEl = panelEl.querySelector(
    '#highlighter-width-field'
  );
  const opacitySectionEl = panelEl.querySelector('#tools-opacity-section');
  const opacityEl = panelEl.querySelector('#highlighter-opacity');
  const opacityValueEl = panelEl.querySelector('#highlighter-opacity-value');
  let returnFocusEl = toggleEl;

  opacityEl.addEventListener('input', () => {
    opacityValueEl.textContent = `${opacityEl.value}%`;
  });

  function setColorPopoverOpen(
    open,
    { focus = false, restoreFocus = false } = {}
  ) {
    colorPopoverEl.hidden = !open;
    colorButtonEl.classList.toggle('is-active', open);
    colorButtonEl.setAttribute('aria-expanded', String(open));
    if (open && focus) {
      colorPopoverEl.querySelector('.color-swatch')?.focus();
    } else if (
      !open &&
      restoreFocus &&
      colorPopoverEl.contains(colorPopoverEl.ownerDocument.activeElement)
    ) {
      colorButtonEl.focus();
    }
  }

  function setOpen(
    open,
    { focus = false, opener = toggleEl, notifyLayout = true } = {}
  ) {
    const previousWidth = workspaceEl.clientWidth;
    setColorPopoverOpen(false);
    panelEl.hidden = !open;
    contentShellEl.classList.toggle('is-tools-open', open);
    toggleEl.classList.toggle('is-active', open);
    toggleEl.setAttribute('aria-expanded', String(open));
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
    const isFreehandHighlighter = mode === 'freehand-highlight';
    highlighterWidthFieldEl.hidden = !isFreehandHighlighter;
    opacitySectionEl.hidden = !isFreehandHighlighter;
  }

  toggleEl.addEventListener('click', () => {
    setOpen(panelEl.hidden, { focus: true });
  });
  colorButtonEl.addEventListener('click', () => {
    setColorPopoverOpen(colorPopoverEl.hidden, { focus: true });
  });
  for (const swatch of colorPopoverEl.querySelectorAll('.color-swatch')) {
    swatch.addEventListener('click', () => {
      onColorSelect(swatch.dataset.color);
      setColorPopoverOpen(false, { restoreFocus: true });
    });
  }
  moreColorsEl.addEventListener('click', () => {
    setOpen(true, { opener: colorButtonEl });
    (colorSectionEl.hidden ? closeEl : customColorEl).focus();
  });
  colorWrapEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || colorPopoverEl.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setColorPopoverOpen(false, { restoreFocus: true });
  });
  colorWrapEl.addEventListener('focusout', (event) => {
    if (!colorWrapEl.contains(event.relatedTarget)) setColorPopoverOpen(false);
  });
  colorPopoverEl.ownerDocument.addEventListener('pointerdown', (event) => {
    if (!colorWrapEl.contains(event.target)) setColorPopoverOpen(false);
  });
  closeEl.addEventListener('click', () => setOpen(false));
  panelEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  });

  setOpen(false);
  return { setOpen, setColorPopoverOpen, updateMode };
}
