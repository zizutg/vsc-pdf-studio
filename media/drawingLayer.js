function pointInsideRect(point, rect, scaleX, scaleY) {
  const left = rect.x * scaleX;
  const top = rect.y * scaleY;
  const right = left + rect.width * scaleX;
  const bottom = top + rect.height * scaleY;
  return (
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
  );
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy)
    )
  );
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

export function simplifyStrokePoints(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) return points;

  const keep = new Uint8Array(points.length);
  // Bounded chunks prevent a pathological long stroke from making RDP quadratic.
  for (let start = 0; start < points.length - 1; start += 512) {
    const end = Math.min(start + 512, points.length - 1);
    keep[start] = 1;
    keep[end] = 1;
    const ranges = [[start, end]];
    while (ranges.length) {
      const [first, last] = ranges.pop();
      let farthest = -1;
      let maxDistance = tolerance;
      for (let index = first + 1; index < last; index++) {
        const distance = distanceToSegment(
          points[index],
          points[first],
          points[last]
        );
        if (distance > maxDistance) {
          maxDistance = distance;
          farthest = index;
        }
      }
      if (farthest !== -1) {
        keep[farthest] = 1;
        ranges.push([first, farthest], [farthest, last]);
      }
    }
  }
  return points.filter((_, index) => keep[index]);
}

function drawStroke(context, canvas, stroke, startIndex = 0) {
  if (startIndex >= stroke.points.length) {
    return;
  }

  const previousAlpha = context.globalAlpha ?? 1;
  context.globalAlpha =
    stroke.kind === 'highlighter' ? (stroke.opacity ?? 0.3) : 1;
  context.strokeStyle = stroke.color;
  const scaleX =
    canvas.width / Math.max(stroke.viewportWidth || canvas.width, 1);
  const scaleY =
    canvas.height / Math.max(stroke.viewportHeight || canvas.height, 1);
  context.lineWidth = stroke.width * ((scaleX + scaleY) / 2);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(
    stroke.points[startIndex].x * scaleX,
    stroke.points[startIndex].y * scaleY
  );

  for (let index = startIndex + 1; index < stroke.points.length; index++) {
    const point = stroke.points[index];
    context.lineTo(point.x * scaleX, point.y * scaleY);
  }

  context.stroke();
  context.globalAlpha = previousAlpha;
}

function isStylusEraseEvent(event) {
  if (event.pointerType !== 'pen') {
    return false;
  }

  return (
    event.button === 5 ||
    (event.buttons & 32) === 32 ||
    event.button === 2 ||
    (event.buttons & 2) === 2
  );
}

function isTouchInputAllowed(event, options) {
  return (
    event.pointerType !== 'touch' || options.getAllowFingerDrawing?.() === true
  );
}

function groupStrokesByPage(strokes) {
  const pages = new Map();
  for (const stroke of strokes) {
    if (!pages.has(stroke.page)) pages.set(stroke.page, []);
    pages.get(stroke.page).push(stroke);
  }
  return pages;
}

function sameRenderedStrokes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      (a.kind ?? 'pen') !== (b.kind ?? 'pen') ||
      (a.opacity ?? 1) !== (b.opacity ?? 1) ||
      a.color !== b.color ||
      a.width !== b.width ||
      a.viewportWidth !== b.viewportWidth ||
      a.viewportHeight !== b.viewportHeight ||
      a.points.length !== b.points.length
    )
      return false;
    for (let point = 0; point < a.points.length; point++) {
      if (
        a.points[point].x !== b.points[point].x ||
        a.points[point].y !== b.points[point].y
      )
        return false;
    }
  }
  return true;
}

function changedStrokePages(previous, next) {
  const oldPages = groupStrokesByPage(previous);
  const newPages = groupStrokesByPage(next);
  const changed = new Set();
  for (const page of new Set([...oldPages.keys(), ...newPages.keys()])) {
    if (
      !sameRenderedStrokes(oldPages.get(page) ?? [], newPages.get(page) ?? [])
    )
      changed.add(page);
  }
  return changed;
}

export function createDrawingLayer(pageEntries, options) {
  const entriesByPage = new Map(
    pageEntries.map((entry) => [entry.pageNumber, entry])
  );
  const listeners = new AbortController();
  const pendingPages = new Set();
  let frameId = null;
  let loadEpoch = 0;
  let highlighterPreviewCanvas = null;
  const state = {
    strokes: [],
    currentStroke: null,
    activePointerId: null,
    touchPan: null,
    previewPointCount: 0,
    previewPageNumber: null,
  };

  function paintHighlighterPreview(pageEntry) {
    const stroke = state.currentStroke;
    const active =
      stroke?.kind === 'highlighter' && stroke.page === pageEntry.pageNumber;
    if (!active && state.previewPageNumber !== pageEntry.pageNumber) return;
    if (active && !highlighterPreviewCanvas) {
      highlighterPreviewCanvas =
        pageEntry.highlighterPreviewCanvas ??
        pageEntry.pageShell.ownerDocument.createElement('canvas');
      highlighterPreviewCanvas.className = 'highlighter-preview-canvas';
    }
    const canvas = highlighterPreviewCanvas;
    if (!canvas) return;
    if (active) {
      const source = pageEntry.drawingCanvas;
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
      }
      canvas.style.width = source.style.width;
      canvas.style.height = source.style.height;
      if (canvas.parentNode !== pageEntry.pageShell) {
        pageEntry.pageShell.append?.(canvas);
      }
    }
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (active) {
      // One complete path per frame avoids dark seams between preview batches.
      drawStroke(context, canvas, stroke);
      state.previewPointCount = stroke.points.length;
      state.previewPageNumber = pageEntry.pageNumber;
    } else {
      state.previewPageNumber = null;
      canvas.remove?.();
    }
  }

  function redrawPage(pageEntry) {
    const context = pageEntry.drawingCanvas.getContext('2d');
    context.clearRect(
      0,
      0,
      pageEntry.drawingCanvas.width,
      pageEntry.drawingCanvas.height
    );

    for (const stroke of state.strokes) {
      if (stroke.page === pageEntry.pageNumber) {
        drawStroke(context, pageEntry.drawingCanvas, stroke);
      }
    }

    if (
      state.currentStroke?.page === pageEntry.pageNumber &&
      state.currentStroke.kind !== 'highlighter'
    ) {
      drawStroke(context, pageEntry.drawingCanvas, state.currentStroke);
      state.previewPointCount = state.currentStroke.points.length;
    }
    paintHighlighterPreview(pageEntry);
  }

  function redrawPages(pageNumbers) {
    cancelPreview();
    for (const pageNumber of pageNumbers) {
      const pageEntry = entriesByPage.get(pageNumber);
      if (pageEntry) redrawPage(pageEntry);
    }
  }

  function cancelPreview() {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    pendingPages.clear();
  }

  function schedulePreview(pageEntry) {
    pendingPages.add(pageEntry);
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      for (const page of pendingPages) appendPreview(page);
      pendingPages.clear();
    });
  }

  function appendPreview(pageEntry) {
    const stroke = state.currentStroke;
    if (
      !stroke ||
      stroke.page !== pageEntry.pageNumber ||
      stroke.points.length < 2 ||
      state.previewPointCount >= stroke.points.length
    )
      return;

    if (stroke.kind === 'highlighter') {
      paintHighlighterPreview(pageEntry);
      return;
    }

    // Opaque pen previews only: one preceding segment preserves the round join
    // at the batch boundary. Finalization uses the canonical full-stroke path.
    drawStroke(
      pageEntry.drawingCanvas.getContext('2d'),
      pageEntry.drawingCanvas,
      stroke,
      Math.max(0, state.previewPointCount - 2)
    );
    state.previewPointCount = stroke.points.length;
  }

  function toPoint(canvas, event, rect = canvas.getBoundingClientRect()) {
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function finalizeStroke(event) {
    if (
      event &&
      state.activePointerId !== null &&
      event.pointerId !== state.activePointerId
    ) {
      return;
    }

    if (!state.currentStroke) {
      state.activePointerId = null;
      return;
    }

    const page = state.currentStroke.page;
    const epoch = loadEpoch;
    const isHighlighter = state.currentStroke.kind === 'highlighter';
    const committed = state.currentStroke.points.length > 1;
    if (committed) {
      const canvas = entriesByPage.get(page)?.drawingCanvas;
      const rect = canvas?.getBoundingClientRect();
      const pixelsPerCssPixel =
        canvas && rect?.width > 0 && rect?.height > 0
          ? Math.min(canvas.width / rect.width, canvas.height / rect.height)
          : 1;
      state.currentStroke.points = simplifyStrokePoints(
        state.currentStroke.points,
        0.25 * pixelsPerCssPixel
      );
      state.strokes.push(state.currentStroke);
      options.onChange(
        structuredClone(state.strokes),
        structuredClone(state.currentStroke)
      );
    }

    state.currentStroke = null;
    state.activePointerId = null;
    state.previewPointCount = 0;
    if (loadEpoch === epoch) {
      if (committed) redrawPages([page]);
      else cancelPreview();
      if (isHighlighter) paintHighlighterPreview(entriesByPage.get(page));
    }
  }

  function eraseAtPoint(pageEntry, point) {
    const targetStroke = findStrokeNearPoint(pageEntry.pageNumber, point);
    if (targetStroke) {
      const remainingStrokes = state.strokes.filter(
        (stroke) => stroke.id !== targetStroke.id
      );
      const epoch = loadEpoch;
      options.onErase?.(
        structuredClone(targetStroke),
        structuredClone(remainingStrokes)
      );
      if (loadEpoch === epoch) {
        state.strokes = remainingStrokes;
        redrawPages([pageEntry.pageNumber]);
      }
      return true;
    }

    const targetHighlight = findHighlightAtPoint(pageEntry.pageNumber, point);
    if (targetHighlight) {
      const remainingHighlights = (options.getHighlights?.() ?? []).filter(
        (highlight) => highlight.id !== targetHighlight.id
      );
      options.onEraseHighlight?.(
        structuredClone(targetHighlight),
        structuredClone(remainingHighlights)
      );
      return true;
    }

    return false;
  }

  function findStrokeNearPoint(pageNumber, point) {
    let bestStroke = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const stroke of state.strokes) {
      if (stroke.page !== pageNumber) {
        continue;
      }

      const scaleX =
        point.viewportWidth /
        Math.max(stroke.viewportWidth || point.viewportWidth, 1);
      const scaleY =
        point.viewportHeight /
        Math.max(stroke.viewportHeight || point.viewportHeight, 1);
      const threshold = Math.max(
        stroke.width * ((scaleX + scaleY) / 2) * 1.5,
        14
      );

      for (let index = 0; index < stroke.points.length; index += 1) {
        const candidate = stroke.points[index];
        const currentPoint = {
          x: candidate.x * scaleX,
          y: candidate.y * scaleY,
        };
        const previous = stroke.points[index - 1];
        const distance = previous
          ? distanceToSegment(
              point,
              {
                x: previous.x * scaleX,
                y: previous.y * scaleY,
              },
              currentPoint
            )
          : Math.hypot(currentPoint.x - point.x, currentPoint.y - point.y);

        if (distance <= threshold && distance < bestDistance) {
          bestStroke = stroke;
          bestDistance = distance;
        }
      }
    }

    return bestStroke;
  }

  function findHighlightAtPoint(pageNumber, point) {
    for (const highlight of options.getHighlights?.() ?? []) {
      if (highlight.page !== pageNumber) {
        continue;
      }

      const scaleX =
        point.viewportWidth /
        Math.max(highlight.viewportWidth || point.viewportWidth, 1);
      const scaleY =
        point.viewportHeight /
        Math.max(highlight.viewportHeight || point.viewportHeight, 1);

      for (const rect of highlight.rects) {
        if (pointInsideRect(point, rect, scaleX, scaleY)) {
          return highlight;
        }
      }
    }

    return null;
  }

  for (const pageEntry of pageEntries) {
    const canvas = pageEntry.drawingCanvas;

    pageEntry.pageShell.addEventListener(
      'pointerdown',
      (event) => {
        if (!isStylusEraseEvent(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const point = {
          ...toPoint(canvas, event),
          viewportWidth: canvas.width,
          viewportHeight: canvas.height,
        };
        eraseAtPoint(pageEntry, point);
      },
      { capture: true, signal: listeners.signal }
    );

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (state.activePointerId !== null) return;
        const mode = isStylusEraseEvent(event) ? 'erase' : options.getMode();
        if (mode === 'select') {
          return;
        }

        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        if (!isTouchInputAllowed(event, options)) {
          state.touchPan = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
          };
          return;
        }

        if (mode === 'erase') {
          const point = {
            ...toPoint(canvas, event),
            viewportWidth: canvas.width,
            viewportHeight: canvas.height,
          };
          eraseAtPoint(pageEntry, point);
          return;
        }

        state.currentStroke = {
          id: crypto.randomUUID(),
          kind: mode === 'freehand-highlight' ? 'highlighter' : 'pen',
          opacity:
            mode === 'freehand-highlight' ? options.getHighlighterOpacity() : 1,
          page: pageEntry.pageNumber,
          color: options.getColor(),
          width:
            mode === 'freehand-highlight'
              ? options.getHighlighterWidth()
              : options.getWidth(),
          viewportWidth: canvas.width,
          viewportHeight: canvas.height,
          points: [toPoint(canvas, event)],
        };
        state.activePointerId = event.pointerId;
        state.previewPointCount = 0;
        schedulePreview(pageEntry);
      },
      { signal: listeners.signal }
    );

    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (state.touchPan?.pointerId === event.pointerId) {
          event.preventDefault();
          const scrollContainer = options.getScrollContainer?.();
          if (scrollContainer) {
            scrollContainer.scrollLeft -=
              event.clientX - state.touchPan.clientX;
            scrollContainer.scrollTop -= event.clientY - state.touchPan.clientY;
          }
          state.touchPan.clientX = event.clientX;
          state.touchPan.clientY = event.clientY;
          return;
        }

        if (
          !state.currentStroke ||
          event.pointerId !== state.activePointerId ||
          state.currentStroke.page !== pageEntry.pageNumber ||
          options.getMode() !==
            (state.currentStroke.kind === 'highlighter'
              ? 'freehand-highlight'
              : 'annotate')
        ) {
          return;
        }

        const samples = event.getCoalescedEvents?.();
        const rect = canvas.getBoundingClientRect();
        for (const sample of samples?.length ? samples : [event]) {
          state.currentStroke.points.push(toPoint(canvas, sample, rect));
        }
        schedulePreview(pageEntry);
      },
      { signal: listeners.signal }
    );

    function finishPointer(event) {
      if (state.touchPan?.pointerId === event.pointerId) {
        state.touchPan = null;
        return;
      }
      // Pointerup can carry a final position not delivered by pointermove.
      if (
        event.type === 'pointerup' &&
        state.currentStroke &&
        state.activePointerId === event.pointerId &&
        state.currentStroke.page === pageEntry.pageNumber
      ) {
        const point = toPoint(canvas, event);
        const last = state.currentStroke.points.at(-1);
        if (point.x !== last.x || point.y !== last.y) {
          state.currentStroke.points.push(point);
        }
      }
      finalizeStroke(event);
    }

    canvas.addEventListener('pointerup', finishPointer, {
      signal: listeners.signal,
    });
    canvas.addEventListener('pointercancel', finishPointer, {
      signal: listeners.signal,
    });
    canvas.addEventListener('lostpointercapture', finishPointer, {
      signal: listeners.signal,
    });
  }

  return {
    dispose() {
      cancelPreview();
      listeners.abort();
      state.currentStroke = null;
      state.activePointerId = null;
      state.touchPan = null;
      state.previewPointCount = 0;
      for (const pageEntry of pageEntries) paintHighlighterPreview(pageEntry);
      highlighterPreviewCanvas = null;
    },
    load(strokes, changedPage) {
      const changedPages =
        changedPage === undefined
          ? changedStrokePages(state.strokes, strokes)
          : new Set([changedPage]);
      if (state.currentStroke) changedPages.add(state.currentStroke.page);
      state.strokes = structuredClone(strokes);
      state.currentStroke = null;
      state.activePointerId = null;
      state.touchPan = null;
      state.previewPointCount = 0;
      loadEpoch++;
      redrawPages(changedPages);
    },
    removeStroke(strokeId) {
      const pages = new Set(
        state.strokes
          .filter((stroke) => stroke.id === strokeId)
          .map((stroke) => stroke.page)
      );
      state.strokes = state.strokes.filter((stroke) => stroke.id !== strokeId);
      if (pages.size) redrawPages(pages);
    },
    undoLastStroke() {
      const lastStroke = state.strokes.at(-1);
      if (!lastStroke) {
        return null;
      }

      state.strokes = state.strokes.slice(0, -1);
      redrawPages([lastStroke.page]);
      return structuredClone(lastStroke);
    },
  };
}
