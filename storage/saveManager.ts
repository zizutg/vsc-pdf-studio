import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import {
  decodePDFRawStream,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  rgb
} from 'pdf-lib';
import type {
  AnnotationDocument,
  AnnotationPoint
} from '../models/annotation';

const ANNOTATION_DATA_KEY = 'PdfAnnotatorData';
const BASE_PDF_KEY = 'PdfAnnotatorBase';

export class SaveManager {
  private readonly sessionBasePdf = new Map<string, Uint8Array>();
  private readonly sessionAnnotations = new Map<string, AnnotationDocument>();

  public async getPdfBytes(pdfUri: vscode.Uri): Promise<Uint8Array> {
    const cacheKey = pdfUri.toString();
    if (!this.sessionBasePdf.has(cacheKey)) {
      await this.loadSessionState(pdfUri);
    }
    return new Uint8Array(this.sessionBasePdf.get(cacheKey) ?? new Uint8Array());
  }

  public async getAnnotations(pdfUri: vscode.Uri): Promise<AnnotationDocument> {
    const cacheKey = pdfUri.toString();
    if (!this.sessionAnnotations.has(cacheKey)) {
      await this.loadSessionState(pdfUri);
    }
    return structuredClone(this.sessionAnnotations.get(cacheKey) ?? emptyAnnotationDocument());
  }

  public async save(pdfUri: vscode.Uri, annotations: AnnotationDocument): Promise<void> {
    const cacheKey = pdfUri.toString();
    let basePdfBytes = this.sessionBasePdf.get(cacheKey);

    if (!basePdfBytes) {
      basePdfBytes = await this.getPdfBytes(pdfUri);
    }

    const pdfDocument = await PDFDocument.load(basePdfBytes);
    const pages = pdfDocument.getPages();
    const noteFont = await pdfDocument.embedFont(StandardFonts.Helvetica);

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
        color: rgb(1, 1, 1)
      });

      page.drawRectangle({
        x: calloutX,
        y: calloutY,
        width: calloutWidth,
        height: calloutHeight,
        color: rgb(1, 0.988, 0.855),
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
          color: rgb(0.18, 0.18, 0.2)
        });
      });
    }

    pdfDocument.catalog.set(
      PDFName.of(ANNOTATION_DATA_KEY),
      PDFHexString.fromText(JSON.stringify(annotations))
    );
    const baseStream = pdfDocument.context.flateStream(basePdfBytes, {
      Type: 'EmbeddedFile'
    });
    const baseStreamRef = pdfDocument.context.register(baseStream);
    pdfDocument.catalog.set(PDFName.of(BASE_PDF_KEY), baseStreamRef);

    const output = await pdfDocument.save();
    await fs.writeFile(pdfUri.fsPath, output);
    this.sessionAnnotations.set(cacheKey, structuredClone(annotations));
  }

  public disposeSession(pdfUri: vscode.Uri): void {
    const cacheKey = pdfUri.toString();
    this.sessionBasePdf.delete(cacheKey);
    this.sessionAnnotations.delete(cacheKey);
  }

  private async loadSessionState(pdfUri: vscode.Uri): Promise<void> {
    const cacheKey = pdfUri.toString();
    const pdfBytes = new Uint8Array(await fs.readFile(pdfUri.fsPath));
    const pdfDocument = await PDFDocument.load(pdfBytes);

    const embeddedBase = pdfDocument.catalog.lookup(PDFName.of(BASE_PDF_KEY));
    const basePdfBytes =
      embeddedBase instanceof PDFRawStream ? decodePDFRawStream(embeddedBase).decode() : pdfBytes;
    this.sessionBasePdf.set(cacheKey, new Uint8Array(basePdfBytes));

    const rawAnnotationData = pdfDocument.catalog.lookup(PDFName.of(ANNOTATION_DATA_KEY));
    const annotationJson =
      rawAnnotationData instanceof PDFHexString || rawAnnotationData instanceof PDFString
        ? rawAnnotationData.decodeText()
        : null;

    if (!annotationJson) {
      this.sessionAnnotations.set(cacheKey, emptyAnnotationDocument());
      return;
    }

    try {
      const parsed = JSON.parse(annotationJson) as AnnotationDocument;
      this.sessionAnnotations.set(cacheKey, normalizeAnnotationDocument(parsed));
    } catch {
      this.sessionAnnotations.set(cacheKey, emptyAnnotationDocument());
    }
  }
}

function toSegments(points: AnnotationPoint[]): Array<[AnnotationPoint, AnnotationPoint]> {
  const segments: Array<[AnnotationPoint, AnnotationPoint]> = [];

  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1], points[index]]);
  }

  return segments;
}

function toPdfPoint(
  point: AnnotationPoint,
  scaleX: number,
  scaleY: number,
  pageHeight: number
): { x: number; y: number } {
  return {
    x: point.x * scaleX,
    y: pageHeight - point.y * scaleY
  };
}

function toRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return rgb(0.976, 0.451, 0.086);
  }

  const value = Number.parseInt(normalized, 16);
  const red = ((value >> 16) & 0xff) / 255;
  const green = ((value >> 8) & 0xff) / 255;
  const blue = (value & 0xff) / 255;

  return rgb(red, green, blue);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
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

function emptyAnnotationDocument(): AnnotationDocument {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    strokes: [],
    highlights: [],
    comments: []
  };
}

function normalizeAnnotationDocument(value: Partial<AnnotationDocument>): AnnotationDocument {
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    strokes: Array.isArray(value.strokes) ? value.strokes : [],
    highlights: Array.isArray(value.highlights) ? value.highlights : [],
    comments: Array.isArray(value.comments) ? value.comments : []
  };
}
