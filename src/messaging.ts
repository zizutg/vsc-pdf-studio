import type { AnnotationDocument } from '../models/annotation';
import type { PdfFormField } from '../models/formField';
import type { CapabilitySnapshot } from './features/capabilities';

export type ExtensionToWebviewMessage =
  | {
      type: 'init';
      payload: {
        fileName: string;
        pdfBase64: string;
        annotations: AnnotationDocument;
        formFields: PdfFormField[];
        capabilities: CapabilitySnapshot;
      };
    }
  | {
      type: 'formFieldsReplaced';
      payload: {
        formFields: PdfFormField[];
      };
    }
  | {
      type: 'saved';
      payload: {
        savedAt: string;
      };
    }
  | {
      type: 'error';
      payload: {
        message: string;
      };
    };

export type WebviewToExtensionMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'documentChanged';
      payload: {
        annotations: AnnotationDocument;
        formFields: PdfFormField[];
      };
    }
  | {
      type: 'buttonActivated';
      payload: {
        name: string;
        annotations: AnnotationDocument;
        formFields: PdfFormField[];
      };
    };
