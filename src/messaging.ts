import type { AnnotationDocument } from '../models/annotation';

export type ExtensionToWebviewMessage =
  | {
      type: 'init';
      payload: {
        fileName: string;
        pdfBase64: string;
        annotations: AnnotationDocument;
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
      type: 'annotationsChanged';
      payload: {
        annotations: AnnotationDocument;
      };
    };
