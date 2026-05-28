import {
  emptyAnnotationDocument,
  type AnnotationComment,
  type AnnotationDocument,
  type AnnotationHighlight,
  type AnnotationPoint,
  type AnnotationRect,
  type AnnotationStroke
} from '../../models/annotation';
import { PDF_STUDIO_LIMITS } from '../constants';

const DEFAULT_COLOR = '#ef4444';

export function sanitizeAnnotationDocument(input: unknown): AnnotationDocument {
  if (!isObject(input)) {
    return emptyAnnotationDocument();
  }

  const strokes = sanitizeStrokes(input.strokes);
  const highlights = sanitizeHighlights(input.highlights);
  const comments = sanitizeComments(input.comments);

  return {
    version: 1,
    updatedAt:
      typeof input.updatedAt === 'string' && input.updatedAt.length > 0
        ? input.updatedAt
        : new Date(0).toISOString(),
    strokes,
    highlights,
    comments
  };
}

function sanitizeStrokes(value: unknown): AnnotationStroke[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > PDF_STUDIO_LIMITS.maxStrokes) {
    throw new Error('Annotation payload exceeds stroke limit.');
  }

  return value
    .map((stroke) => sanitizeStroke(stroke))
    .filter((stroke): stroke is AnnotationStroke => stroke !== null);
}

function sanitizeStroke(value: unknown): AnnotationStroke | null {
  if (!isObject(value)) {
    return null;
  }

  const points = sanitizePoints(value.points, PDF_STUDIO_LIMITS.maxPointsPerStroke);
  if (points.length < 2) {
    return null;
  }

  return {
    id: sanitizeId(value.id),
    color: sanitizeColor(value.color),
    width: sanitizePositiveNumber(value.width, 3),
    page: sanitizePage(value.page),
    viewportWidth: sanitizePositiveNumber(value.viewportWidth, 1),
    viewportHeight: sanitizePositiveNumber(value.viewportHeight, 1),
    points
  };
}

function sanitizeHighlights(value: unknown): AnnotationHighlight[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > PDF_STUDIO_LIMITS.maxHighlights) {
    throw new Error('Annotation payload exceeds highlight limit.');
  }

  return value
    .map((highlight) => sanitizeHighlight(highlight))
    .filter((highlight): highlight is AnnotationHighlight => highlight !== null);
}

function sanitizeHighlight(value: unknown): AnnotationHighlight | null {
  if (!isObject(value)) {
    return null;
  }

  const rects = sanitizeRects(value.rects, PDF_STUDIO_LIMITS.maxRectsPerHighlight);
  if (!rects.length) {
    return null;
  }

  return {
    id: sanitizeId(value.id),
    kind: value.kind === 'underline' ? 'underline' : value.kind === 'strikeout' ? 'strikeout' : 'highlight',
    color: sanitizeColor(value.color),
    page: sanitizePage(value.page),
    viewportWidth: sanitizePositiveNumber(value.viewportWidth, 1),
    viewportHeight: sanitizePositiveNumber(value.viewportHeight, 1),
    rects
  };
}

function sanitizeComments(value: unknown): AnnotationComment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > PDF_STUDIO_LIMITS.maxComments) {
    throw new Error('Annotation payload exceeds comment limit.');
  }

  return value
    .map((comment) => sanitizeComment(comment))
    .filter((comment): comment is AnnotationComment => comment !== null);
}

function sanitizeComment(value: unknown): AnnotationComment | null {
  if (!isObject(value)) {
    return null;
  }

  const rects = sanitizeRects(value.rects, PDF_STUDIO_LIMITS.maxRectsPerComment);
  const text =
    typeof value.text === 'string'
      ? value.text.trim().slice(0, PDF_STUDIO_LIMITS.maxCommentLength)
      : '';

  if (!rects.length || !text) {
    return null;
  }

  return {
    id: sanitizeId(value.id),
    author: typeof value.author === 'string' ? value.author.trim().slice(0, 120) : undefined,
    modifiedAt: typeof value.modifiedAt === 'string' && value.modifiedAt.trim() ? value.modifiedAt.trim() : undefined,
    color: sanitizeColor(value.color),
    page: sanitizePage(value.page),
    viewportWidth: sanitizePositiveNumber(value.viewportWidth, 1),
    viewportHeight: sanitizePositiveNumber(value.viewportHeight, 1),
    rects,
    text
  };
}

function sanitizePoints(value: unknown, maxLength: number): AnnotationPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > maxLength) {
    throw new Error('Annotation payload exceeds point limit.');
  }

  return value
    .map((point) => sanitizePoint(point))
    .filter((point): point is AnnotationPoint => point !== null);
}

function sanitizePoint(value: unknown): AnnotationPoint | null {
  if (!isObject(value)) {
    return null;
  }

  const x = sanitizeFiniteNumber(value.x);
  const y = sanitizeFiniteNumber(value.y);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function sanitizeRects(value: unknown, maxLength: number): AnnotationRect[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > maxLength) {
    throw new Error('Annotation payload exceeds rectangle limit.');
  }

  return value
    .map((rect) => sanitizeRect(rect))
    .filter((rect): rect is AnnotationRect => rect !== null);
}

function sanitizeRect(value: unknown): AnnotationRect | null {
  if (!isObject(value)) {
    return null;
  }

  const x = sanitizeFiniteNumber(value.x);
  const y = sanitizeFiniteNumber(value.y);
  const width = sanitizePositiveNumber(value.width, 0);
  const height = sanitizePositiveNumber(value.height, 0);
  if (x === null || y === null || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function sanitizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizePage(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

function sanitizeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : DEFAULT_COLOR;
}

function sanitizeId(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : crypto.randomUUID();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
