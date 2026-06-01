export const PDF_STUDIO_VIEW_TYPE = 'pdfStudio.editor';

export const PDF_STUDIO_DATA_KEY = 'PdfStudioData';
export const PDF_STUDIO_BASE_KEY = 'PdfStudioBase';

export const PDF_STUDIO_LIMITS = {
  maxStrokes: 2_000,
  maxPointsPerStroke: 10_000,
  maxHighlights: 4_000,
  maxRectsPerHighlight: 256,
  maxComments: 1_000,
  maxRectsPerComment: 256,
  maxCommentLength: 8_000,
} as const;
