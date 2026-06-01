import {
  type PdfButtonAction,
  type PdfButtonFormField,
  type PdfCheckboxFormField,
  type PdfDropdownFormField,
  emptyFormFields,
  type PdfFormField,
  type PdfFormFieldWidget,
  type PdfOptionListFormField,
  type PdfRadioFormField,
  type PdfTextFieldSemantic,
  type PdfTextFormField,
} from '../../models/formField';

const MAX_FORM_FIELDS = 2_000;
const MAX_FORM_OPTIONS = 512;
const MAX_FIELD_VALUE_LENGTH = 8_000;
const MAX_FIELD_WIDGETS = 64;

export function sanitizeFormFields(input: unknown): PdfFormField[] {
  if (!Array.isArray(input)) {
    return emptyFormFields();
  }
  if (input.length > MAX_FORM_FIELDS) {
    throw new Error('Form payload exceeds field limit.');
  }

  return input
    .map((field) => sanitizeFormField(field))
    .filter((field): field is PdfFormField => field !== null);
}

function sanitizeFormField(input: unknown): PdfFormField | null {
  if (!isObject(input) || typeof input.type !== 'string') {
    return null;
  }

  switch (input.type) {
    case 'text':
      return sanitizeTextField(input);
    case 'checkbox':
      return sanitizeCheckboxField(input);
    case 'radio':
      return sanitizeRadioField(input);
    case 'dropdown':
      return sanitizeDropdownField(input);
    case 'optionList':
      return sanitizeOptionListField(input);
    case 'button':
      return sanitizeButtonField(input);
    default:
      return null;
  }
}

function sanitizeFieldBase(
  input: Record<string, unknown>
): Pick<PdfTextFormField, 'name' | 'readOnly' | 'widgets'> | null {
  const name = sanitizeName(input.name);
  const widgets = sanitizeWidgets(input.widgets);
  if (!name || !widgets.length) {
    return null;
  }

  return {
    name,
    readOnly: Boolean(input.readOnly),
    widgets,
  };
}

function sanitizeTextField(
  input: Record<string, unknown>
): PdfTextFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'text',
    value: sanitizeTextValue(input.value),
    multiline: Boolean(input.multiline),
    maxLength: sanitizeNullablePositiveInteger(input.maxLength),
    semantic: sanitizeTextSemantic(input.semantic),
  };
}

function sanitizeCheckboxField(
  input: Record<string, unknown>
): PdfCheckboxFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'checkbox',
    checked: Boolean(input.checked),
  };
}

function sanitizeRadioField(
  input: Record<string, unknown>
): PdfRadioFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'radio',
    value:
      typeof input.value === 'string' && input.value.length
        ? input.value.slice(0, MAX_FIELD_VALUE_LENGTH)
        : null,
    options: sanitizeOptions(input.options),
  };
}

function sanitizeDropdownField(
  input: Record<string, unknown>
): PdfDropdownFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'dropdown',
    value: sanitizeSelectedValues(input.value),
    options: sanitizeOptions(input.options),
    editable: Boolean(input.editable),
    multiSelect: Boolean(input.multiSelect),
  };
}

function sanitizeOptionListField(
  input: Record<string, unknown>
): PdfOptionListFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'optionList',
    value: sanitizeSelectedValues(input.value),
    options: sanitizeOptions(input.options),
    multiSelect: Boolean(input.multiSelect),
  };
}

function sanitizeButtonField(
  input: Record<string, unknown>
): PdfButtonFormField | null {
  const base = sanitizeFieldBase(input);
  if (!base) {
    return null;
  }

  return {
    ...base,
    type: 'button',
    label:
      typeof input.label === 'string' && input.label.trim().length
        ? input.label.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
        : base.name,
    action: sanitizeButtonAction(input.action),
  };
}

function sanitizeButtonAction(input: unknown): PdfButtonAction | null {
  if (!isObject(input) || typeof input.type !== 'string') {
    return null;
  }

  const type =
    input.type === 'reset' ||
    input.type === 'submit' ||
    input.type === 'mailto' ||
    input.type === 'uri' ||
    input.type === 'unsupported'
      ? input.type
      : null;
  if (!type) {
    return null;
  }

  return {
    type,
    url:
      typeof input.url === 'string' && input.url.trim().length
        ? input.url.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
        : null,
    method:
      input.method === 'GET' || input.method === 'POST' ? input.method : null,
    reason:
      typeof input.reason === 'string' && input.reason.trim().length
        ? input.reason.trim().slice(0, MAX_FIELD_VALUE_LENGTH)
        : null,
  };
}

function sanitizeWidgets(input: unknown): PdfFormFieldWidget[] {
  if (!Array.isArray(input) || input.length > MAX_FIELD_WIDGETS) {
    return [];
  }

  return input
    .map((widget) => sanitizeWidget(widget))
    .filter((widget): widget is PdfFormFieldWidget => widget !== null);
}

function sanitizeWidget(input: unknown): PdfFormFieldWidget | null {
  if (!isObject(input)) {
    return null;
  }

  const id = sanitizeName(input.id);
  const page = sanitizePositiveInteger(input.page);
  const x = sanitizeFiniteNumber(input.x);
  const y = sanitizeFiniteNumber(input.y);
  const width = sanitizePositiveNumber(input.width);
  const height = sanitizePositiveNumber(input.height);
  if (
    !id ||
    page === null ||
    x === null ||
    y === null ||
    width === null ||
    height === null
  ) {
    return null;
  }

  return {
    id,
    page,
    x,
    y,
    width,
    height,
    option:
      typeof input.option === 'string' && input.option.length
        ? input.option.slice(0, MAX_FIELD_VALUE_LENGTH)
        : undefined,
  };
}

function sanitizeOptions(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAX_FORM_OPTIONS) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.slice(0, MAX_FIELD_VALUE_LENGTH));
}

function sanitizeSelectedValues(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === 'string')
    .slice(0, MAX_FORM_OPTIONS)
    .map((value) => value.slice(0, MAX_FIELD_VALUE_LENGTH));
}

function sanitizeTextValue(input: unknown): string {
  return typeof input === 'string'
    ? input.slice(0, MAX_FIELD_VALUE_LENGTH)
    : '';
}

function sanitizeTextSemantic(input: unknown): PdfTextFieldSemantic {
  return input === 'fullName' || input === 'email' || input === 'date'
    ? input
    : 'generic';
}

function sanitizeNullablePositiveInteger(input: unknown): number | null {
  return typeof input === 'number' && Number.isInteger(input) && input > 0
    ? input
    : null;
}

function sanitizePositiveInteger(input: unknown): number | null {
  return typeof input === 'number' && Number.isInteger(input) && input > 0
    ? input
    : null;
}

function sanitizeFiniteNumber(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null;
}

function sanitizePositiveNumber(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) && input > 0
    ? input
    : null;
}

function sanitizeName(input: unknown): string | null {
  return typeof input === 'string' && input.trim().length > 0
    ? input.trim()
    : null;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
