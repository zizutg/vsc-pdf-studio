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
class SaveManager {
    sessionBasePdf = new Map();
    async getPdfBytes(pdfUri) {
        const pdfBytes = await fs.readFile(pdfUri.fsPath);
        if (!this.sessionBasePdf.has(pdfUri.toString())) {
            this.sessionBasePdf.set(pdfUri.toString(), new Uint8Array(pdfBytes));
        }
        return new Uint8Array(pdfBytes);
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
        const output = await pdfDocument.save();
        await fs.writeFile(pdfUri.fsPath, output);
    }
    disposeSession(pdfUri) {
        this.sessionBasePdf.delete(pdfUri.toString());
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
//# sourceMappingURL=saveManager.js.map