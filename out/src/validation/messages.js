"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWebviewMessage = parseWebviewMessage;
const annotationDocument_1 = require("./annotationDocument");
const formFields_1 = require("./formFields");
const links_1 = require("./links");
function parseWebviewMessage(input) {
    if (!isObject(input) || typeof input.type !== 'string') {
        return null;
    }
    if (input.type === 'ready') {
        return { type: 'ready' };
    }
    if (input.type === 'openExternalLink' && isObject(input.payload)) {
        const url = (0, links_1.parseExternalLink)(input.payload.url);
        return url ? { type: 'openExternalLink', payload: { url } } : null;
    }
    if (input.type === 'documentChanged' && isObject(input.payload)) {
        return {
            type: 'documentChanged',
            payload: {
                annotations: (0, annotationDocument_1.sanitizeAnnotationDocument)(input.payload.annotations),
                formFields: (0, formFields_1.sanitizeFormFields)(input.payload.formFields),
            },
        };
    }
    if (input.type === 'buttonActivated' &&
        isObject(input.payload) &&
        typeof input.payload.name === 'string') {
        return {
            type: 'buttonActivated',
            payload: {
                name: input.payload.name,
                annotations: (0, annotationDocument_1.sanitizeAnnotationDocument)(input.payload.annotations),
                formFields: (0, formFields_1.sanitizeFormFields)(input.payload.formFields),
            },
        };
    }
    return null;
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=messages.js.map