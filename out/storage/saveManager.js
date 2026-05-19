"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaveManager = void 0;
const fs = __importStar(require("node:fs/promises"));
const pdf_lib_1 = require("pdf-lib");
const annotation_1 = require("../models/annotation");
const constants_1 = require("../src/constants");
const annotationDocument_1 = require("../src/validation/annotationDocument");
const PDF_STUDIO_COMMENT_KEY = pdf_lib_1.PDFName.of('PDFStudioComment');
class SaveManager {
    sessionBasePdf = new Map();
    sessionAnnotations = new Map();
    async getPdfBytes(pdfUri) {
        const cacheKey = pdfUri.toString();
        if (!this.sessionBasePdf.has(cacheKey)) {
            await this.loadSessionState(pdfUri);
        }
        return new Uint8Array(this.sessionBasePdf.get(cacheKey) ?? new Uint8Array());
    }
    async getAnnotations(pdfUri) {
        const cacheKey = pdfUri.toString();
        if (!this.sessionAnnotations.has(cacheKey)) {
            await this.loadSessionState(pdfUri);
        }
        return structuredClone(this.sessionAnnotations.get(cacheKey) ?? (0, annotation_1.emptyAnnotationDocument)());
    }
    async save(pdfUri, annotations) {
        const cacheKey = pdfUri.toString();
        let basePdfBytes = this.sessionBasePdf.get(cacheKey);
        if (!basePdfBytes) {
            basePdfBytes = await this.getPdfBytes(pdfUri);
        }
        const pdfDocument = await pdf_lib_1.PDFDocument.load(basePdfBytes);
        const pages = pdfDocument.getPages();
        for (const stroke of annotations.strokes) {
            const page = pages[stroke.page - 1];
            if (!page || stroke.points.length < 2) {
                continue;
            }
            const scaleX = page.getWidth() / Math.max(stroke.viewportWidth, 1);
            const scaleY = page.getHeight() / Math.max(stroke.viewportHeight, 1);
            const lineWidth = stroke.width * ((scaleX + scaleY) / 2);
            const color = toRgb(stroke.color);
            for (const [start, end] of toSegments(stroke.points)) {
                page.drawLine({
                    start: toPdfPoint(start, scaleX, scaleY, page.getHeight()),
                    end: toPdfPoint(end, scaleX, scaleY, page.getHeight()),
                    thickness: lineWidth,
                    color,
                    opacity: 1
                });
            }
        }
        for (const highlight of annotations.highlights) {
            const page = pages[highlight.page - 1];
            if (!page || !highlight.rects.length) {
                continue;
            }
            const scaleX = page.getWidth() / Math.max(highlight.viewportWidth, 1);
            const scaleY = page.getHeight() / Math.max(highlight.viewportHeight, 1);
            const color = toRgb(highlight.color);
            for (const rect of highlight.rects) {
                page.drawRectangle({
                    x: rect.x * scaleX,
                    y: page.getHeight() - (rect.y + rect.height) * scaleY,
                    width: rect.width * scaleX,
                    height: rect.height * scaleY,
                    color,
                    opacity: 0.28,
                    borderWidth: 0
                });
            }
        }
        for (const comment of annotations.comments) {
            const page = pages[comment.page - 1];
            if (!page || !comment.rects.length || !comment.text.trim()) {
                continue;
            }
            addNativeCommentAnnotation(pdfDocument, page, comment);
        }
        const storedAnnotations = {
            ...annotations,
            comments: []
        };
        pdfDocument.catalog.set(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY), pdf_lib_1.PDFHexString.fromText(JSON.stringify(storedAnnotations)));
        const baseStream = pdfDocument.context.flateStream(basePdfBytes, {
            Type: 'EmbeddedFile'
        });
        const baseStreamRef = pdfDocument.context.register(baseStream);
        pdfDocument.catalog.set(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_BASE_KEY), baseStreamRef);
        const output = await pdfDocument.save();
        await fs.writeFile(pdfUri.fsPath, output);
        this.sessionAnnotations.set(cacheKey, structuredClone(annotations));
    }
    disposeSession(pdfUri) {
        const cacheKey = pdfUri.toString();
        this.sessionBasePdf.delete(cacheKey);
        this.sessionAnnotations.delete(cacheKey);
    }
    async loadSessionState(pdfUri) {
        const cacheKey = pdfUri.toString();
        const pdfBytes = new Uint8Array(await fs.readFile(pdfUri.fsPath));
        const pdfDocument = await pdf_lib_1.PDFDocument.load(pdfBytes);
        const embeddedBase = pdfDocument.catalog.lookup(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_BASE_KEY));
        const basePdfBytes = embeddedBase instanceof pdf_lib_1.PDFRawStream ? (0, pdf_lib_1.decodePDFRawStream)(embeddedBase).decode() : pdfBytes;
        this.sessionBasePdf.set(cacheKey, new Uint8Array(basePdfBytes));
        const rawAnnotationData = pdfDocument.catalog.lookup(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY));
        const annotationJson = rawAnnotationData instanceof pdf_lib_1.PDFHexString || rawAnnotationData instanceof pdf_lib_1.PDFString
            ? rawAnnotationData.decodeText()
            : null;
        const nativeComments = extractNativeComments(pdfDocument);
        if (!annotationJson) {
            this.sessionAnnotations.set(cacheKey, {
                ...(0, annotation_1.emptyAnnotationDocument)(),
                comments: nativeComments
            });
            return;
        }
        try {
            const parsed = JSON.parse(annotationJson);
            const sanitized = (0, annotationDocument_1.sanitizeAnnotationDocument)(parsed);
            this.sessionAnnotations.set(cacheKey, {
                ...sanitized,
                comments: mergeComments(sanitized.comments, nativeComments)
            });
        }
        catch {
            this.sessionAnnotations.set(cacheKey, {
                ...(0, annotation_1.emptyAnnotationDocument)(),
                comments: nativeComments
            });
        }
    }
}
exports.SaveManager = SaveManager;
function toSegments(points) {
    const segments = [];
    for (let index = 1; index < points.length; index += 1) {
        segments.push([points[index - 1], points[index]]);
    }
    return segments;
}
function toPdfPoint(point, scaleX, scaleY, pageHeight) {
    return {
        x: point.x * scaleX,
        y: pageHeight - point.y * scaleY
    };
}
function toRgb(hex) {
    const normalized = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return (0, pdf_lib_1.rgb)(0.976, 0.451, 0.086);
    }
    const value = Number.parseInt(normalized, 16);
    const red = ((value >> 16) & 0xff) / 255;
    const green = ((value >> 8) & 0xff) / 255;
    const blue = (value & 0xff) / 255;
    return (0, pdf_lib_1.rgb)(red, green, blue);
}
function addNativeCommentAnnotation(pdfDocument, page, comment) {
    const anchorRect = comment.rects[comment.rects.length - 1];
    const scaleX = page.getWidth() / Math.max(comment.viewportWidth, 1);
    const scaleY = page.getHeight() / Math.max(comment.viewportHeight, 1);
    const color = toRgb(comment.color);
    const iconSize = Math.max(14, Math.min(18, 14 * ((scaleX + scaleY) / 2)));
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const x = clamp((anchorRect.x + anchorRect.width) * scaleX + 4, 8, pageWidth - iconSize - 8);
    const yTop = clamp(pageHeight - anchorRect.y * scaleY + 2, iconSize + 8, pageHeight - 8);
    const rect = [x, yTop - iconSize, x + iconSize, yTop];
    const annotation = pdfDocument.context.obj({
        Type: pdf_lib_1.PDFName.of('Annot'),
        Subtype: pdf_lib_1.PDFName.of('Text'),
        Rect: pdfDocument.context.obj(rect),
        Contents: pdf_lib_1.PDFHexString.fromText(comment.text.trim()),
        Name: pdf_lib_1.PDFName.of('Comment'),
        NM: pdf_lib_1.PDFHexString.fromText(comment.id),
        T: pdf_lib_1.PDFHexString.fromText('PDF Studio'),
        M: pdf_lib_1.PDFString.of(toPdfDate(new Date())),
        C: pdfDocument.context.obj([color.red, color.green, color.blue]),
        Open: false,
        F: 4
    });
    annotation.set(PDF_STUDIO_COMMENT_KEY, pdf_lib_1.PDFHexString.fromText(JSON.stringify({
        id: comment.id,
        color: comment.color,
        viewportWidth: comment.viewportWidth,
        viewportHeight: comment.viewportHeight,
        rects: comment.rects
    })));
    const annotationRef = pdfDocument.context.register(annotation);
    page.node.addAnnot(annotationRef);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function toPdfDate(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
function extractNativeComments(pdfDocument) {
    const comments = [];
    pdfDocument.getPages().forEach((page, pageIndex) => {
        const annots = page.node.Annots();
        if (!annots) {
            return;
        }
        for (let index = 0; index < annots.size(); index += 1) {
            const annotation = annots.lookupMaybe(index, pdf_lib_1.PDFDict);
            if (!annotation) {
                continue;
            }
            const subtype = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName);
            if (subtype?.decodeText() !== 'Text') {
                continue;
            }
            const contents = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('Contents'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            if (!contents.trim()) {
                continue;
            }
            const rect = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Rect'), pdf_lib_1.PDFArray)?.asRectangle();
            if (!rect) {
                continue;
            }
            const nm = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('NM'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            const colorArray = annotation.lookupMaybe(pdf_lib_1.PDFName.of('C'), pdf_lib_1.PDFArray);
            const color = colorArray ? colorArrayToHex(colorArray) : '#f97316';
            const pageWidth = page.getWidth();
            const pageHeight = page.getHeight();
            const studioData = decodeStudioCommentPayload(annotation.lookupMaybe(PDF_STUDIO_COMMENT_KEY, pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            comments.push({
                id: studioData?.id || nm || `native-${pageIndex + 1}-${Math.round(rect.x)}-${Math.round(rect.y)}-${index}`,
                color: studioData?.color || color,
                page: pageIndex + 1,
                viewportWidth: studioData?.viewportWidth || pageWidth,
                viewportHeight: studioData?.viewportHeight || pageHeight,
                rects: studioData?.rects.length
                    ? studioData.rects
                    : [
                        {
                            x: rect.x,
                            y: pageHeight - rect.y - rect.height,
                            width: rect.width,
                            height: rect.height
                        }
                    ],
                text: contents.trim()
            });
        }
    });
    return comments;
}
function mergeComments(studioComments, nativeComments) {
    if (!nativeComments.length) {
        return studioComments;
    }
    const merged = new Map();
    for (const comment of studioComments) {
        merged.set(comment.id, comment);
    }
    for (const nativeComment of nativeComments) {
        const existing = merged.get(nativeComment.id);
        if (existing) {
            merged.set(nativeComment.id, {
                ...existing,
                text: nativeComment.text
            });
            continue;
        }
        merged.set(nativeComment.id, nativeComment);
    }
    return Array.from(merged.values());
}
function decodePdfText(value) {
    return value ? value.decodeText() : '';
}
function decodeStudioCommentPayload(value) {
    if (!value) {
        return null;
    }
    try {
        const parsed = JSON.parse(value.decodeText());
        if (!isObject(parsed)) {
            return null;
        }
        const rects = sanitizeRectsForCommentPayload(parsed.rects);
        if (!rects.length) {
            return null;
        }
        return {
            id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : crypto.randomUUID(),
            color: typeof parsed.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.color) ? parsed.color : '#f97316',
            viewportWidth: typeof parsed.viewportWidth === 'number' && Number.isFinite(parsed.viewportWidth) && parsed.viewportWidth > 0
                ? parsed.viewportWidth
                : 1,
            viewportHeight: typeof parsed.viewportHeight === 'number' &&
                Number.isFinite(parsed.viewportHeight) &&
                parsed.viewportHeight > 0
                ? parsed.viewportHeight
                : 1,
            rects
        };
    }
    catch {
        return null;
    }
}
function colorArrayToHex(colorArray) {
    const components = colorArray
        .asArray()
        .slice(0, 3)
        .map((component) => ('asNumber' in component && typeof component.asNumber === 'function' ? component.asNumber() : 0));
    const [red = 0.976, green = 0.451, blue = 0.086] = components.map((component) => Math.round(clamp(component, 0, 1) * 255));
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue
        .toString(16)
        .padStart(2, '0')}`;
}
function sanitizeRectsForCommentPayload(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((rect) => {
        if (!isObject(rect)) {
            return null;
        }
        const x = typeof rect.x === 'number' && Number.isFinite(rect.x) ? rect.x : null;
        const y = typeof rect.y === 'number' && Number.isFinite(rect.y) ? rect.y : null;
        const width = typeof rect.width === 'number' && Number.isFinite(rect.width) ? rect.width : null;
        const height = typeof rect.height === 'number' && Number.isFinite(rect.height) ? rect.height : null;
        if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
            return null;
        }
        return { x, y, width, height };
    })
        .filter((rect) => rect !== null);
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=saveManager.js.map