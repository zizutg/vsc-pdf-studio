"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseExternalLink = parseExternalLink;
function parseExternalLink(value) {
    if (typeof value !== 'string' || value.length > 8_192) {
        return null;
    }
    try {
        const url = new URL(value);
        return ['https:', 'http:', 'mailto:'].includes(url.protocol)
            ? url.href
            : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=links.js.map