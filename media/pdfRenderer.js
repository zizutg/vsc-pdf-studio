export async function renderPdf(base64, container, zoomConfig, workspaceSize) {
  const pdfjsLib = globalThis.pdfjsLib;
  const TextLayerBuilder = globalThis.pdfjsViewer?.TextLayerBuilder;
  if (!pdfjsLib?.getDocument || !TextLayerBuilder) {
    throw new Error('pdf.js viewer failed to load in the webview.');
  }

  const pdfData = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const loadingTask = pdfjsLib.getDocument({
    data: pdfData,
    disableWorker: true
  });
  const pdf = await loadingTask.promise;
  const firstPage = await pdf.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const resolvedScale = resolveScale(zoomConfig, workspaceSize, {
    width: baseViewport.width,
    height: baseViewport.height
  });
  const pages = [];
  const fragment = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: resolvedScale });
    const unscaledViewport = page.getViewport({ scale: 1 });
    const pageShell = document.createElement('div');
    const pdfCanvas = document.createElement('canvas');
    const highlightLayer = document.createElement('div');
    const commentLayer = document.createElement('div');
    const textLayerBuilder = new TextLayerBuilder({});
    const textLayer = textLayerBuilder.div;
    const drawingCanvas = document.createElement('canvas');

    pageShell.className = 'page-shell';
    pdfCanvas.className = 'pdf-canvas';
    highlightLayer.className = 'highlight-layer';
    commentLayer.className = 'comment-layer';
    textLayer.classList.add('text-layer');
    drawingCanvas.className = 'drawing-canvas';

    pageShell.style.setProperty('--scale-factor', String(viewport.scale));
    pageShell.style.width = `${viewport.width}px`;
    pageShell.style.height = `${viewport.height}px`;

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    drawingCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    pdfCanvas.style.width = `${viewport.width}px`;
    pdfCanvas.style.height = `${viewport.height}px`;
    drawingCanvas.style.width = `${viewport.width}px`;
    drawingCanvas.style.height = `${viewport.height}px`;
    textLayer.style.width = `${unscaledViewport.width}px`;
    textLayer.style.height = `${unscaledViewport.height}px`;

    pageShell.append(pdfCanvas, highlightLayer, textLayer, commentLayer, drawingCanvas);
    fragment.append(pageShell);

    await page.render({
      canvasContext: pdfCanvas.getContext('2d'),
      viewport
    }).promise;

    const textContentSource = await page.getTextContent();
    textLayerBuilder.setTextContentSource(textContentSource);
    await textLayerBuilder.render(viewport);

    pages.push({
      pageNumber,
      pageShell,
      pdfCanvas,
      highlightLayer,
      commentLayer,
      textLayer,
      drawingCanvas,
      width: viewport.width,
      height: viewport.height
    });
  }

  return {
    pages,
    resolvedScale,
    fragment
  };
}

function resolveScale(zoomConfig, workspaceSize, basePageSize) {
  switch (zoomConfig.mode) {
    case 'page-width': {
      return Math.max(0.5, (workspaceSize.width - 24) / Math.max(basePageSize.width, 1));
    }
    case 'page-fit':
    case 'automatic': {
      const fitWidth = (workspaceSize.width - 24) / Math.max(basePageSize.width, 1);
      const fitHeight = (workspaceSize.height - 24) / Math.max(basePageSize.height, 1);
      return Math.max(0.5, Math.min(fitWidth, fitHeight));
    }
    case 'actual-size': {
      return 1;
    }
    case 'custom':
    default: {
      return zoomConfig.scale;
    }
  }
}
