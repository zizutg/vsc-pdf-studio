"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWebviewMessage = parseWebviewMessage;
const annotationDocument_1 = require("./annotationDocument");
function parseWebviewMessage(input) {
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
                annotations: (0, annotationDocument_1.sanitizeAnnotationDocument)(input.payload.annotations)
            }
        };
    }
    return null;
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
//# sourceMappingURL=messages.js.map