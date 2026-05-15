import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { PDFDocument, rgb } from 'pdf-lib';
import type {
  AnnotationDocument,
  AnnotationPoint
} from '../models/annotation';

export class SaveManager {
  private readonly sessionBasePdf = new Map<string, Uint8Array>();

  public async getPdfBytes(pdfUri: vscode.Uri): Promise<Uint8Array> {
    const pdfBytes = await fs.readFile(pdfUri.fsPath);
    if (!this.sessionBasePdf.has(pdfUri.toString())) {
      this.sessionBasePdf.set(pdfUri.toString(), new Uint8Array(pdfBytes));
    }
    return new Uint8Array(pdfBytes);
  }

  public async save(pdfUri: vscode.Uri, annotations: AnnotationDocument): Promise<void> {
    const cacheKey = pdfUri.toString();
    let basePdfBytes = this.sessionBasePdf.get(cacheKey);

    if (!basePdfBytes) {
      basePdfBytes = await this.getPdfBytes(pdfUri);
    }

    const pdfDocument = await PDFDocument.load(basePdfBytes);
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

    const output = await pdfDocument.save();
    await fs.writeFile(pdfUri.fsPath, output);
  }

  public disposeSession(pdfUri: vscode.Uri): void {
    this.sessionBasePdf.delete(pdfUri.toString());
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
