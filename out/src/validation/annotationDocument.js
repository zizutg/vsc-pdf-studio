"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAnnotationDocument = sanitizeAnnotationDocument;
const annotation_1 = require("../../models/annotation");
const constants_1 = require("../constants");
const DEFAULT_COLOR = '#ef4444';
function sanitizeAnnotationDocument(input) {
    if (!isObject(input)) {
        return (0, annotation_1.emptyAnnotationDocument)();
    }
    const strokes = sanitizeStrokes(input.strokes);
    const highlights = sanitizeHighlights(input.highlights);
    const comments = sanitizeComments(input.comments);
    return {
        version: 1,
        updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.length > 0
            ? input.updatedAt
            : new Date(0).toISOString(),
        strokes,
        highlights,
        comments
    };
}
function sanitizeStrokes(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    if (value.length > constants_1.PDF_STUDIO_LIMITS.maxStrokes) {
        throw new Error('Annotation payload exceeds stroke limit.');
    }
    return value
        .map((stroke) => sanitizeStroke(stroke))
        .filter((stroke) => stroke !== null);
}
function sanitizeStroke(value) {
    if (!isObject(value)) {
        return null;
    }
    const points = sanitizePoints(value.points, constants_1.PDF_STUDIO_LIMITS.maxPointsPerStroke);
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
function sanitizeHighlights(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    if (value.length > constants_1.PDF_STUDIO_LIMITS.maxHighlights) {
        throw new Error('Annotation payload exceeds highlight limit.');
    }
    return value
        .map((highlight) => sanitizeHighlight(highlight))
        .filter((highlight) => highlight !== null);
}
function sanitizeHighlight(value) {
    if (!isObject(value)) {
        return null;
    }
    const rects = sanitizeRects(value.rects, constants_1.PDF_STUDIO_LIMITS.maxRectsPerHighlight);
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
function sanitizeComments(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    if (value.length > constants_1.PDF_STUDIO_LIMITS.maxComments) {
        throw new Error('Annotation payload exceeds comment limit.');
    }
    return value
        .map((comment) => sanitizeComment(comment))
        .filter((comment) => comment !== null);
}
function sanitizeComment(value) {
    if (!isObject(value)) {
        return null;
    }
    const rects = sanitizeRects(value.rects, constants_1.PDF_STUDIO_LIMITS.maxRectsPerComment);
    const text = typeof value.text === 'string'
        ? value.text.trim().slice(0, constants_1.PDF_STUDIO_LIMITS.maxCommentLength)
        : '';
    if (!rects.length || !text) {
        return null;
    }
    return {
        id: sanitizeId(value.id),
        color: sanitizeColor(value.color),
        page: sanitizePage(value.page),
        viewportWidth: sanitizePositiveNumber(value.viewportWidth, 1),
        viewportHeight: sanitizePositiveNumber(value.viewportHeight, 1),
        rects,
        text
    };
}
function sanitizePoints(value, maxLength) {
    if (!Array.isArray(value)) {
        return [];
    }
    if (value.length > maxLength) {
        throw new Error('Annotation payload exceeds point limit.');
    }
    return value
        .map((point) => sanitizePoint(point))
        .filter((point) => point !== null);
}
function sanitizePoint(value) {
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
function sanitizeRects(value, maxLength) {
    if (!Array.isArray(value)) {
        return [];
    }
    if (value.length > maxLength) {
        throw new Error('Annotation payload exceeds rectangle limit.');
    }
    return value
        .map((rect) => sanitizeRect(rect))
        .filter((rect) => rect !== null);
}
function sanitizeRect(value) {
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
function sanitizeFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function sanitizePositiveNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
function sanitizePage(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}
function sanitizeColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
        ? value.trim()
        : DEFAULT_COLOR;
}
function sanitizeId(value) {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : crypto.randomUUID();
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=annotationDocument.js.map