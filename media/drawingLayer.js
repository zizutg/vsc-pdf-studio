function drawStroke(context, canvas, stroke) {
  if (!stroke.points.length) {
    return;
  }

  context.strokeStyle = stroke.color;
  const scaleX = canvas.width / Math.max(stroke.viewportWidth || canvas.width, 1);
  const scaleY = canvas.height / Math.max(stroke.viewportHeight || canvas.height, 1);
  context.lineWidth = stroke.width * ((scaleX + scaleY) / 2);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);

  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x * scaleX, point.y * scaleY);
  }

  context.stroke();
}

export function createDrawingLayer(pageEntries, options) {
  const state = {
    strokes: [],
    currentStroke: null
  };

  function redrawPage(pageEntry) {
    const context = pageEntry.drawingCanvas.getContext('2d');
    context.clearRect(0, 0, pageEntry.drawingCanvas.width, pageEntry.drawingCanvas.height);

    for (const stroke of state.strokes) {
      if (stroke.page === pageEntry.pageNumber) {
        drawStroke(context, pageEntry.drawingCanvas, stroke);
      }
    }

    if (state.currentStroke?.page === pageEntry.pageNumber) {
      drawStroke(context, pageEntry.drawingCanvas, state.currentStroke);
    }
  }

  function redrawAll() {
    for (const pageEntry of pageEntries) {
      redrawPage(pageEntry);
    }
  }

  function toPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function finalizeStroke() {
    if (!state.currentStroke) {
      return;
    }

    if (state.currentStroke.points.length > 1) {
      state.strokes.push(state.currentStroke);
      options.onChange(structuredClone(state.strokes), structuredClone(state.currentStroke));
    }

    state.currentStroke = null;
    redrawAll();
  }

  function findStrokeNearPoint(pageNumber, point) {
    let bestStroke = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const stroke of state.strokes) {
      if (stroke.page !== pageNumber) {
        continue;
      }

      const scaleX = point.viewportWidth / Math.max(stroke.viewportWidth || point.viewportWidth, 1);
      const scaleY = point.viewportHeight / Math.max(stroke.viewportHeight || point.viewportHeight, 1);
      const threshold = Math.max(stroke.width * ((scaleX + scaleY) / 2), 12);

      for (const candidate of stroke.points) {
        const dx = candidate.x * scaleX - point.x;
        const dy = candidate.y * scaleY - point.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= threshold && distance < bestDistance) {
          bestStroke = stroke;
          bestDistance = distance;
        }
      }
    }

    return bestStroke;
  }

  for (const pageEntry of pageEntries) {
    const canvas = pageEntry.drawingCanvas;

    canvas.addEventListener('pointerdown', (event) => {
      const mode = options.getMode();
      if (mode === 'select') {
        return;
      }

      canvas.setPointerCapture(event.pointerId);
      if (mode === 'erase') {
        const point = {
          ...toPoint(canvas, event),
          viewportWidth: canvas.width,
          viewportHeight: canvas.height
        };
        const targetStroke = findStrokeNearPoint(pageEntry.pageNumber, point);
        if (targetStroke) {
          state.strokes = state.strokes.filter((stroke) => stroke.id !== targetStroke.id);
          options.onErase?.(structuredClone(targetStroke), structuredClone(state.strokes));
          redrawAll();
        }
        return;
      }

      state.currentStroke = {
        id: crypto.randomUUID(),
        page: pageEntry.pageNumber,
        color: options.getColor(),
        width: options.getWidth(),
        viewportWidth: canvas.width,
        viewportHeight: canvas.height,
        points: [toPoint(canvas, event)]
      };
      redrawPage(pageEntry);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!state.currentStroke || state.currentStroke.page !== pageEntry.pageNumber || options.getMode() !== 'annotate') {
        return;
      }

      state.currentStroke.points.push(toPoint(canvas, event));
      redrawPage(pageEntry);
    });

    canvas.addEventListener('pointerup', finalizeStroke);
    canvas.addEventListener('pointercancel', finalizeStroke);
  }

  return {
    load(strokes) {
      state.strokes = structuredClone(strokes);
      state.currentStroke = null;
      redrawAll();
    },
    removeStroke(strokeId) {
      state.strokes = state.strokes.filter((stroke) => stroke.id !== strokeId);
      redrawAll();
    },
    undoLastStroke() {
      const lastStroke = state.strokes.at(-1);
      if (!lastStroke) {
        return null;
      }

      state.strokes = state.strokes.slice(0, -1);
      redrawAll();
      return structuredClone(lastStroke);
    }
  };
}
