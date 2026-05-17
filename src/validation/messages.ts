import type { WebviewToExtensionMessage } from '../messaging';
import { sanitizeAnnotationDocument } from './annotationDocument';

export function parseWebviewMessage(input: unknown): WebviewToExtensionMessage | null {
  if (!isObject(input) || typeof input.type !== 'string') {
    return null;
  }

  if (input.type === 'ready') {
    return { type: 'ready' };
  }

  if (input.type === 'annotationsChanged' && isObject(input.payload)) {
    return {
      type: 'annotationsChanged',
      payload: {
        annotations: sanitizeAnnotationDocument(input.payload.annotations)
      }
    };
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
