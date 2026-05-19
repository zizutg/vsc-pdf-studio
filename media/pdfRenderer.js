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
  const outline = await buildOutline(pdf);
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
    const outputScale = globalThis.devicePixelRatio || 1;
    const pageShell = document.createElement('div');
    const pdfCanvas = document.createElement('canvas');
    const highlightLayer = document.createElement('div');
    const searchLayer = document.createElement('div');
    const commentLayer = document.createElement('div');
    const textLayerBuilder = new TextLayerBuilder({});
    const textLayer = textLayerBuilder.div;
    const drawingCanvas = document.createElement('canvas');

    pageShell.className = 'page-shell';
    pdfCanvas.className = 'pdf-canvas';
    highlightLayer.className = 'highlight-layer';
    searchLayer.className = 'search-layer';
    commentLayer.className = 'comment-layer';
    textLayer.classList.add('text-layer');
    drawingCanvas.className = 'drawing-canvas';

    pageShell.style.setProperty('--scale-factor', String(viewport.scale));
    pageShell.style.width = `${viewport.width}px`;
    pageShell.style.height = `${viewport.height}px`;

    pdfCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    pdfCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    drawingCanvas.width = viewport.width;
    drawingCanvas.height = viewport.height;
    pdfCanvas.style.width = `${viewport.width}px`;
    pdfCanvas.style.height = `${viewport.height}px`;
    drawingCanvas.style.width = `${viewport.width}px`;
    drawingCanvas.style.height = `${viewport.height}px`;
    textLayer.style.width = `${unscaledViewport.width}px`;
    textLayer.style.height = `${unscaledViewport.height}px`;

    pageShell.append(pdfCanvas, highlightLayer, searchLayer, textLayer, commentLayer, drawingCanvas);
    fragment.append(pageShell);

    const pdfContext = pdfCanvas.getContext('2d');
    await page.render({
      canvasContext: pdfContext,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    }).promise;

    const thumbnailCanvas = document.createElement('canvas');
    const thumbnailWidth = 92;
    const thumbnailScale = thumbnailWidth / Math.max(viewport.width, 1);
    thumbnailCanvas.width = Math.max(1, Math.round(viewport.width * thumbnailScale));
    thumbnailCanvas.height = Math.max(1, Math.round(viewport.height * thumbnailScale));
    thumbnailCanvas
      .getContext('2d')
      .drawImage(pdfCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);

    const textContentSource = await page.getTextContent();
    textLayerBuilder.setTextContentSource(textContentSource);
    await textLayerBuilder.render(viewport);

    pages.push({
      pageNumber,
      pageShell,
      pdfCanvas,
      highlightLayer,
      searchLayer,
      commentLayer,
      textLayer,
      textDivs: textLayerBuilder.textDivs,
      textContentItemsStr: textLayerBuilder.textContentItemsStr,
      drawingCanvas,
      thumbnailDataUrl: thumbnailCanvas.toDataURL('image/png'),
      width: viewport.width,
      height: viewport.height
    });
  }

  return {
    pages,
    outline,
    resolvedScale,
    fragment
  };
}

async function buildOutline(pdf) {
  const rawOutline = (await pdf.getOutline()) ?? [];
  const pageIndexCache = new Map();
  const destinationCache = new Map();
  const pageViewportCache = new Map();

  async function getPageViewport(pageNumber) {
    if (!pageViewportCache.has(pageNumber)) {
      const page = await pdf.getPage(pageNumber);
      pageViewportCache.set(pageNumber, page.getViewport({ scale: 1 }));
    }
    return pageViewportCache.get(pageNumber);
  }

  async function resolveDestination(destination) {
    if (!destination) {
      return null;
    }

    let explicitDestination = destination;
    if (typeof destination === 'string') {
      if (destinationCache.has(destination)) {
        explicitDestination = destinationCache.get(destination);
      } else {
        explicitDestination = await pdf.getDestination(destination);
        destinationCache.set(destination, explicitDestination ?? null);
      }
    }

    if (!Array.isArray(explicitDestination) || !explicitDestination.length) {
      return null;
    }

    const destinationRef = explicitDestination[0];
    if (Number.isInteger(destinationRef) && destinationRef >= 0) {
      return {
        pageNumber: destinationRef + 1,
        explicitDestination
      };
    }

    if (!destinationRef || typeof destinationRef !== 'object' || !('num' in destinationRef) || !('gen' in destinationRef)) {
      return null;
    }

    const cacheKey = `${destinationRef.num}:${destinationRef.gen}`;
    if (pageIndexCache.has(cacheKey)) {
      return {
        pageNumber: pageIndexCache.get(cacheKey),
        explicitDestination
      };
    }

    try {
      const pageIndex = await pdf.getPageIndex(destinationRef);
      const pageNumber = pageIndex + 1;
      pageIndexCache.set(cacheKey, pageNumber);
      return {
        pageNumber,
        explicitDestination
      };
    } catch {
      return null;
    }
  }

  async function resolveOutlineTopRatio(destinationInfo) {
    if (!destinationInfo?.explicitDestination || !destinationInfo.pageNumber) {
      return 0;
    }

    const [, destinationType, ...args] = destinationInfo.explicitDestination;
    const viewport = await getPageViewport(destinationInfo.pageNumber);
    const destinationName = destinationType?.name;
    let x = 0;
    let y = viewport.height;

    switch (destinationName) {
      case 'XYZ':
        y = args[1] ?? viewport.height;
        break;
      case 'FitH':
      case 'FitBH':
        y = typeof args[0] === 'number' ? args[0] : viewport.height;
        break;
      case 'FitR':
        y = typeof args[1] === 'number' ? args[1] : viewport.height;
        break;
      case 'Fit':
      case 'FitB':
      default:
        return 0;
    }

    const [, top] = viewport.convertToViewportPoint(x, y);
    return Math.max(0, Math.min(1, top / Math.max(viewport.height, 1)));
  }

  async function mapItems(items, depth = 0) {
    const results = [];

    for (const item of items) {
      const destinationInfo = await resolveDestination(item.dest);
      const ownPageNumber = destinationInfo?.pageNumber ?? null;
      const ownTopRatio = ownPageNumber ? await resolveOutlineTopRatio(destinationInfo) : 0;
      const children = item.items?.length ? await mapItems(item.items, depth + 1) : [];
      const fallbackPageNumber = children.find((child) => child.pageNumber)?.pageNumber ?? null;
      const fallbackTopRatio = children.find((child) => child.pageNumber)?.topRatio ?? 0;
      const pageNumber = ownPageNumber ?? fallbackPageNumber;
      const topRatio = ownPageNumber ? ownTopRatio : fallbackTopRatio;

      results.push({
        title: item.title?.trim() || `Section ${results.length + 1}`,
        pageNumber,
        topRatio,
        depth,
        items: children
      });
    }

    return results;
  }

  return mapItems(rawOutline);
}

function resolveScale(zoomConfig, workspaceSize, basePageSize) {
  const columnCount = zoomConfig.layout === 'double' ? 2 : 1;
  const interPageGap = columnCount > 1 ? 24 : 0;
  const availableWidth = Math.max(240, workspaceSize.width - 24);
  const columnWidth = Math.max(120, (availableWidth - interPageGap) / columnCount);

  switch (zoomConfig.mode) {
    case 'page-width': {
      return Math.max(0.5, columnWidth / Math.max(basePageSize.width, 1));
    }
    case 'page-fit':
    case 'automatic': {
      const fitWidth = columnWidth / Math.max(basePageSize.width, 1);
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
