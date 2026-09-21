export function createPdfLinkReader(pdf) {
  const destinations = new Map();
  const pageNumbers = new Map();

  async function resolveDestination(destination) {
    const explicit =
      typeof destination === 'string'
        ? await pdf.getDestination(destination)
        : destination;
    if (!Array.isArray(explicit) || explicit.length < 2) {
      return null;
    }

    const [ref, type, ...args] = explicit;
    let pageNumber;
    if (Number.isInteger(ref)) {
      pageNumber = ref + 1;
    } else if (ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen)) {
      const key = `${ref.num}:${ref.gen}`;
      if (!pageNumbers.has(key)) {
        pageNumbers.set(
          key,
          pdf.getPageIndex(ref).then((index) => index + 1)
        );
      }
      pageNumber = await pageNumbers.get(key);
    }
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    ) {
      return null;
    }

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const [xMin, , , yMax] = page.view;
    let x = xMin;
    let y = yMax;
    switch (type?.name) {
      case 'XYZ':
        x = Number.isFinite(args[0]) ? args[0] : xMin;
        y = Number.isFinite(args[1]) ? args[1] : yMax;
        break;
      case 'FitH':
      case 'FitBH':
        y = Number.isFinite(args[0]) ? args[0] : yMax;
        break;
      case 'FitV':
      case 'FitBV':
        x = Number.isFinite(args[0]) ? args[0] : xMin;
        break;
      case 'FitR':
        x = Number.isFinite(args[0]) ? args[0] : xMin;
        y = Number.isFinite(args[3]) ? args[3] : yMax;
        break;
      case 'Fit':
      case 'FitB':
        return { pageNumber, leftRatio: 0, topRatio: 0 };
      default:
        return null;
    }

    const [left, top] = viewport.convertToViewportPoint(x, y);
    return {
      pageNumber,
      leftRatio: Math.max(0, Math.min(1, left / viewport.width)),
      topRatio: Math.max(0, Math.min(1, top / viewport.height)),
    };
  }

  return async function readPageLinks(pageNumber, viewport) {
    const links = [];
    try {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const annotation of annotations) {
        // Ignore comments, widgets, and invisible/hidden/no-view annotations.
        if (annotation.subtype !== 'Link' || annotation.annotationFlags & 35) {
          continue;
        }

        const rects = getLinkRects(annotation, viewport);
        if (!rects.length) {
          continue;
        }
        if (annotation.url) {
          try {
            const url = new URL(annotation.url);
            if (
              annotation.url.length <= 8_192 &&
              ['https:', 'http:', 'mailto:'].includes(url.protocol)
            ) {
              links.push({ rects, url: url.href });
            }
          } catch {
            // A malformed link must not prevent the page from rendering.
          }
        } else if (annotation.dest) {
          const key = JSON.stringify(annotation.dest);
          if (!destinations.has(key)) {
            destinations.set(
              key,
              resolveDestination(annotation.dest).catch(() => null)
            );
          }
          const destination = await destinations.get(key);
          if (destination) {
            links.push({ rects, destination });
          }
        }
      }
    } catch (error) {
      console.warn(
        'PDF Studio could not read links on page',
        pageNumber,
        error
      );
    }
    return links;
  };
}

function getLinkRects(annotation, viewport) {
  const areas = annotation.quadPoints?.length
    ? annotation.quadPoints.map((quad) => quad.flatMap(({ x, y }) => [x, y]))
    : [annotation.rect];
  const rects = [];
  for (const area of areas) {
    if (
      !Array.isArray(area) ||
      area.length < 4 ||
      !area.every(Number.isFinite)
    ) {
      continue;
    }
    const points = [];
    for (let index = 0; index < area.length; index += 2) {
      points.push(
        viewport.convertToViewportPoint(area[index], area[index + 1])
      );
    }
    const left = Math.max(0, Math.min(...points.map(([x]) => x)));
    const top = Math.max(0, Math.min(...points.map(([, y]) => y)));
    const right = Math.min(viewport.width, Math.max(...points.map(([x]) => x)));
    const bottom = Math.min(
      viewport.height,
      Math.max(...points.map(([, y]) => y))
    );
    if (right > left && bottom > top) {
      rects.push({ left, top, width: right - left, height: bottom - top });
    }
  }
  return rects;
}

export function attachPdfLinks(pageEntry, { openExternal, navigate }) {
  const { pageShell, textLayer, pdfCanvas, links } = pageEntry;
  const document = pageShell.ownerDocument;
  const layer = document.createElement('div');
  layer.className = 'pdf-link-layer';
  layer.hidden = true;
  pageShell.append(layer);
  let enabled = false;
  let press = null;

  function activate(link) {
    if (link.url) {
      openExternal(link.url);
    } else {
      navigate(link.destination);
    }
  }

  for (const link of links) {
    const label = link.url || `Go to page ${link.destination.pageNumber}`;
    for (const [index, rect] of link.rects.entries()) {
      const anchor = document.createElement('a');
      anchor.className = 'pdf-link';
      anchor.href = link.url || `#page=${link.destination.pageNumber}`;
      anchor.setAttribute('aria-label', label);
      anchor.title = label;
      anchor.tabIndex = index === 0 ? 0 : -1;
      anchor.draggable = false;
      Object.assign(anchor.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (enabled) {
          activate(link);
        }
      });
      layer.append(anchor);
    }
  }

  function linkAt(event) {
    if (
      !enabled ||
      !(
        event.target === pageShell ||
        event.target === pdfCanvas ||
        textLayer.contains(event.target)
      )
    ) {
      return null;
    }
    const bounds = pageShell.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) * pageEntry.width) / bounds.width;
    const y = ((event.clientY - bounds.top) * pageEntry.height) / bounds.height;
    return (
      links.find((link) =>
        link.rects.some(
          (rect) =>
            x >= rect.left &&
            x <= rect.left + rect.width &&
            y >= rect.top &&
            y <= rect.top + rect.height
        )
      ) ?? null
    );
  }

  function clearHover() {
    pageShell.classList.remove('has-pdf-link-hover');
    pageShell.removeAttribute('title');
  }

  // Leave pointer events on the original text layer so dragging still selects text.
  pageShell.addEventListener('pointerdown', (event) => {
    const link =
      event.button === 0 && event.isPrimary !== false ? linkAt(event) : null;
    press = link
      ? {
          link,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dragged: false,
        }
      : null;
  });
  pageShell.addEventListener('pointermove', (event) => {
    if (
      press?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5
    ) {
      press.dragged = true;
    }
    const link = linkAt(event);
    if (link && !event.buttons) {
      pageShell.classList.add('has-pdf-link-hover');
      pageShell.title = link.url || `Go to page ${link.destination.pageNumber}`;
    } else {
      clearHover();
    }
  });
  pageShell.addEventListener('click', (event) => {
    const previousPress = press;
    press = null;
    const link = linkAt(event);
    if (
      event.button !== 0 ||
      !link ||
      previousPress?.link !== link ||
      previousPress.dragged
    ) {
      return;
    }
    if (document.defaultView.getSelection()?.isCollapsed === false) {
      return;
    }
    event.preventDefault();
    activate(link);
  });
  for (const eventName of ['pointerleave', 'pointercancel']) {
    pageShell.addEventListener(eventName, () => {
      press = null;
      clearHover();
    });
  }

  return {
    setEnabled(value) {
      enabled = value;
      layer.hidden = !enabled;
      press = null;
      clearHover();
    },
  };
}
