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
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const pdf_lib_1 = require("pdf-lib");
const annotation_1 = require("../models/annotation");
const formField_1 = require("../models/formField");
const constants_1 = require("../src/constants");
const annotationDocument_1 = require("../src/validation/annotationDocument");
const PDF_STUDIO_COMMENT_KEY = pdf_lib_1.PDFName.of('PDFStudioComment');
class SaveManager {
    sessionBasePdf = new Map();
    sessionAnnotations = new Map();
    sessionFormFields = new Map();
    sessionResetFormFields = new Map();
    sessionFingerprints = new Map();
    async getPdfBytes(pdfUri) {
        await this.ensureSessionStateFresh(pdfUri);
        const cacheKey = pdfUri.toString();
        return new Uint8Array(this.sessionBasePdf.get(cacheKey) ?? new Uint8Array());
    }
    async getLivePdfBytes(pdfUri) {
        await this.ensureSessionStateFresh(pdfUri);
        return new Uint8Array(await fs.readFile(pdfUri.fsPath));
    }
    async getAnnotations(pdfUri) {
        await this.ensureSessionStateFresh(pdfUri);
        const cacheKey = pdfUri.toString();
        return structuredClone(this.sessionAnnotations.get(cacheKey) ?? (0, annotation_1.emptyAnnotationDocument)());
    }
    async getFormFields(pdfUri) {
        await this.ensureSessionStateFresh(pdfUri);
        const cacheKey = pdfUri.toString();
        return structuredClone(this.sessionFormFields.get(cacheKey) ?? (0, formField_1.emptyFormFields)());
    }
    async getResetFormFields(pdfUri) {
        await this.ensureSessionStateFresh(pdfUri);
        const cacheKey = pdfUri.toString();
        return structuredClone(this.sessionResetFormFields.get(cacheKey) ?? (0, formField_1.emptyFormFields)());
    }
    async getButtonAction(pdfUri, name) {
        const formFields = await this.getFormFields(pdfUri);
        const field = formFields.find((candidate) => candidate.type === 'button' && candidate.name === name);
        return field?.action ? structuredClone(field.action) : null;
    }
    async submitForm(formFields, action) {
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
    async saveDocument(pdfUri, annotations, formFields) {
        const cacheKey = pdfUri.toString();
        let basePdfBytes = this.sessionBasePdf.get(cacheKey);
        if (!basePdfBytes) {
            basePdfBytes = await this.getPdfBytes(pdfUri);
        }
        const pdfDocument = await pdf_lib_1.PDFDocument.load(basePdfBytes);
        applyFormFieldValues(pdfDocument, formFields);
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
        this.sessionFormFields.set(cacheKey, structuredClone(formFields));
        this.sessionFingerprints.set(cacheKey, await getFileFingerprint(pdfUri.fsPath));
    }
    disposeSession(pdfUri) {
        const cacheKey = pdfUri.toString();
        this.sessionBasePdf.delete(cacheKey);
        this.sessionAnnotations.delete(cacheKey);
        this.sessionFormFields.delete(cacheKey);
        this.sessionResetFormFields.delete(cacheKey);
        this.sessionFingerprints.delete(cacheKey);
    }
    async loadSessionState(pdfUri) {
        const cacheKey = pdfUri.toString();
        const pdfBytes = new Uint8Array(await fs.readFile(pdfUri.fsPath));
        const pdfDocument = await pdf_lib_1.PDFDocument.load(pdfBytes);
        const nativeComments = extractNativeComments(pdfDocument);
        const nativeHighlights = extractNativeHighlights(pdfDocument);
        const formFields = extractFormFields(pdfDocument);
        this.sessionFormFields.set(cacheKey, formFields);
        this.sessionResetFormFields.set(cacheKey, extractResetFormFields(pdfDocument, formFields));
        const rawAnnotationData = pdfDocument.catalog.lookup(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_DATA_KEY));
        const annotationJson = rawAnnotationData instanceof pdf_lib_1.PDFHexString || rawAnnotationData instanceof pdf_lib_1.PDFString
            ? rawAnnotationData.decodeText()
            : null;
        const sanitizedAnnotations = parseStoredAnnotations(annotationJson);
        const embeddedBase = pdfDocument.catalog.lookup(pdf_lib_1.PDFName.of(constants_1.PDF_STUDIO_BASE_KEY));
        const basePdfBytes = await resolveSessionBasePdfBytes(pdfBytes, pdfDocument, formFields, embeddedBase, sanitizedAnnotations);
        this.sessionBasePdf.set(cacheKey, new Uint8Array(basePdfBytes));
        if (!annotationJson) {
            this.sessionAnnotations.set(cacheKey, {
                ...(0, annotation_1.emptyAnnotationDocument)(),
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
    async ensureSessionStateFresh(pdfUri) {
        const cacheKey = pdfUri.toString();
        const cachedFingerprint = this.sessionFingerprints.get(cacheKey);
        const hasSession = this.sessionBasePdf.has(cacheKey) &&
            this.sessionAnnotations.has(cacheKey) &&
            this.sessionFormFields.has(cacheKey) &&
            this.sessionResetFormFields.has(cacheKey) &&
            Boolean(cachedFingerprint);
        if (!hasSession) {
            await this.loadSessionState(pdfUri);
            return;
        }
        const currentFingerprint = await getFileFingerprint(pdfUri.fsPath);
        if (currentFingerprint.size !== cachedFingerprint.size ||
            currentFingerprint.mtimeMs !== cachedFingerprint.mtimeMs) {
            await this.loadSessionState(pdfUri);
        }
    }
}
exports.SaveManager = SaveManager;
async function getFileFingerprint(fsPath) {
    const stats = await fs.stat(fsPath);
    return {
        size: stats.size,
        mtimeMs: stats.mtimeMs
    };
}
function parseStoredAnnotations(annotationJson) {
    if (!annotationJson) {
        return (0, annotation_1.emptyAnnotationDocument)();
    }
    try {
        return (0, annotationDocument_1.sanitizeAnnotationDocument)(JSON.parse(annotationJson));
    }
    catch {
        return (0, annotation_1.emptyAnnotationDocument)();
    }
}
function hasRenderableStudioMarkup(annotations) {
    return (annotations.strokes.length > 0 ||
        annotations.highlights.length > 0 ||
        annotations.comments.length > 0);
}
async function resolveSessionBasePdfBytes(livePdfBytes, livePdfDocument, liveFormFields, embeddedBase, annotations) {
    if (!(embeddedBase instanceof pdf_lib_1.PDFRawStream)) {
        return livePdfBytes;
    }
    const embeddedBaseBytes = (0, pdf_lib_1.decodePDFRawStream)(embeddedBase).decode();
    if (!liveFormFields.length) {
        return embeddedBaseBytes;
    }
    try {
        const basePdfDocument = await pdf_lib_1.PDFDocument.load(embeddedBaseBytes);
        const livePageCount = livePdfDocument.getPageCount();
        const basePageCount = basePdfDocument.getPageCount();
        const pagesWithStudioMarkup = collectPagesWithStudioMarkup(annotations);
        if (livePageCount > basePageCount) {
            return materializeExternalPageAdditionsOnBase(embeddedBaseBytes, livePdfBytes, basePageCount, livePageCount);
        }
        const replacementPageIndexes = collectReplaceableChangedPageIndexes(basePdfDocument, livePdfDocument, pagesWithStudioMarkup);
        const baseFormFields = extractFormFields(basePdfDocument);
        const baseFieldNames = new Set(baseFormFields.map((field) => field.name));
        const missingFormFields = liveFormFields.filter((field) => !baseFieldNames.has(field.name));
        const missingButtonFields = missingFormFields.filter((field) => field.type === 'button');
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
    }
    catch {
        return livePdfBytes;
    }
    return embeddedBaseBytes;
}
function countNativeFormFields(pdfDocument) {
    const form = pdfDocument.getForm();
    if (form.hasXFA()) {
        return 0;
    }
    return form.getFields().length;
}
async function materializeFormFieldsOnBase(basePdfBytes, liveFormFields) {
    const pdfDocument = await pdf_lib_1.PDFDocument.load(basePdfBytes);
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
            }
            else {
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
async function materializeExternalPageAdditionsOnBase(basePdfBytes, livePdfBytes, basePageCount, livePageCount) {
    const basePdfDocument = await pdf_lib_1.PDFDocument.load(basePdfBytes);
    const livePdfDocument = await pdf_lib_1.PDFDocument.load(livePdfBytes);
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
async function materializeChangedPagesOnBase(basePdfBytes, livePdfBytes, pageIndexes) {
    const basePdfDocument = await pdf_lib_1.PDFDocument.load(basePdfBytes);
    const livePdfDocument = await pdf_lib_1.PDFDocument.load(livePdfBytes);
    const copiedPages = await basePdfDocument.copyPages(livePdfDocument, pageIndexes);
    for (let index = copiedPages.length - 1; index >= 0; index -= 1) {
        const pageIndex = pageIndexes[index];
        basePdfDocument.removePage(pageIndex);
        basePdfDocument.insertPage(pageIndex, copiedPages[index]);
    }
    return basePdfDocument.save();
}
function collectReplaceableChangedPageIndexes(basePdfDocument, livePdfDocument, pagesWithStudioMarkup) {
    const changedPages = [];
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
function collectPagesWithStudioMarkup(annotations) {
    const pages = new Set();
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
function collectReplaceableFormFieldPageIndexes(formFields, pagesWithStudioMarkup) {
    const pageIndexes = new Set();
    for (const field of formFields) {
        for (const widget of field.widgets) {
            if (!pagesWithStudioMarkup.has(widget.page)) {
                pageIndexes.add(widget.page - 1);
            }
        }
    }
    return Array.from(pageIndexes);
}
function buildPageSignature(page) {
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
function buildFieldAppearanceOptions(page, widget) {
    return {
        x: widget.x,
        y: page.getHeight() - widget.y - widget.height,
        width: widget.width,
        height: widget.height,
        borderColor: (0, pdf_lib_1.rgb)(0.45, 0.45, 0.45),
        backgroundColor: (0, pdf_lib_1.rgb)(1, 1, 1),
        textColor: (0, pdf_lib_1.rgb)(0.1, 0.1, 0.1)
    };
}
function setReadOnly(field, readOnly) {
    const maybeField = field;
    if (readOnly) {
        maybeField.enableReadOnly?.();
    }
    else {
        maybeField.disableReadOnly?.();
    }
}
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
function applyFormFieldValues(pdfDocument, formFields) {
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
                if (field instanceof pdf_lib_1.PDFTextField) {
                    field.setText(fieldState.value || undefined);
                }
                break;
            case 'checkbox':
                if (field instanceof pdf_lib_1.PDFCheckBox) {
                    if (fieldState.checked) {
                        field.check();
                    }
                    else {
                        field.uncheck();
                    }
                }
                break;
            case 'radio':
                if (field instanceof pdf_lib_1.PDFRadioGroup) {
                    if (fieldState.value) {
                        field.select(fieldState.value);
                    }
                    else {
                        field.clear();
                    }
                }
                break;
            case 'dropdown':
                if (field instanceof pdf_lib_1.PDFDropdown) {
                    if (fieldState.value.length) {
                        field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
                    }
                    else {
                        field.clear();
                    }
                }
                break;
            case 'optionList':
                if (field instanceof pdf_lib_1.PDFOptionList) {
                    if (fieldState.value.length) {
                        field.select(fieldState.multiSelect ? fieldState.value : fieldState.value[0]);
                    }
                    else {
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
function extractResetFormFields(pdfDocument, currentFormFields) {
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
                    value: decodeDefaultTextValue(field.acroField.dict.lookup(pdf_lib_1.PDFName.of('DV')))
                };
            case 'checkbox':
                return {
                    ...fieldState,
                    checked: decodeDefaultCheckboxValue(field.acroField.dict.lookup(pdf_lib_1.PDFName.of('DV')))
                };
            case 'radio':
                return {
                    ...fieldState,
                    value: decodeDefaultChoiceValue(field.acroField.dict.lookup(pdf_lib_1.PDFName.of('DV')))
                };
            case 'dropdown':
            case 'optionList':
                return {
                    ...fieldState,
                    value: decodeDefaultChoiceValues(field.acroField.dict.lookup(pdf_lib_1.PDFName.of('DV')))
                };
            default:
                return fieldState;
        }
    });
}
function decodeDefaultTextValue(value) {
    if (value instanceof pdf_lib_1.PDFString || value instanceof pdf_lib_1.PDFHexString) {
        return value.decodeText();
    }
    return '';
}
function decodeDefaultCheckboxValue(value) {
    if (value instanceof pdf_lib_1.PDFName) {
        return value.decodeText() !== 'Off';
    }
    if (value instanceof pdf_lib_1.PDFString || value instanceof pdf_lib_1.PDFHexString) {
        return value.decodeText() !== 'Off';
    }
    return false;
}
function decodeDefaultChoiceValue(value) {
    if (value instanceof pdf_lib_1.PDFName) {
        const decoded = value.decodeText();
        return decoded.length ? decoded : null;
    }
    if (value instanceof pdf_lib_1.PDFString || value instanceof pdf_lib_1.PDFHexString) {
        const decoded = value.decodeText();
        return decoded.length ? decoded : null;
    }
    return null;
}
function decodeDefaultChoiceValues(value) {
    if (value instanceof pdf_lib_1.PDFArray) {
        const values = [];
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
function buildSubmitFormPayload(formFields) {
    const payload = [];
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
function applyButtonActionToField(pdfDocument, field, action) {
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
    widget.dict.set(pdf_lib_1.PDFName.of('A'), actionDict);
}
function createButtonActionDict(pdfDocument, action) {
    switch (action.type) {
        case 'reset':
            return pdfDocument.context.obj({
                S: pdf_lib_1.PDFName.of('ResetForm')
            });
        case 'submit':
            if (!action.url) {
                return null;
            }
            return pdfDocument.context.obj({
                S: pdf_lib_1.PDFName.of('SubmitForm'),
                F: pdf_lib_1.PDFString.of(action.url),
                Flags: pdf_lib_1.PDFNumber.of(action.method === 'GET' ? 8 : 0)
            });
        case 'mailto':
        case 'uri':
            if (!action.url) {
                return null;
            }
            return pdfDocument.context.obj({
                S: pdf_lib_1.PDFName.of('URI'),
                URI: pdf_lib_1.PDFString.of(action.url)
            });
        case 'unsupported':
        default:
            return null;
    }
}
async function executeHttpRequest(targetUrl, method, body) {
    const transport = targetUrl.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
        const request = transport.request(targetUrl, {
            method,
            headers: method === 'POST'
                ? {
                    'content-type': 'application/x-www-form-urlencoded',
                    'content-length': Buffer.byteLength(body || '').toString()
                }
                : undefined
        }, (response) => {
            const statusCode = response.statusCode ?? 0;
            response.resume();
            response.on('end', () => {
                if (statusCode >= 200 && statusCode < 400) {
                    resolve();
                    return;
                }
                reject(new Error(`SubmitForm request failed with status ${statusCode}.`));
            });
        });
        request.on('error', reject);
        if (method === 'POST' && body) {
            request.write(body);
        }
        request.end();
    });
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
    const seenCommentKeys = new Set();
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
            const subtype = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)?.decodeText();
            let sourceAnnotation = annotation;
            if (subtype === 'Popup') {
                const parent = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Parent'), pdf_lib_1.PDFDict);
                const parentSubtype = parent?.lookupMaybe(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)?.decodeText();
                if (!parent ||
                    (parentSubtype !== 'Text' && parentSubtype !== 'FreeText')) {
                    continue;
                }
                sourceAnnotation = parent;
            }
            else if (subtype !== 'Text' && subtype !== 'FreeText') {
                continue;
            }
            const contents = decodeNativeCommentText(sourceAnnotation);
            if (!contents.trim()) {
                continue;
            }
            const rect = sourceAnnotation.lookupMaybe(pdf_lib_1.PDFName.of('Rect'), pdf_lib_1.PDFArray)?.asRectangle() ??
                annotation.lookupMaybe(pdf_lib_1.PDFName.of('Rect'), pdf_lib_1.PDFArray)?.asRectangle();
            if (!rect) {
                continue;
            }
            const nm = decodePdfText(sourceAnnotation.lookupMaybe(pdf_lib_1.PDFName.of('NM'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            const colorArray = sourceAnnotation.lookupMaybe(pdf_lib_1.PDFName.of('C'), pdf_lib_1.PDFArray) ?? annotation.lookupMaybe(pdf_lib_1.PDFName.of('C'), pdf_lib_1.PDFArray);
            const color = colorArray ? colorArrayToHex(colorArray) : '#f97316';
            const pageWidth = page.getWidth();
            const pageHeight = page.getHeight();
            const studioData = decodeStudioCommentPayload(sourceAnnotation.lookupMaybe(PDF_STUDIO_COMMENT_KEY, pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            const commentId = studioData?.id ||
                nm ||
                `native-${pageIndex + 1}-${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
            if (seenCommentKeys.has(commentId)) {
                continue;
            }
            seenCommentKeys.add(commentId);
            comments.push({
                id: commentId,
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
function extractNativeHighlights(pdfDocument) {
    const highlights = [];
    const seenHighlightKeys = new Set();
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
            const subtype = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Subtype'), pdf_lib_1.PDFName)?.decodeText();
            if (subtype !== 'Highlight' && subtype !== 'Underline' && subtype !== 'StrikeOut') {
                continue;
            }
            const pageWidth = page.getWidth();
            const pageHeight = page.getHeight();
            const rects = extractHighlightRects(annotation, pageHeight) ??
                extractRectFallback(annotation, pageHeight);
            if (!rects?.length) {
                continue;
            }
            const nm = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('NM'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
            const colorArray = annotation.lookupMaybe(pdf_lib_1.PDFName.of('C'), pdf_lib_1.PDFArray);
            const color = colorArray ? colorArrayToHex(colorArray) : '#facc15';
            const highlightId = nm ||
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
                rects
            });
        }
    });
    return highlights;
}
function extractFormFields(pdfDocument) {
    const form = pdfDocument.getForm();
    if (form.hasXFA()) {
        return [];
    }
    const pageRefToNumber = new Map();
    const pageDimensions = new Map();
    pdfDocument.getPages().forEach((page, index) => {
        pageRefToNumber.set(page.ref.toString(), index + 1);
        pageDimensions.set(index + 1, {
            width: page.getWidth(),
            height: page.getHeight()
        });
    });
    const fields = [];
    for (const field of form.getFields()) {
        const widgets = extractFieldWidgets(pdfDocument, field.acroField.getWidgets(), pageRefToNumber, pageDimensions);
        if (!widgets.length) {
            continue;
        }
        if (field instanceof pdf_lib_1.PDFTextField) {
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
        if (field instanceof pdf_lib_1.PDFCheckBox) {
            fields.push({
                name: field.getName(),
                type: 'checkbox',
                readOnly: field.isReadOnly(),
                checked: field.isChecked(),
                widgets
            });
            continue;
        }
        if (field instanceof pdf_lib_1.PDFRadioGroup) {
            const options = field.getOptions();
            const widgetsWithOptions = widgets.map((widget, index) => ({
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
        if (field instanceof pdf_lib_1.PDFDropdown) {
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
        if (field instanceof pdf_lib_1.PDFOptionList) {
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
        if (field instanceof pdf_lib_1.PDFButton) {
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
function extractButtonLabel(field, widgets) {
    const caption = field.acroField
        .getWidgets()
        .map((widget) => widget.getAppearanceCharacteristics()?.getCaptions().normal?.trim())
        .find((value) => Boolean(value));
    if (caption) {
        return caption;
    }
    return field.getName().split('.').pop() || `Button ${widgets[0]?.page ?? ''}`.trim();
}
function extractButtonAction(field) {
    const widgets = field.acroField.getWidgets();
    const candidates = [];
    for (const widget of widgets) {
        const action = extractActionDescriptor(widget.dict.lookupMaybe(pdf_lib_1.PDFName.of('A'), pdf_lib_1.PDFDict));
        if (action) {
            candidates.push({ action, priority: 100 });
        }
        const additionalActions = widget.dict.lookupMaybe(pdf_lib_1.PDFName.of('AA'), pdf_lib_1.PDFDict);
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
            ]) {
                const additionalDescriptor = extractActionDescriptor(additionalActions.lookupMaybe(pdf_lib_1.PDFName.of(key), pdf_lib_1.PDFDict));
                if (additionalDescriptor) {
                    candidates.push({ action: additionalDescriptor, priority });
                }
            }
        }
    }
    const directAction = extractActionDescriptor(field.acroField.dict.lookupMaybe(pdf_lib_1.PDFName.of('A'), pdf_lib_1.PDFDict));
    if (directAction) {
        candidates.push({ action: directAction, priority: 85 });
    }
    const additionalActions = field.acroField.dict.lookupMaybe(pdf_lib_1.PDFName.of('AA'), pdf_lib_1.PDFDict);
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
        ]) {
            const additionalDescriptor = extractActionDescriptor(additionalActions.lookupMaybe(pdf_lib_1.PDFName.of(key), pdf_lib_1.PDFDict));
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
function buttonActionScore(candidate) {
    return candidate.priority + buttonActionTypeWeight(candidate.action);
}
function buttonActionTypeWeight(action) {
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
function extractActionDescriptor(action) {
    if (!action) {
        return null;
    }
    const subtype = action.lookupMaybe(pdf_lib_1.PDFName.of('S'), pdf_lib_1.PDFName)?.decodeText();
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
            const uri = decodePdfText(action.lookupMaybe(pdf_lib_1.PDFName.of('URI'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString));
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
    const target = action.get(pdf_lib_1.PDFName.of('F'));
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
function extractSubmitTargetUrl(value) {
    if (!value) {
        return null;
    }
    if (value instanceof pdf_lib_1.PDFString || value instanceof pdf_lib_1.PDFHexString) {
        return value.decodeText().trim() || null;
    }
    if (!(value instanceof pdf_lib_1.PDFDict)) {
        return null;
    }
    const unicodeTarget = value.get(pdf_lib_1.PDFName.of('UF'));
    const decodedUnicodeTarget = extractSubmitTargetUrl(unicodeTarget);
    if (decodedUnicodeTarget) {
        return decodedUnicodeTarget;
    }
    const nested = value.get(pdf_lib_1.PDFName.of('F'));
    const decodedNestedTarget = extractSubmitTargetUrl(nested);
    if (decodedNestedTarget) {
        return decodedNestedTarget;
    }
    return null;
}
function extractSubmitMethod(action) {
    const flagsValue = action.lookupMaybe(pdf_lib_1.PDFName.of('Flags'), pdf_lib_1.PDFNumber);
    if (flagsValue) {
        const flags = flagsValue.asNumber();
        if ((flags & 8) !== 0) {
            return 'GET';
        }
    }
    return 'POST';
}
function extractFieldWidgets(pdfDocument, widgets, pageRefToNumber, pageDimensions) {
    const normalizedWidgets = [];
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
function findWidgetPageNumber(pdfDocument, widget, pageRefToNumber) {
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
            const annotation = annots.lookupMaybe(index, pdf_lib_1.PDFDict);
            if (annotation === widget.dict) {
                return pageIndex + 1;
            }
        }
    }
    return null;
}
function detectTextFieldSemantic(name) {
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
function mergeHighlights(studioHighlights, nativeHighlights) {
    if (!nativeHighlights.length) {
        return studioHighlights;
    }
    const merged = new Map();
    for (const highlight of studioHighlights) {
        merged.set(highlight.id, highlight);
    }
    for (const nativeHighlight of nativeHighlights) {
        merged.set(nativeHighlight.id, nativeHighlight);
    }
    return Array.from(merged.values());
}
function decodePdfText(value) {
    return value ? value.decodeText() : '';
}
function extractHighlightRects(annotation, pageHeight) {
    const quadPoints = annotation.lookupMaybe(pdf_lib_1.PDFName.of('QuadPoints'), pdf_lib_1.PDFArray);
    if (!quadPoints || quadPoints.size() < 8) {
        return null;
    }
    const rects = [];
    for (let index = 0; index + 7 < quadPoints.size(); index += 8) {
        const points = [];
        for (let offset = 0; offset < 8; offset += 2) {
            const x = quadPoints.lookupMaybe(index + offset, pdf_lib_1.PDFNumber)?.asNumber();
            const y = quadPoints.lookupMaybe(index + offset + 1, pdf_lib_1.PDFNumber)?.asNumber();
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
function extractRectFallback(annotation, pageHeight) {
    const rect = annotation.lookupMaybe(pdf_lib_1.PDFName.of('Rect'), pdf_lib_1.PDFArray)?.asRectangle();
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
function decodeNativeCommentText(annotation) {
    const contents = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('Contents'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString)).trim();
    if (contents) {
        return contents;
    }
    const richText = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('RC'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString)).trim();
    if (!richText) {
        const subject = decodePdfText(annotation.lookupMaybe(pdf_lib_1.PDFName.of('Subj'), pdf_lib_1.PDFString, pdf_lib_1.PDFHexString)).trim();
        return subject;
    }
    // Adobe often stores comment text in simple rich-text markup.
    return richText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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