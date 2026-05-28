import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as vscode from 'vscode';
import {
  decodePDFRawStream,
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFString,
  PDFTextField,
  rgb
} from 'pdf-lib';
import {
  emptyAnnotationDocument,
  type AnnotationComment,
  type AnnotationDocument,
  type AnnotationHighlight,
  type AnnotationPoint,
  type AnnotationRect
} from '../models/annotation';
import {
  type PdfButtonAction,
  type PdfButtonFormField,
  emptyFormFields,
  type PdfCheckboxFormField,
  type PdfDropdownFormField,
  type PdfFormField,
  type PdfFormFieldWidget,
  type PdfOptionListFormField,
  type PdfRadioFormField,
  type PdfTextFieldSemantic,
  type PdfTextFormField
} from '../models/formField';
import { PDF_STUDIO_BASE_KEY, PDF_STUDIO_DATA_KEY } from '../src/constants';
import { sanitizeAnnotationDocument } from '../src/validation/annotationDocument';

const PDF_STUDIO_COMMENT_KEY = PDFName.of('PDFStudioComment');

interface SessionFileFingerprint {
  size: number;
  mtimeMs: number;
}

export class SaveManager {
  private readonly sessionBasePdf = new Map<string, Uint8Array>();
  private readonly sessionAnnotations = new Map<string, AnnotationDocument>();
  private readonly sessionFormFields = new Map<string, PdfFormField[]>();
  private readonly sessionResetFormFields = new Map<string, PdfFormField[]>();
  private readonly sessionFingerprints = new Map<string, SessionFileFingerprint>();

  public async getPdfBytes(pdfUri: vscode.Uri): Promise<Uint8Array> {
    await this.ensureSessionStateFresh(pdfUri);
    const cacheKey = pdfUri.toString();
    return new Uint8Array(this.sessionBasePdf.get(cacheKey) ?? new Uint8Array());
  }

  public async getLivePdfBytes(pdfUri: vscode.Uri): Promise<Uint8Array> {
    await this.ensureSessionStateFresh(pdfUri);
    return new Uint8Array(await fs.readFile(pdfUri.fsPath));
  }

  public async getAnnotations(pdfUri: vscode.Uri): Promise<AnnotationDocument> {
    await this.ensureSessionStateFresh(pdfUri);
    const cacheKey = pdfUri.toString();
    return structuredClone(this.sessionAnnotations.get(cacheKey) ?? emptyAnnotationDocument());
  }

  public async getFormFields(pdfUri: vscode.Uri): Promise<PdfFormField[]> {
    await this.ensureSessionStateFresh(pdfUri);
    const cacheKey = pdfUri.toString();
    return structuredClone(this.sessionFormFields.get(cacheKey) ?? emptyFormFields());
  }

  public async getResetFormFields(pdfUri: vscode.Uri): Promise<PdfFormField[]> {
    await this.ensureSessionStateFresh(pdfUri);
    const cacheKey = pdfUri.toString();
    return structuredClone(this.sessionResetFormFields.get(cacheKey) ?? emptyFormFields());
  }

  public async getButtonAction(pdfUri: vscode.Uri, name: string): Promise<PdfButtonAction | null> {
    const formFields = await this.getFormFields(pdfUri);
    const field = formFields.find(
      (candidate): candidate is PdfButtonFormField => candidate.type === 'button' && candidate.name === name
    );
    return field?.action ? structuredClone(field.action) : null;
  }

  public async submitForm(formFields: PdfFormField[], action: PdfButtonAction): Promise<void> {
    if (action.type !== 'submit' || !action.url) {
      throw new Error('This PDF button does not expose a supported submit target.');
    }

    const fieldData = buildSubmitFormPayload(formFields);
    const targetUrl = new URL(action.url);
    const method = action.method ?? 'POST';

    if (method === 'GET') {
      for (const [key, value] of fieldData) {
        targetUrl.searchParams.append(key, value);
      }
      await executeHttpRequest(targetUrl, 'GET');
      return;
    }

    await executeHttpRequest(targetUrl, 'POST', new URLSearchParams(fieldData).toString());
  }

  public async saveDocument(
    pdfUri: vscode.Uri,
    annotations: AnnotationDocument,
    formFields: PdfFormField[]
  ): Promise<void> {
    const cacheKey = pdfUri.toString();
    let basePdfBytes = this.sessionBasePdf.get(cacheKey);
    const previousAnnotations = this.sessionAnnotations.get(cacheKey) ?? emptyAnnotationDocument();

    if (!basePdfBytes) {
      basePdfBytes = await this.getPdfBytes(pdfUri);
    }

    const pdfDocument = await PDFDocument.load(basePdfBytes);
    applyFormFieldValues(pdfDocument, formFields);
    const pages = pdfDocument.getPages();
    removeNativeMarkupAnnotations(
      pdfDocument,
      new Set([
        ...previousAnnotations.highlights.map((highlight) => highlight.id),
        ...annotations.highlights.map((highlight) => highlight.id)
      ])
    );

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

      if (highlight.attachedNote?.text.trim()) {
        removeNativeMarkupAnnotation(page, highlight.id, highlight.kind);
        addNativeMarkupAnnotation(pdfDocument, page, highlight);
        continue;
      }

      const scaleX = page.getWidth() / Math.max(highlight.viewportWidth, 1);
      const scaleY = page.getHeight() / Math.max(highlight.viewportHeight, 1);
      const color = toRgb(highlight.color);

      for (const rect of highlight.rects) {
        if (highlight.kind === 'underline') {
          const renderedHeight = rect.height * scaleY;
          const thickness = Math.max(1, Math.min(renderedHeight * 0.16, 3));
          page.drawRectangle({
            x: rect.x * scaleX,
            y: page.getHeight() - (rect.y + rect.height) * scaleY,
            width: rect.width * scaleX,
            height: thickness,
            color,
            opacity: 1,
            borderWidth: 0
          });
          continue;
        }
        if (highlight.kind === 'strikeout') {
          const renderedHeight = rect.height * scaleY;
          const thickness = Math.max(1, Math.min(renderedHeight * 0.16, 3));
          page.drawRectangle({
            x: rect.x * scaleX,
            y: page.getHeight() - (rect.y + rect.height * 0.5) * scaleY - thickness * 0.5,
            width: rect.width * scaleX,
            height: thickness,
            color,
            opacity: 1,
            borderWidth: 0
          });
          continue;
        }

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

    const storedAnnotations: AnnotationDocument = {
      ...annotations,
      comments: []
    };
    pdfDocument.catalog.set(PDFName.of(PDF_STUDIO_DATA_KEY), PDFHexString.fromText(JSON.stringify(storedAnnotations)));
    const baseStream = pdfDocument.context.flateStream(basePdfBytes, {
      Type: 'EmbeddedFile'
    });
    const baseStreamRef = pdfDocument.context.register(baseStream);
    pdfDocument.catalog.set(PDFName.of(PDF_STUDIO_BASE_KEY), baseStreamRef);

    const output = await pdfDocument.save();
    await fs.writeFile(pdfUri.fsPath, output);
    this.sessionAnnotations.set(cacheKey, structuredClone(annotations));
    this.sessionFormFields.set(cacheKey, structuredClone(formFields));
    this.sessionFingerprints.set(cacheKey, await getFileFingerprint(pdfUri.fsPath));
  }

  public disposeSession(pdfUri: vscode.Uri): void {
    const cacheKey = pdfUri.toString();
    this.sessionBasePdf.delete(cacheKey);
    this.sessionAnnotations.delete(cacheKey);
    this.sessionFormFields.delete(cacheKey);
    this.sessionResetFormFields.delete(cacheKey);
    this.sessionFingerprints.delete(cacheKey);
  }

  private async loadSessionState(pdfUri: vscode.Uri): Promise<void> {
    const cacheKey = pdfUri.toString();
    const pdfBytes = new Uint8Array(await fs.readFile(pdfUri.fsPath));
    const pdfDocument = await PDFDocument.load(pdfBytes);

    const nativeComments = extractNativeComments(pdfDocument);
    const nativeHighlights = extractNativeHighlights(pdfDocument);
    const formFields = extractFormFields(pdfDocument);
    this.sessionFormFields.set(cacheKey, formFields);
    this.sessionResetFormFields.set(cacheKey, extractResetFormFields(pdfDocument, formFields));

    const rawAnnotationData = pdfDocument.catalog.lookup(PDFName.of(PDF_STUDIO_DATA_KEY));
    const annotationJson =
      rawAnnotationData instanceof PDFHexString || rawAnnotationData instanceof PDFString
        ? rawAnnotationData.decodeText()
        : null;
    const sanitizedAnnotations = parseStoredAnnotations(annotationJson);

    const embeddedBase = pdfDocument.catalog.lookup(PDFName.of(PDF_STUDIO_BASE_KEY));
    const basePdfBytes = await resolveSessionBasePdfBytes(
      pdfBytes,
      pdfDocument,
      formFields,
      embeddedBase,
      sanitizedAnnotations
    );
    this.sessionBasePdf.set(cacheKey, new Uint8Array(basePdfBytes));

    if (!annotationJson) {
      this.sessionAnnotations.set(cacheKey, {
        ...emptyAnnotationDocument(),
        highlights: nativeHighlights,
        comments: nativeComments
      });
      this.sessionFingerprints.set(cacheKey, await getFileFingerprint(pdfUri.fsPath));
      return;
    }

    this.sessionAnnotations.set(cacheKey, {
      ...sanitizedAnnotations,
      highlights: mergeHighlights(sanitizedAnnotations.highlights, nativeHighlights),
      comments: mergeComments(sanitizedAnnotations.comments, nativeComments)
    });

    this.sessionFingerprints.set(cacheKey, await getFileFingerprint(pdfUri.fsPath));
  }

  private async ensureSessionStateFresh(pdfUri: vscode.Uri): Promise<void> {
    const cacheKey = pdfUri.toString();
    const cachedFingerprint = this.sessionFingerprints.get(cacheKey);
    const hasSession =
      this.sessionBasePdf.has(cacheKey) &&
      this.sessionAnnotations.has(cacheKey) &&
      this.sessionFormFields.has(cacheKey) &&
      this.sessionResetFormFields.has(cacheKey) &&
      Boolean(cachedFingerprint);

    if (!hasSession) {
      await this.loadSessionState(pdfUri);
      return;
    }

    const currentFingerprint = await getFileFingerprint(pdfUri.fsPath);
    if (
      currentFingerprint.size !== cachedFingerprint!.size ||
      currentFingerprint.mtimeMs !== cachedFingerprint!.mtimeMs
    ) {
      await this.loadSessionState(pdfUri);
    }
  }
}

async function getFileFingerprint(fsPath: string): Promise<SessionFileFingerprint> {
  const stats = await fs.stat(fsPath);
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

function parseStoredAnnotations(annotationJson: string | null): AnnotationDocument {
  if (!annotationJson) {
    return emptyAnnotationDocument();
  }

  try {
    return sanitizeAnnotationDocument(JSON.parse(annotationJson) as unknown);
  } catch {
    return emptyAnnotationDocument();
  }
}

function hasRenderableStudioMarkup(annotations: AnnotationDocument): boolean {
  return (
    annotations.strokes.length > 0 ||
    annotations.highlights.length > 0 ||
    annotations.comments.length > 0
  );
}

async function resolveSessionBasePdfBytes(
  livePdfBytes: Uint8Array,
  livePdfDocument: PDFDocument,
  liveFormFields: PdfFormField[],
  embeddedBase: unknown,
  annotations: AnnotationDocument
): Promise<Uint8Array> {
  if (!(embeddedBase instanceof PDFRawStream)) {
    return livePdfBytes;
  }

  const embeddedBaseBytes = decodePDFRawStream(embeddedBase).decode();
  if (!liveFormFields.length) {
    return embeddedBaseBytes;
  }

  try {
    const basePdfDocument = await PDFDocument.load(embeddedBaseBytes);
    const livePageCount = livePdfDocument.getPageCount();
    const basePageCount = basePdfDocument.getPageCount();
    const pagesWithStudioMarkup = collectPagesWithStudioMarkup(annotations);

    if (livePageCount > basePageCount) {
      return materializeExternalPageAdditionsOnBase(embeddedBaseBytes, livePdfBytes, basePageCount, livePageCount);
    }

    const replacementPageIndexes = collectReplaceableChangedPageIndexes(
      basePdfDocument,
      livePdfDocument,
      pagesWithStudioMarkup
    );

    const baseFormFields = extractFormFields(basePdfDocument);
    const baseFieldNames = new Set(baseFormFields.map((field) => field.name));
    const missingFormFields = liveFormFields.filter((field) => !baseFieldNames.has(field.name));

    const missingButtonFields = missingFormFields.filter(
      (field): field is PdfButtonFormField => field.type === 'button'
    );
    const missingNonButtonFields = missingFormFields.filter((field) => field.type !== 'button');
    const buttonPageIndexes = collectReplaceableFormFieldPageIndexes(missingButtonFields, pagesWithStudioMarkup);

    for (const pageIndex of buttonPageIndexes) {
      if (!replacementPageIndexes.includes(pageIndex)) {
        replacementPageIndexes.push(pageIndex);
      }
    }

    let resolvedBaseBytes = embeddedBaseBytes;

    if (replacementPageIndexes.length) {
      replacementPageIndexes.sort((left, right) => left - right);
      resolvedBaseBytes = await materializeChangedPagesOnBase(embeddedBaseBytes, livePdfBytes, replacementPageIndexes);
    }

    if (missingNonButtonFields.length) {
      return materializeFormFieldsOnBase(resolvedBaseBytes, missingNonButtonFields);
    }

    if (replacementPageIndexes.length) {
      return resolvedBaseBytes;
    }
  } catch {
    return livePdfBytes;
  }

  return embeddedBaseBytes;
}

function countNativeFormFields(pdfDocument: PDFDocument): number {
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    return 0;
  }

  return form.getFields().length;
}

async function materializeFormFieldsOnBase(
  basePdfBytes: Uint8Array,
  liveFormFields: PdfFormField[]
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(basePdfBytes);
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    form.deleteXFA();
  }

  const existingNames = new Set(form.getFields().map((field) => field.getName()));

  for (const fieldState of liveFormFields) {
    if (existingNames.has(fieldState.name)) {
      continue;
    }

    if (fieldState.type === 'text') {
      const field = form.createTextField(fieldState.name);
      if (fieldState.multiline) {
        field.enableMultiline();
      }
      if (fieldState.maxLength) {
        field.setMaxLength(fieldState.maxLength);
      }
      setReadOnly(field, fieldState.readOnly);
      for (const widget of fieldState.widgets) {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          continue;
        }
        field.addToPage(page, buildFieldAppearanceOptions(page, widget));
      }
      field.setText(fieldState.value || '');
      continue;
    }

    if (fieldState.type === 'checkbox') {
      const field = form.createCheckBox(fieldState.name);
      setReadOnly(field, fieldState.readOnly);
      for (const widget of fieldState.widgets) {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          continue;
        }
        field.addToPage(page, buildFieldAppearanceOptions(page, widget));
      }
      if (fieldState.checked) {
        field.check();
      } else {
        field.uncheck();
      }
      continue;
    }

    if (fieldState.type === 'radio') {
      const field = form.createRadioGroup(fieldState.name);
      setReadOnly(field, fieldState.readOnly);
      fieldState.widgets.forEach((widget, index) => {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          return;
        }
        const option = widget.option ?? fieldState.options[index] ?? `Option ${index + 1}`;
        field.addOptionToPage(option, page, buildFieldAppearanceOptions(page, widget));
      });
      if (fieldState.value) {
        field.select(fieldState.value);
      }
      continue;
    }

    if (fieldState.type === 'dropdown') {
      const field = form.createDropdown(fieldState.name);
      field.setOptions(fieldState.options);
      if (fieldState.editable) {
        field.enableEditing();
      }
      if (fieldState.multiSelect) {
        field.enableMultiselect();
      }
      setReadOnly(field, fieldState.readOnly);
      for (const widget of fieldState.widgets) {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          continue;
        }
        field.addToPage(page, buildFieldAppearanceOptions(page, widget));
      }
      if (fieldState.value.length) {
        field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
      }
      continue;
    }

    if (fieldState.type === 'optionList') {
      const field = form.createOptionList(fieldState.name);
      field.setOptions(fieldState.options);
      if (fieldState.multiSelect) {
        field.enableMultiselect();
      }
      setReadOnly(field, fieldState.readOnly);
      for (const widget of fieldState.widgets) {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          continue;
        }
        field.addToPage(page, buildFieldAppearanceOptions(page, widget));
      }
      if (fieldState.value.length) {
        field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
      }
      continue;
    }

    if (fieldState.type === 'button') {
      const field = form.createButton(fieldState.name);
      setReadOnly(field, fieldState.readOnly);
      for (const widget of fieldState.widgets) {
        const page = pdfDocument.getPage(widget.page - 1);
        if (!page) {
          continue;
        }
        field.addToPage(fieldState.label, page, buildFieldAppearanceOptions(page, widget));
      }
      applyButtonActionToField(pdfDocument, field, fieldState.action);
      continue;
    }
  }

  form.updateFieldAppearances();
  return pdfDocument.save();
}

async function materializeExternalPageAdditionsOnBase(
  basePdfBytes: Uint8Array,
  livePdfBytes: Uint8Array,
  basePageCount: number,
  livePageCount: number
): Promise<Uint8Array> {
  const basePdfDocument = await PDFDocument.load(basePdfBytes);
  const livePdfDocument = await PDFDocument.load(livePdfBytes);

  const pageIndexes = [];
  for (let index = basePageCount; index < livePageCount; index += 1) {
    pageIndexes.push(index);
  }

  if (!pageIndexes.length) {
    return basePdfBytes;
  }

  const copiedPages = await basePdfDocument.copyPages(livePdfDocument, pageIndexes);
  for (const page of copiedPages) {
    basePdfDocument.addPage(page);
  }

  return basePdfDocument.save();
}

async function materializeChangedPagesOnBase(
  basePdfBytes: Uint8Array,
  livePdfBytes: Uint8Array,
  pageIndexes: number[]
): Promise<Uint8Array> {
  const basePdfDocument = await PDFDocument.load(basePdfBytes);
  const livePdfDocument = await PDFDocument.load(livePdfBytes);
  const copiedPages = await basePdfDocument.copyPages(livePdfDocument, pageIndexes);

  for (let index = copiedPages.length - 1; index >= 0; index -= 1) {
    const pageIndex = pageIndexes[index];
    basePdfDocument.removePage(pageIndex);
    basePdfDocument.insertPage(pageIndex, copiedPages[index]);
  }

  return basePdfDocument.save();
}

function collectReplaceableChangedPageIndexes(
  basePdfDocument: PDFDocument,
  livePdfDocument: PDFDocument,
  pagesWithStudioMarkup: Set<number>
): number[] {
  const changedPages: number[] = [];
  const pageCount = Math.min(basePdfDocument.getPageCount(), livePdfDocument.getPageCount());

  for (let index = 0; index < pageCount; index += 1) {
    if (pagesWithStudioMarkup.has(index + 1)) {
      continue;
    }

    const basePage = basePdfDocument.getPage(index);
    const livePage = livePdfDocument.getPage(index);
    if (buildPageSignature(basePage) !== buildPageSignature(livePage)) {
      changedPages.push(index);
    }
  }

  return changedPages;
}

function collectPagesWithStudioMarkup(annotations: AnnotationDocument): Set<number> {
  const pages = new Set<number>();

  for (const stroke of annotations.strokes) {
    pages.add(stroke.page);
  }

  for (const highlight of annotations.highlights) {
    pages.add(highlight.page);
  }

  for (const comment of annotations.comments) {
    pages.add(comment.page);
  }

  return pages;
}

function collectReplaceableFormFieldPageIndexes(
  formFields: PdfFormField[],
  pagesWithStudioMarkup: Set<number>
): number[] {
  const pageIndexes = new Set<number>();

  for (const field of formFields) {
    for (const widget of field.widgets) {
      if (!pagesWithStudioMarkup.has(widget.page)) {
        pageIndexes.add(widget.page - 1);
      }
    }
  }

  return Array.from(pageIndexes);
}

function buildPageSignature(page: PDFDocument['getPages'] extends () => Array<infer T> ? T : never): string {
  const contents = page.node.Contents();
  const annots = page.node.Annots();
  const mediaBox = page.node.MediaBox();
  const rotate = page.node.Rotate();

  return [
    contents ? contents.toString() : 'no-contents',
    annots ? annots.toString() : 'no-annots',
    mediaBox ? mediaBox.toString() : 'no-mediabox',
    rotate ? rotate.toString() : 'no-rotate'
  ].join('|');
}

function buildFieldAppearanceOptions(
  page: PDFDocument['getPages'] extends () => Array<infer T> ? T : never,
  widget: PdfFormFieldWidget
) {
  return {
    x: widget.x,
    y: page.getHeight() - widget.y - widget.height,
    width: widget.width,
    height: widget.height,
    borderColor: rgb(0.45, 0.45, 0.45),
    backgroundColor: rgb(1, 1, 1),
    textColor: rgb(0.1, 0.1, 0.1)
  };
}

function setReadOnly(field: unknown, readOnly: boolean): void {
  const maybeField = field as {
    enableReadOnly?: () => void;
    disableReadOnly?: () => void;
  };

  if (readOnly) {
    maybeField.enableReadOnly?.();
  } else {
    maybeField.disableReadOnly?.();
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

function applyFormFieldValues(pdfDocument: PDFDocument, formFields: PdfFormField[]): void {
  if (!formFields.length) {
    return;
  }

  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    form.deleteXFA();
  }

  for (const fieldState of formFields) {
    const field = form.getFieldMaybe(fieldState.name);
    if (!field) {
      continue;
    }

    switch (fieldState.type) {
      case 'text':
        if (field instanceof PDFTextField) {
          field.setText(fieldState.value || undefined);
        }
        break;
      case 'checkbox':
        if (field instanceof PDFCheckBox) {
          if (fieldState.checked) {
            field.check();
          } else {
            field.uncheck();
          }
        }
        break;
      case 'radio':
        if (field instanceof PDFRadioGroup) {
          if (fieldState.value) {
            field.select(fieldState.value);
          } else {
            field.clear();
          }
        }
        break;
      case 'dropdown':
        if (field instanceof PDFDropdown) {
          if (fieldState.value.length) {
            field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
          } else {
            field.clear();
          }
        }
        break;
      case 'optionList':
        if (field instanceof PDFOptionList) {
          if (fieldState.value.length) {
            field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
          } else {
            field.clear();
          }
        }
        break;
      default:
        break;
    }
  }

  form.updateFieldAppearances();
}

function extractResetFormFields(pdfDocument: PDFDocument, currentFormFields: PdfFormField[]): PdfFormField[] {
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    return structuredClone(currentFormFields);
  }

  return currentFormFields.map((fieldState) => {
    const field = form.getFieldMaybe(fieldState.name);
    if (!field) {
      return fieldState;
    }

    switch (fieldState.type) {
      case 'text':
        return {
          ...fieldState,
          value: decodeDefaultTextValue(field.acroField.dict.lookup(PDFName.of('DV')))
        };
      case 'checkbox':
        return {
          ...fieldState,
          checked: decodeDefaultCheckboxValue(field.acroField.dict.lookup(PDFName.of('DV')))
        };
      case 'radio':
        return {
          ...fieldState,
          value: decodeDefaultChoiceValue(field.acroField.dict.lookup(PDFName.of('DV')))
        };
      case 'dropdown':
      case 'optionList':
        return {
          ...fieldState,
          value: decodeDefaultChoiceValues(field.acroField.dict.lookup(PDFName.of('DV')))
        };
      default:
        return fieldState;
    }
  });
}

function decodeDefaultTextValue(value: unknown): string {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }

  return '';
}

function decodeDefaultCheckboxValue(value: unknown): boolean {
  if (value instanceof PDFName) {
    return value.decodeText() !== 'Off';
  }

  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText() !== 'Off';
  }

  return false;
}

function decodeDefaultChoiceValue(value: unknown): string | null {
  if (value instanceof PDFName) {
    const decoded = value.decodeText();
    return decoded.length ? decoded : null;
  }

  if (value instanceof PDFString || value instanceof PDFHexString) {
    const decoded = value.decodeText();
    return decoded.length ? decoded : null;
  }

  return null;
}

function decodeDefaultChoiceValues(value: unknown): string[] {
  if (value instanceof PDFArray) {
    const values: string[] = [];
    for (let index = 0; index < value.size(); index += 1) {
      const entry = value.lookup(index);
      const decoded = decodeDefaultChoiceValue(entry);
      if (decoded) {
        values.push(decoded);
      }
    }
    return values;
  }

  const single = decodeDefaultChoiceValue(value);
  return single ? [single] : [];
}

function buildSubmitFormPayload(formFields: PdfFormField[]): Array<[string, string]> {
  const payload: Array<[string, string]> = [];

  for (const field of formFields) {
    switch (field.type) {
      case 'text':
        payload.push([field.name, field.value]);
        break;
      case 'checkbox':
        if (field.checked) {
          payload.push([field.name, 'true']);
        }
        break;
      case 'radio':
        if (field.value) {
          payload.push([field.name, field.value]);
        }
        break;
      case 'dropdown':
      case 'optionList':
        for (const value of field.value) {
          payload.push([field.name, value]);
        }
        break;
      default:
        break;
    }
  }

  return payload;
}

function applyButtonActionToField(
  pdfDocument: PDFDocument,
  field: PDFButton,
  action: PdfButtonAction | null
): void {
  if (!action) {
    return;
  }

  const widgets = field.acroField.getWidgets();
  const widget = widgets[0];
  if (!widget) {
    return;
  }

  const actionDict = createButtonActionDict(pdfDocument, action);
  if (!actionDict) {
    return;
  }

  widget.dict.set(PDFName.of('A'), actionDict);
}

function createButtonActionDict(pdfDocument: PDFDocument, action: PdfButtonAction): PDFDict | null {
  switch (action.type) {
    case 'reset':
      return pdfDocument.context.obj({
        S: PDFName.of('ResetForm')
      });
    case 'submit':
      if (!action.url) {
        return null;
      }
      return pdfDocument.context.obj({
        S: PDFName.of('SubmitForm'),
        F: PDFString.of(action.url),
        Flags: PDFNumber.of(action.method === 'GET' ? 8 : 0)
      });
    case 'mailto':
    case 'uri':
      if (!action.url) {
        return null;
      }
      return pdfDocument.context.obj({
        S: PDFName.of('URI'),
        URI: PDFString.of(action.url)
      });
    case 'unsupported':
    default:
      return null;
  }
}

async function executeHttpRequest(targetUrl: URL, method: 'GET' | 'POST', body?: string): Promise<void> {
  const transport = targetUrl.protocol === 'https:' ? https : http;

  await new Promise<void>((resolve, reject) => {
    const request = transport.request(
      targetUrl,
      {
        method,
        headers:
          method === 'POST'
            ? {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body || '').toString()
              }
            : undefined
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        response.resume();
        response.on('end', () => {
          if (statusCode >= 200 && statusCode < 400) {
            resolve();
            return;
          }

          reject(new Error(`SubmitForm request failed with status ${statusCode}.`));
        });
      }
    );

    request.on('error', reject);
    if (method === 'POST' && body) {
      request.write(body);
    }
    request.end();
  });
}

function addNativeCommentAnnotation(
  pdfDocument: PDFDocument,
  page: PDFDocument['getPages'] extends () => Array<infer T> ? T : never,
  comment: AnnotationComment
): void {
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
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: pdfDocument.context.obj(rect),
    Contents: PDFHexString.fromText(comment.text.trim()),
    Name: PDFName.of('Comment'),
    NM: PDFHexString.fromText(comment.id),
    T: PDFHexString.fromText((comment.author || 'PDF Studio').trim()),
    M: PDFString.of(toPdfDate(comment.modifiedAt ? new Date(comment.modifiedAt) : new Date())),
    C: pdfDocument.context.obj([color.red, color.green, color.blue]),
    Open: false,
    F: 4
  });
  annotation.set(
    PDF_STUDIO_COMMENT_KEY,
    PDFHexString.fromText(
      JSON.stringify({
        id: comment.id,
        author: comment.author,
        modifiedAt: comment.modifiedAt,
        color: comment.color,
        viewportWidth: comment.viewportWidth,
        viewportHeight: comment.viewportHeight,
        rects: comment.rects
      })
    )
  );

  const annotationRef = pdfDocument.context.register(annotation);
  page.node.addAnnot(annotationRef);
}

function addNativeMarkupAnnotation(
  pdfDocument: PDFDocument,
  page: PDFDocument['getPages'] extends () => Array<infer T> ? T : never,
  highlight: AnnotationHighlight
): void {
  const attachedNote = highlight.attachedNote;
  if (!attachedNote?.text.trim() || !highlight.rects.length) {
    return;
  }

  const scaleX = page.getWidth() / Math.max(highlight.viewportWidth, 1);
  const scaleY = page.getHeight() / Math.max(highlight.viewportHeight, 1);
  const color = toRgb(highlight.color);
  const quadPoints: number[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of highlight.rects) {
    const left = rect.x * scaleX;
    const right = (rect.x + rect.width) * scaleX;
    const top = page.getHeight() - rect.y * scaleY;
    const bottom = page.getHeight() - (rect.y + rect.height) * scaleY;
    quadPoints.push(left, top, right, top, left, bottom, right, bottom);
    minX = Math.min(minX, left);
    minY = Math.min(minY, bottom);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, top);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return;
  }

  const subtype =
    highlight.kind === 'underline' ? 'Underline' : highlight.kind === 'strikeout' ? 'StrikeOut' : 'Highlight';
  const annotation = pdfDocument.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(subtype),
    Rect: pdfDocument.context.obj([minX, minY, maxX, maxY]),
    QuadPoints: pdfDocument.context.obj(quadPoints),
    Contents: PDFHexString.fromText(attachedNote.text.trim()),
    NM: PDFHexString.fromText(highlight.id),
    T: PDFHexString.fromText((attachedNote.author || 'PDF Studio').trim()),
    M: PDFString.of(toPdfDate(attachedNote.modifiedAt ? new Date(attachedNote.modifiedAt) : new Date())),
    C: pdfDocument.context.obj([color.red, color.green, color.blue]),
    F: 4
  });

  if (attachedNote.subject?.trim()) {
    annotation.set(PDFName.of('Subj'), PDFHexString.fromText(attachedNote.subject.trim()));
  }

  const annotationRef = pdfDocument.context.register(annotation);
  page.node.addAnnot(annotationRef);
}

function removeNativeMarkupAnnotation(
  page: PDFDocument['getPages'] extends () => Array<infer T> ? T : never,
  annotationId: string,
  kind?: AnnotationHighlight['kind']
): void {
  const annots = page.node.Annots();
  if (!annots) {
    return;
  }

  const targetSubtype = kind === 'underline' ? 'Underline' : kind === 'strikeout' ? 'StrikeOut' : 'Highlight';
  for (let index = annots.size() - 1; index >= 0; index -= 1) {
    const annotation = annots.lookupMaybe(index, PDFDict);
    if (!annotation) {
      continue;
    }

    const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
    if (subtype !== targetSubtype) {
      continue;
    }

    const nm = decodePdfText(annotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
    if (nm === annotationId) {
      annots.remove(index);
    }
  }
}

function removeNativeMarkupAnnotations(pdfDocument: PDFDocument, annotationIds: Set<string>): void {
  if (!annotationIds.size) {
    return;
  }

  for (const page of pdfDocument.getPages()) {
    const annots = page.node.Annots();
    if (!annots) {
      continue;
    }

    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const annotation = annots.lookupMaybe(index, PDFDict);
      if (!annotation) {
        continue;
      }

      const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
      if (subtype !== 'Highlight' && subtype !== 'Underline' && subtype !== 'StrikeOut') {
        continue;
      }

      const nm = decodePdfText(annotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
      if (nm && annotationIds.has(nm)) {
        annots.remove(index);
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours()
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function extractNativeComments(pdfDocument: PDFDocument): AnnotationComment[] {
  const comments: AnnotationComment[] = [];
  const seenCommentKeys = new Set<string>();

  pdfDocument.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) {
      return;
    }

    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = annots.lookupMaybe(index, PDFDict);
      if (!annotation) {
        continue;
      }

      const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
      let sourceAnnotation = annotation;

      if (subtype === 'Popup') {
        const parent = annotation.lookupMaybe(PDFName.of('Parent'), PDFDict);
        const parentSubtype = parent?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
        if (
          !parent ||
          (parentSubtype !== 'Text' && parentSubtype !== 'FreeText')
        ) {
          continue;
        }
        sourceAnnotation = parent;
      } else if (subtype !== 'Text' && subtype !== 'FreeText') {
        continue;
      }

      const contents = decodeNativeCommentText(sourceAnnotation);
      if (!contents.trim()) {
        continue;
      }

      const rect =
        sourceAnnotation.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asRectangle() ??
        annotation.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asRectangle();
      if (!rect) {
        continue;
      }

      const nm = decodePdfText(sourceAnnotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
      const author = decodePdfText(sourceAnnotation.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString)).trim();
      const modifiedAt = decodePdfDate(sourceAnnotation.lookupMaybe(PDFName.of('M'), PDFString, PDFHexString));
      const colorArray =
        sourceAnnotation.lookupMaybe(PDFName.of('C'), PDFArray) ?? annotation.lookupMaybe(PDFName.of('C'), PDFArray);
      const color = colorArray ? colorArrayToHex(colorArray) : '#f97316';
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const studioData = decodeStudioCommentPayload(
        sourceAnnotation.lookupMaybe(PDF_STUDIO_COMMENT_KEY, PDFString, PDFHexString)
      );
      const commentId =
        studioData?.id ||
        nm ||
        `native-${pageIndex + 1}-${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
      if (seenCommentKeys.has(commentId)) {
        continue;
      }
      seenCommentKeys.add(commentId);

      comments.push({
        id: commentId,
        author: studioData?.author || author || undefined,
        modifiedAt: studioData?.modifiedAt || modifiedAt || undefined,
        color: studioData?.color || color,
        page: pageIndex + 1,
        viewportWidth: studioData?.viewportWidth || pageWidth,
        viewportHeight: studioData?.viewportHeight || pageHeight,
        rects:
          studioData?.rects.length
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

function extractNativeHighlights(pdfDocument: PDFDocument): AnnotationHighlight[] {
  const highlights: AnnotationHighlight[] = [];
  const seenHighlightKeys = new Set<string>();

  pdfDocument.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!annots) {
      return;
    }

    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = annots.lookupMaybe(index, PDFDict);
      if (!annotation) {
        continue;
      }

      const subtype = annotation.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
      if (subtype !== 'Highlight' && subtype !== 'Underline' && subtype !== 'StrikeOut') {
        continue;
      }

      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const rects =
        extractHighlightRects(annotation, pageHeight) ??
        extractRectFallback(annotation, pageHeight);
      if (!rects?.length) {
        continue;
      }

      const nm = decodePdfText(annotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
      const colorArray = annotation.lookupMaybe(PDFName.of('C'), PDFArray);
      const color = colorArray ? colorArrayToHex(colorArray) : '#facc15';
      const noteText = decodeNativeCommentText(annotation).trim();
      const noteAuthor = decodePdfText(annotation.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString)).trim();
      const noteModifiedAt = decodePdfDate(annotation.lookupMaybe(PDFName.of('M'), PDFString, PDFHexString));
      const noteSubject = decodePdfText(annotation.lookupMaybe(PDFName.of('Subj'), PDFString, PDFHexString)).trim();
      const highlightId =
        nm ||
        `native-highlight-${pageIndex + 1}-${Math.round(rects[0].x)}-${Math.round(rects[0].y)}-${rects.length}`;
      if (seenHighlightKeys.has(highlightId)) {
        continue;
      }
      seenHighlightKeys.add(highlightId);

      highlights.push({
        id: highlightId,
        kind: subtype === 'Underline' ? 'underline' : subtype === 'StrikeOut' ? 'strikeout' : 'highlight',
        color,
        page: pageIndex + 1,
        viewportWidth: pageWidth,
        viewportHeight: pageHeight,
        rects,
        attachedNote: noteText
          ? {
              text: noteText,
              author: noteAuthor || undefined,
              modifiedAt: noteModifiedAt || undefined,
              subject: noteSubject || undefined
            }
          : undefined
      });
    }
  });

  return highlights;
}

function extractFormFields(pdfDocument: PDFDocument): PdfFormField[] {
  const form = pdfDocument.getForm();
  if (form.hasXFA()) {
    return [];
  }

  const pageRefToNumber = new Map<string, number>();
  const pageDimensions = new Map<number, { width: number; height: number }>();
  pdfDocument.getPages().forEach((page, index) => {
    pageRefToNumber.set(page.ref.toString(), index + 1);
    pageDimensions.set(index + 1, {
      width: page.getWidth(),
      height: page.getHeight()
    });
  });

  const fields: PdfFormField[] = [];

  for (const field of form.getFields()) {
    const widgets = extractFieldWidgets(pdfDocument, field.acroField.getWidgets(), pageRefToNumber, pageDimensions);
    if (!widgets.length) {
      continue;
    }

    if (field instanceof PDFTextField) {
      fields.push({
        name: field.getName(),
        type: 'text',
        readOnly: field.isReadOnly(),
        value: field.getText() ?? '',
        multiline: field.isMultiline(),
        maxLength: field.getMaxLength() ?? null,
        semantic: detectTextFieldSemantic(field.getName()),
        widgets
      });
      continue;
    }

    if (field instanceof PDFCheckBox) {
      fields.push({
        name: field.getName(),
        type: 'checkbox',
        readOnly: field.isReadOnly(),
        checked: field.isChecked(),
        widgets
      });
      continue;
    }

    if (field instanceof PDFRadioGroup) {
      const options = field.getOptions();
      const widgetsWithOptions: PdfFormFieldWidget[] = widgets.map((widget, index) => ({
        ...widget,
        option: options[index] ?? widget.option
      }));
      fields.push({
        name: field.getName(),
        type: 'radio',
        readOnly: field.isReadOnly(),
        value: field.getSelected() ?? null,
        options,
        widgets: widgetsWithOptions
      });
      continue;
    }

    if (field instanceof PDFDropdown) {
      fields.push({
        name: field.getName(),
        type: 'dropdown',
        readOnly: field.isReadOnly(),
        value: field.getSelected(),
        options: field.getOptions(),
        editable: field.isEditable(),
        multiSelect: field.isMultiselect(),
        widgets
      });
      continue;
    }

    if (field instanceof PDFOptionList) {
      fields.push({
        name: field.getName(),
        type: 'optionList',
        readOnly: field.isReadOnly(),
        value: field.getSelected(),
        options: field.getOptions(),
        multiSelect: field.isMultiselect(),
        widgets
      });
      continue;
    }

    if (field instanceof PDFButton) {
      fields.push({
        name: field.getName(),
        type: 'button',
        readOnly: field.isReadOnly(),
        label: extractButtonLabel(field, widgets),
        action: extractButtonAction(field),
        widgets
      });
    }
  }

  return fields;
}

function extractButtonLabel(field: PDFButton, widgets: PdfFormFieldWidget[]): string {
  const caption = field.acroField
    .getWidgets()
    .map((widget) => widget.getAppearanceCharacteristics()?.getCaptions().normal?.trim())
    .find((value): value is string => Boolean(value));

  if (caption) {
    return caption;
  }

  return field.getName().split('.').pop() || `Button ${widgets[0]?.page ?? ''}`.trim();
}

function extractButtonAction(field: PDFButton): PdfButtonAction | null {
  const widgets = field.acroField.getWidgets();
  const candidates: Array<{ action: PdfButtonAction; priority: number }> = [];

  for (const widget of widgets) {
    const action = extractActionDescriptor(widget.dict.lookupMaybe(PDFName.of('A'), PDFDict));
    if (action) {
      candidates.push({ action, priority: 100 });
    }

    const additionalActions = widget.dict.lookupMaybe(PDFName.of('AA'), PDFDict);
    if (additionalActions) {
      for (const [key, priority] of [
        ['U', 95],
        ['D', 70],
        ['PO', 45],
        ['PC', 40],
        ['E', 35],
        ['X', 30],
        ['Fo', 20],
        ['Bl', 20],
        ['PV', 15],
        ['PI', 15]
      ] as const) {
        const additionalDescriptor = extractActionDescriptor(additionalActions.lookupMaybe(PDFName.of(key), PDFDict));
        if (additionalDescriptor) {
          candidates.push({ action: additionalDescriptor, priority });
        }
      }
    }
  }

  const directAction = extractActionDescriptor(field.acroField.dict.lookupMaybe(PDFName.of('A'), PDFDict));
  if (directAction) {
    candidates.push({ action: directAction, priority: 85 });
  }

  const additionalActions = field.acroField.dict.lookupMaybe(PDFName.of('AA'), PDFDict);
  if (additionalActions) {
    for (const [key, priority] of [
      ['U', 80],
      ['D', 60],
      ['PO', 35],
      ['PC', 30],
      ['E', 25],
      ['X', 20],
      ['Fo', 10],
      ['Bl', 10],
      ['PV', 5],
      ['PI', 5]
    ] as const) {
      const additionalDescriptor = extractActionDescriptor(additionalActions.lookupMaybe(PDFName.of(key), PDFDict));
      if (additionalDescriptor) {
        candidates.push({ action: additionalDescriptor, priority });
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => buttonActionScore(right) - buttonActionScore(left));
  return candidates[0]?.action ?? null;
}

function buttonActionScore(candidate: { action: PdfButtonAction; priority: number }): number {
  return candidate.priority + buttonActionTypeWeight(candidate.action);
}

function buttonActionTypeWeight(action: PdfButtonAction): number {
  switch (action.type) {
    case 'submit':
    case 'mailto':
    case 'uri':
      return 1000;
    case 'reset':
      return 500;
    case 'unsupported':
      return 0;
    default:
      return 0;
  }
}

function extractActionDescriptor(action: PDFDict | undefined): PdfButtonAction | null {
  if (!action) {
    return null;
  }

  const subtype = action.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText();
  if (!subtype) {
    return null;
  }

  if (subtype === 'ResetForm') {
    return {
      type: 'reset',
      url: null,
      method: null,
      reason: null
    };
  }

  if (subtype !== 'SubmitForm') {
    if (subtype === 'URI') {
      const uri = decodePdfText(action.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString));
      return uri
        ? {
            type: uri.startsWith('mailto:') ? 'mailto' : 'uri',
            url: uri,
            method: null,
            reason: null
          }
        : {
            type: 'unsupported',
            url: null,
            method: null,
            reason: 'URI action has no usable target.'
          };
    }

    return {
      type: 'unsupported',
      url: null,
      method: null,
      reason: `Unsupported PDF button action: ${subtype}`
    };
  }

  const target = action.get(PDFName.of('F'));
  const url = extractSubmitTargetUrl(target ?? undefined);
  if (!url) {
    return {
      type: 'unsupported',
      url: null,
      method: null,
      reason: 'Submit button has no usable target URL.'
    };
  }

  if (url.startsWith('mailto:')) {
    return {
      type: 'mailto',
      url,
      method: null,
      reason: null
    };
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return {
      type: 'submit',
      url,
      method: extractSubmitMethod(action),
      reason: null
    };
  }

  return {
    type: 'unsupported',
    url,
    method: null,
    reason: `Unsupported submit target: ${url}`
  };
}

function extractSubmitTargetUrl(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText().trim() || null;
  }

  if (!(value instanceof PDFDict)) {
    return null;
  }

  const unicodeTarget = value.get(PDFName.of('UF'));
  const decodedUnicodeTarget = extractSubmitTargetUrl(unicodeTarget);
  if (decodedUnicodeTarget) {
    return decodedUnicodeTarget;
  }

  const nested = value.get(PDFName.of('F'));
  const decodedNestedTarget = extractSubmitTargetUrl(nested);
  if (decodedNestedTarget) {
    return decodedNestedTarget;
  }

  return null;
}

function extractSubmitMethod(action: PDFDict): 'GET' | 'POST' {
  const flagsValue = action.lookupMaybe(PDFName.of('Flags'), PDFNumber);
  if (flagsValue) {
    const flags = flagsValue.asNumber();
    if ((flags & 8) !== 0) {
      return 'GET';
    }
  }

  return 'POST';
}

function extractFieldWidgets(
  pdfDocument: PDFDocument,
  widgets: ReturnType<PDFTextField['acroField']['getWidgets']>,
  pageRefToNumber: Map<string, number>,
  pageDimensions: Map<number, { width: number; height: number }>
): PdfFormFieldWidget[] {
  const normalizedWidgets: PdfFormFieldWidget[] = [];

  widgets.forEach((widget, index) => {
    const pageNumber = findWidgetPageNumber(pdfDocument, widget, pageRefToNumber);
    if (!pageNumber) {
      return;
    }

    const pageSize = pageDimensions.get(pageNumber);
    if (!pageSize) {
      return;
    }

    const rect = widget.getRectangle();
    if (!rect.width || !rect.height) {
      return;
    }

    normalizedWidgets.push({
      id: `${pageNumber}:${Math.round(rect.x)}:${Math.round(rect.y)}:${index}`,
      page: pageNumber,
      x: rect.x,
      y: pageSize.height - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
      option: widget.getOnValue()?.decodeText()
    });
  });

  return normalizedWidgets;
}

function findWidgetPageNumber(
  pdfDocument: PDFDocument,
  widget: ReturnType<PDFTextField['acroField']['getWidgets']>[number],
  pageRefToNumber: Map<string, number>
): number | null {
  const pageRef = widget.P();
  if (pageRef) {
    return pageRefToNumber.get(pageRef.toString()) ?? null;
  }

  for (const [pageIndex, page] of pdfDocument.getPages().entries()) {
    const annots = page.node.Annots();
    if (!annots) {
      continue;
    }

    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = annots.lookupMaybe(index, PDFDict);
      if (annotation === widget.dict) {
        return pageIndex + 1;
      }
    }
  }

  return null;
}

function detectTextFieldSemantic(name: string): PdfTextFieldSemantic {
  const normalized = name.toLowerCase();

  if (normalized.includes(':signer:fullname') || normalized.includes('fullname') || normalized.includes('full_name')) {
    return 'fullName';
  }

  if (normalized.includes(':signer:email') || normalized.includes('email') || normalized.includes('e-mail')) {
    return 'email';
  }

  if (normalized.includes(':signer:date') || normalized.endsWith('date') || normalized.includes('_date')) {
    return 'date';
  }

  return 'generic';
}

function mergeComments(studioComments: AnnotationComment[], nativeComments: AnnotationComment[]): AnnotationComment[] {
  if (!nativeComments.length) {
    return studioComments;
  }

  const merged = new Map<string, AnnotationComment>();

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

function mergeHighlights(
  studioHighlights: AnnotationHighlight[],
  nativeHighlights: AnnotationHighlight[]
): AnnotationHighlight[] {
  if (!nativeHighlights.length) {
    return studioHighlights;
  }

  const merged = new Map<string, AnnotationHighlight>();

  for (const highlight of studioHighlights) {
    merged.set(highlight.id, highlight);
  }

  for (const nativeHighlight of nativeHighlights) {
    merged.set(nativeHighlight.id, nativeHighlight);
  }

  return Array.from(merged.values());
}

function decodePdfText(value?: PDFHexString | PDFString): string {
  return value ? value.decodeText() : '';
}

function extractHighlightRects(annotation: PDFDict, pageHeight: number): AnnotationRect[] | null {
  const quadPoints = annotation.lookupMaybe(PDFName.of('QuadPoints'), PDFArray);
  if (!quadPoints || quadPoints.size() < 8) {
    return null;
  }

  const rects: AnnotationRect[] = [];
  for (let index = 0; index + 7 < quadPoints.size(); index += 8) {
    const points = [];
    for (let offset = 0; offset < 8; offset += 2) {
      const x = quadPoints.lookupMaybe(index + offset, PDFNumber)?.asNumber();
      const y = quadPoints.lookupMaybe(index + offset + 1, PDFNumber)?.asNumber();
      if (typeof x !== 'number' || typeof y !== 'number') {
        points.length = 0;
        break;
      }
      points.push({ x, y });
    }

    if (points.length !== 4) {
      continue;
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    rects.push({
      x: minX,
      y: pageHeight - maxY,
      width: maxX - minX,
      height: maxY - minY
    });
  }

  return rects.length ? rects : null;
}

function extractRectFallback(annotation: PDFDict, pageHeight: number): AnnotationRect[] | null {
  const rect = annotation.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asRectangle();
  if (!rect) {
    return null;
  }

  return [
    {
      x: rect.x,
      y: pageHeight - rect.y - rect.height,
      width: rect.width,
      height: rect.height
    }
  ];
}

function decodeNativeCommentText(annotation: PDFDict): string {
  const contents = decodePdfText(annotation.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)).trim();
  if (contents) {
    return contents;
  }

  const richText = decodePdfText(annotation.lookupMaybe(PDFName.of('RC'), PDFString, PDFHexString)).trim();
  if (!richText) {
    const subject = decodePdfText(annotation.lookupMaybe(PDFName.of('Subj'), PDFString, PDFHexString)).trim();
    return subject;
  }

  // Adobe often stores comment text in simple rich-text markup.
  return richText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodePdfDate(value?: PDFHexString | PDFString): string | null {
  const raw = decodePdfText(value).trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  ).toISOString();
}

function decodeStudioCommentPayload(
  value?: PDFHexString | PDFString
): Pick<AnnotationComment, 'id' | 'author' | 'modifiedAt' | 'color' | 'viewportWidth' | 'viewportHeight' | 'rects'> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value.decodeText()) as unknown;
    if (!isObject(parsed)) {
      return null;
    }

    const rects = sanitizeRectsForCommentPayload(parsed.rects);
    if (!rects.length) {
      return null;
    }

    return {
      id: typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : crypto.randomUUID(),
      author: typeof parsed.author === 'string' && parsed.author.trim() ? parsed.author.trim().slice(0, 120) : undefined,
      modifiedAt:
        typeof parsed.modifiedAt === 'string' && parsed.modifiedAt.trim() ? parsed.modifiedAt.trim() : undefined,
      color: typeof parsed.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.color) ? parsed.color : '#f97316',
      viewportWidth:
        typeof parsed.viewportWidth === 'number' && Number.isFinite(parsed.viewportWidth) && parsed.viewportWidth > 0
          ? parsed.viewportWidth
          : 1,
      viewportHeight:
        typeof parsed.viewportHeight === 'number' &&
        Number.isFinite(parsed.viewportHeight) &&
        parsed.viewportHeight > 0
          ? parsed.viewportHeight
          : 1,
      rects
    };
  } catch {
    return null;
  }
}

function colorArrayToHex(colorArray: PDFArray): string {
  const components = colorArray
    .asArray()
    .slice(0, 3)
    .map((component) => ('asNumber' in component && typeof component.asNumber === 'function' ? component.asNumber() : 0));

  const [red = 0.976, green = 0.451, blue = 0.086] = components.map((component) =>
    Math.round(clamp(component, 0, 1) * 255)
  );

  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue
    .toString(16)
    .padStart(2, '0')}`;
}

function sanitizeRectsForCommentPayload(value: unknown): AnnotationRect[] {
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
    .filter((rect): rect is AnnotationRect => rect !== null);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
