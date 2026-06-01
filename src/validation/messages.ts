import type { WebviewToExtensionMessage } from '../messaging';
import { sanitizeAnnotationDocument } from './annotationDocument';
import { sanitizeFormFields } from './formFields';

export function parseWebviewMessage(
  input: unknown
): WebviewToExtensionMessage | null {
  if (!isObject(input) || typeof input.type !== 'string') {
    return null;
  }

  if (input.type === 'ready') {
    return { type: 'ready' };
  }

  if (input.type === 'documentChanged' && isObject(input.payload)) {
    return {
      type: 'documentChanged',
      payload: {
        annotations: sanitizeAnnotationDocument(input.payload.annotations),
        formFields: sanitizeFormFields(input.payload.formFields),
      },
    };
  }

  if (
    input.type === 'buttonActivated' &&
    isObject(input.payload) &&
    typeof input.payload.name === 'string'
  ) {
    return {
      type: 'buttonActivated',
      payload: {
        name: input.payload.name,
        annotations: sanitizeAnnotationDocument(input.payload.annotations),
        formFields: sanitizeFormFields(input.payload.formFields),
      },
    };
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
