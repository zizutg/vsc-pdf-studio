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
        const noteFont = await pdfDocument.embedFont(pdf_lib_1.StandardFonts.Helvetica);
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
            const anchorRect = comment.rects[0];
            const scaleX = page.getWidth() / Math.max(comment.viewportWidth, 1);
            const scaleY = page.getHeight() / Math.max(comment.viewportHeight, 1);
            const markerSize = 14;
            const markerX = (anchorRect.x + anchorRect.width) * scaleX + 4;
            const markerY = page.getHeight() - anchorRect.y * scaleY - markerSize;
            const calloutWidth = Math.min(page.getWidth() * 0.42, 180);
            const fontSize = 9;
            const lineHeight = 11;
            const lines = wrapText(comment.text.trim(), 34).slice(0, 5);
            const calloutHeight = Math.max(28, 12 + lines.length * lineHeight);
            const calloutX = Math.min(Math.max(8, markerX + markerSize + 6), page.getWidth() - calloutWidth - 8);
            const calloutY = Math.max(8, Math.min(page.getHeight() - calloutHeight - 8, markerY - 6));
            page.drawRectangle({
                x: markerX,
                y: markerY,
                width: markerSize,
                height: markerSize,
                color: toRgb(comment.color),
                opacity: 0.9,
                borderWidth: 0
            });
            page.drawText('C', {
                x: markerX + 4,
                y: markerY + 3,
                size: 8,
                font: noteFont,
                color: (0, pdf_lib_1.rgb)(1, 1, 1)
            });
            page.drawRectangle({
                x: calloutX,
                y: calloutY,
                width: calloutWidth,
                height: calloutHeight,
                color: (0, pdf_lib_1.rgb)(1, 0.988, 0.855),
                opacity: 0.95,
                borderColor: toRgb(comment.color),
                borderWidth: 1
            });
            lines.forEach((line, index) => {
                page.drawText(line, {
                    x: calloutX + 8,
                    y: calloutY + calloutHeight - 14 - index * lineHeight,
                    size: fontSize,
                    font: noteFont,
                    color: (0, pdf_lib_1.rgb)(0.18, 0.18, 0.2)
                });
            });
        }
        pdfDocument.catalog.set(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY), pdf_lib_1.PDFHexString.fromText(JSON.stringify(annotations)));
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
        if (!annotationJson) {
            this.sessionAnnotations.set(cacheKey, (0, annotation_1.emptyAnnotationDocument)());
            return;
        }
        try {
            const parsed = JSON.parse(annotationJson);
            this.sessionAnnotations.set(cacheKey, (0, annotationDocument_1.sanitizeAnnotationDocument)(parsed));
        }
        catch {
            this.sessionAnnotations.set(cacheKey, (0, annotation_1.emptyAnnotationDocument)());
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
function wrapText(text, maxChars) {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= maxChars) {
            currentLine = candidate;
            continue;
        }
        if (currentLine) {
            lines.push(currentLine);
        }
        currentLine = word;
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines.length ? lines : [''];
}
//# sourceMappingURL=saveManager.js.map