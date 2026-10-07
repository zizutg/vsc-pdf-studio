// Browser-only checks run by the developer benchmark, never shipped in the VSIX.
export async function runDrawingPixelChecks() {
  const { createDrawingLayer } = await import('/media/drawingLayer.js');
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const settle = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  const paintStrokes = (canvas, strokes) => {
    const context = canvas.getContext('2d');
    for (const stroke of strokes) {
      const sx = canvas.width / stroke.viewportWidth;
      const sy = canvas.height / stroke.viewportHeight;
      context.strokeStyle = stroke.color;
      context.lineWidth = (stroke.width * (sx + sy)) / 2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      stroke.points.forEach((point, index) => {
        if (!index) context.moveTo(point.x * sx, point.y * sy);
        else context.lineTo(point.x * sx, point.y * sy);
      });
      context.stroke();
    }
  };
  const paths = {
    straight: Array.from({ length: 41 }, (_, index) => ({
      x: 20 + index * 4,
      y: 40,
    })),
    corners: [
      { x: 20, y: 30 },
      { x: 80, y: 30 },
      { x: 80, y: 90 },
      { x: 25, y: 55 },
      { x: 150, y: 55 },
      { x: 30, y: 120 },
    ],
    crossing: Array.from({ length: 61 }, (_, index) => ({
      x: 115 + 80 * Math.sin((index * Math.PI) / 15),
      y: 85 + 50 * Math.sin((index * Math.PI) / 10),
    })),
    jitter: Array.from({ length: 81 }, (_, index) => ({
      x: 20 + index * 2,
      y: index === 0 || index === 80 ? 40 : 40 + (index % 2 ? 0.12 : -0.12),
    })),
  };
  const results = [];
  for (const [name, points] of Object.entries(paths)) {
    for (const width of [1, 3, 6]) {
      for (const scale of [1, 2]) {
        const shell = document.createElement('div');
        shell.style.cssText =
          'position:fixed;left:0;top:0;pointer-events:none;z-index:-1';
        const canvas = document.createElement('canvas');
        canvas.width = 240 * scale;
        canvas.height = 180 * scale;
        canvas.style.cssText = 'width:240px;height:180px';
        // Synthetic events have no OS pointer capture; scope the stub to this test canvas.
        canvas.setPointerCapture = () => {};
        shell.append(canvas);
        document.body.append(shell);
        const reference = document.createElement('canvas');
        reference.width = canvas.width;
        reference.height = canvas.height;
        const oldInk = [
          {
            id: 'old',
            page: 1,
            color: '#dc2626',
            width: 3,
            viewportWidth: 240,
            viewportHeight: 180,
            points: [
              { x: 30, y: 150 },
              { x: 160, y: 20 },
              { x: 190, y: 155 },
            ],
          },
        ];
        let saved;
        const layer = createDrawingLayer(
          [{ pageNumber: 1, drawingCanvas: canvas, pageShell: shell }],
          {
            getMode: () => 'annotate',
            getColor: () => '#2563eb',
            getWidth: () => width * scale,
            onChange(strokes) {
              saved = strokes;
              layer.load(strokes);
            },
          }
        );
        try {
          layer.load(oldInk);
          const rect = canvas.getBoundingClientRect();
          const fire = (type, point) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                pointerType: 'pen',
                buttons: type === 'pointerup' ? 0 : 1,
                clientX: rect.left + point.x,
                clientY: rect.top + point.y,
              })
            );
          fire('pointerdown', points[0]);
          for (let index = 1; index < points.length; index++) {
            fire('pointermove', points[index]);
            await settle();
          }
          const expectedStroke = {
            page: 1,
            color: '#2563eb',
            width: width * scale,
            viewportWidth: canvas.width,
            viewportHeight: canvas.height,
            points: points.map((point) => ({
              x: (point.x / rect.width) * canvas.width,
              y: (point.y / rect.height) * canvas.height,
            })),
          };
          paintStrokes(reference, [...oldInk, expectedStroke]);
          const context = reference.getContext('2d');
          const expected = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data;
          const preview = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let missingCorePixels = 0;
          let partialCoveragePixels = 0;
          let changedPixels = 0;
          for (let index = 0; index < expected.length; index += 4) {
            // Separate batches can antialias crossings differently. Check for
            // absent ink now, and require exact canonical pixels after release.
            if (expected[index + 3] >= 250 && preview[index + 3] === 0)
              missingCorePixels++;
            if (expected[index + 3] >= 250 && preview[index + 3] < 200)
              partialCoveragePixels++;
            if (
              expected
                .slice(index, index + 4)
                .some((value, channel) => value !== preview[index + channel])
            )
              changedPixels++;
          }
          check(
            missingCorePixels === 0,
            `${name}/${width}/${scale}: live preview has missing stroke pixels`
          );
          fire('pointerup', points.at(-1));
          check(
            saved?.length === 2 &&
              saved[1].points.length <= points.length &&
              saved[1].points[0].x === expectedStroke.points[0].x &&
              saved[1].points.at(-1).x === expectedStroke.points.at(-1).x,
            'saved stroke lost an endpoint'
          );
          const simplifiedReference = document.createElement('canvas');
          simplifiedReference.width = canvas.width;
          simplifiedReference.height = canvas.height;
          paintStrokes(simplifiedReference, [...oldInk, saved[1]]);
          const simplifiedPixels = simplifiedReference
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const finalPixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          check(
            simplifiedPixels.every(
              (value, index) => value === finalPixels[index]
            ),
            `${name}/${width}/${scale}: completed stroke differs from saved path`
          );
          let finalChangedPixels = 0;
          let finalMissingCorePixels = 0;
          for (let index = 0; index < expected.length; index += 4) {
            if (expected[index + 3] >= 250 && finalPixels[index + 3] === 0)
              finalMissingCorePixels++;
            if (
              expected
                .slice(index, index + 4)
                .some(
                  (value, channel) => value !== finalPixels[index + channel]
                )
            )
              finalChangedPixels++;
          }
          check(
            finalMissingCorePixels === 0 &&
              finalChangedPixels <= canvas.width * canvas.height * 0.005,
            `${name}/${width}/${scale}: simplified path lost visible detail`
          );
          results.push({
            name,
            width,
            scale,
            originalPoints: points.length,
            savedPoints: saved[1].points.length,
            missingCorePixels,
            partialCoveragePixels,
            previewChangedPixels: changedPixels,
            finalChangedPixels,
            finalMissingCorePixels,
            finalMatchesReference: true,
          });
        } finally {
          layer.dispose?.();
          shell.remove();
        }
      }
    }
  }
  const shell = document.createElement('div');
  shell.style.cssText =
    'position:fixed;left:0;top:0;pointer-events:none;z-index:-1';
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 180;
  canvas.style.cssText = 'width:240px;height:180px';
  shell.append(canvas);
  canvas.setPointerCapture = () => {};
  document.body.append(shell);
  let previewCanvas;
  const highlighterPoints = [
    { x: 30, y: 50 },
    { x: 150, y: 100 },
    { x: 30, y: 100 },
    { x: 150, y: 50 },
  ];
  let savedHighlighter;
  const layer = createDrawingLayer(
    [
      {
        pageNumber: 1,
        drawingCanvas: canvas,
        pageShell: shell,
      },
    ],
    {
      getMode: () => 'freehand-highlight',
      getColor: () => '#eab308',
      getHighlighterWidth: () => 14,
      getHighlighterOpacity: () => 0.3,
      onChange: (strokes) => {
        savedHighlighter = strokes.at(-1);
        layer.load(strokes);
      },
    }
  );
  try {
    const rect = canvas.getBoundingClientRect();
    const fire = (type, point) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'pen',
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
        })
      );
    fire('pointerdown', highlighterPoints[0]);
    for (let index = 1; index < highlighterPoints.length; index++) {
      fire('pointermove', highlighterPoints[index]);
      await settle();
      previewCanvas = shell.querySelector('.highlighter-preview-canvas');
      check(
        previewCanvas !== null,
        'highlighter preview canvas was not created'
      );
      const reference = document.createElement('canvas');
      reference.width = 240;
      reference.height = 180;
      reference.getContext('2d').globalAlpha = 0.3;
      paintStrokes(reference, [
        {
          color: '#eab308',
          width: 14,
          viewportWidth: 240,
          viewportHeight: 180,
          points: highlighterPoints.slice(0, index + 1),
        },
      ]);
      const expected = reference
        .getContext('2d')
        .getImageData(0, 0, 240, 180).data;
      const actual = previewCanvas
        .getContext('2d')
        .getImageData(0, 0, 240, 180).data;
      let missingCorePixels = 0;
      let alphaDifferencePixels = 0;
      let largeColorDifferencePixels = 0;
      let maxAlpha = 0;
      for (let pixel = 0; pixel < actual.length; pixel += 4) {
        maxAlpha = Math.max(maxAlpha, actual[pixel + 3]);
        if (expected[pixel + 3] >= 70 && actual[pixel + 3] < 50)
          missingCorePixels++;
        if (Math.abs(expected[pixel + 3] - actual[pixel + 3]) > 2)
          alphaDifferencePixels++;
        if (
          expected[pixel + 3] >= 10 &&
          actual[pixel + 3] >= 10 &&
          [0, 1, 2].some(
            (channel) =>
              Math.abs(expected[pixel + channel] - actual[pixel + channel]) > 10
          )
        )
          largeColorDifferencePixels++;
      }
      check(
        missingCorePixels === 0 &&
          alphaDifferencePixels <= 240 * 180 * 0.02 &&
          largeColorDifferencePixels <= 240 * 180 * 0.005,
        `highlighter preview frame ${index} differs (${missingCorePixels} missing core, ${alphaDifferencePixels} alpha, ${largeColorDifferencePixels} color pixels)`
      );
      check(maxAlpha <= 78, 'highlighter overlap accumulated opacity');
    }
    fire('pointerup', highlighterPoints.at(-1));
    check(
      savedHighlighter?.kind === 'highlighter' &&
        savedHighlighter.opacity === 0.3 &&
        savedHighlighter.width === 14,
      'highlighter stroke was not saved with its appearance'
    );
    const committedReference = document.createElement('canvas');
    committedReference.width = canvas.width;
    committedReference.height = canvas.height;
    committedReference.getContext('2d').globalAlpha = savedHighlighter.opacity;
    paintStrokes(committedReference, [savedHighlighter]);
    const committedPixels = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const referencePixels = committedReference
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data;
    check(
      committedPixels.every((value, index) => value === referencePixels[index]),
      'committed highlighter differs from its saved path'
    );
    check(
      committedPixels.every((value, index) => index % 4 !== 3 || value <= 78),
      'committed highlighter overlap accumulated opacity'
    );
    check(
      shell.querySelector('.highlighter-preview-canvas') === null,
      'highlighter preview canvas remained attached after release'
    );
    const remaining = previewCanvas
      .getContext('2d')
      .getImageData(0, 0, 240, 180).data;
    check(
      remaining.every((value) => value === 0),
      'highlighter preview remained after release'
    );
    results.push({ name: 'highlighter-preview-and-commit', opacity: 0.3 });
  } finally {
    layer.dispose();
    shell.remove();
  }
  return results;
}
