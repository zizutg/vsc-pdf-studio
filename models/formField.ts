export type PdfFormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'optionList'
  | 'button';
export type PdfTextFieldSemantic = 'generic' | 'fullName' | 'email' | 'date';
export type PdfButtonActionType =
  | 'reset'
  | 'submit'
  | 'mailto'
  | 'uri'
  | 'unsupported';

export interface PdfFormFieldWidget {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  option?: string;
}

interface PdfFormFieldBase {
  name: string;
  type: PdfFormFieldType;
  readOnly: boolean;
  widgets: PdfFormFieldWidget[];
}

export interface PdfTextFormField extends PdfFormFieldBase {
  type: 'text';
  value: string;
  multiline: boolean;
  maxLength: number | null;
  semantic: PdfTextFieldSemantic;
}

export interface PdfCheckboxFormField extends PdfFormFieldBase {
  type: 'checkbox';
  checked: boolean;
}

export interface PdfRadioFormField extends PdfFormFieldBase {
  type: 'radio';
  value: string | null;
  options: string[];
}

export interface PdfDropdownFormField extends PdfFormFieldBase {
  type: 'dropdown';
  value: string[];
  options: string[];
  editable: boolean;
  multiSelect: boolean;
}

export interface PdfOptionListFormField extends PdfFormFieldBase {
  type: 'optionList';
  value: string[];
  options: string[];
  multiSelect: boolean;
}

export interface PdfButtonAction {
  type: PdfButtonActionType;
  url: string | null;
  method: 'GET' | 'POST' | null;
  reason: string | null;
}

export interface PdfButtonFormField extends PdfFormFieldBase {
  type: 'button';
  label: string;
  action: PdfButtonAction | null;
}

export type PdfFormField =
  | PdfTextFormField
  | PdfCheckboxFormField
  | PdfRadioFormField
  | PdfDropdownFormField
  | PdfOptionListFormField
  | PdfButtonFormField;

export function emptyFormFields(): PdfFormField[] {
  return [];
}
