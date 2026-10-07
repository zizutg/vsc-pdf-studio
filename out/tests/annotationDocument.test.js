"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const annotationDocument_1 = require("../src/validation/annotationDocument");
const stroke = {
    id: 'stroke-1',
    color: '#ef4444',
    width: 3,
    page: 1,
    viewportWidth: 400,
    viewportHeight: 500,
    points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
    ],
};
(0, node_test_1.default)('legacy strokes normalize to opaque pen strokes', () => {
    const document = (0, annotationDocument_1.sanitizeAnnotationDocument)({ strokes: [stroke] });
    strict_1.default.equal(document.strokes[0]?.kind, 'pen');
    strict_1.default.equal(document.strokes[0]?.opacity, 1);
    strict_1.default.deepEqual(document.strokes[0]?.points, stroke.points);
});
(0, node_test_1.default)('highlighter metadata is validated and pen strokes stay opaque', () => {
    const document = (0, annotationDocument_1.sanitizeAnnotationDocument)({
        strokes: [
            { ...stroke, id: 'highlighter', kind: 'highlighter', opacity: 0.45 },
            { ...stroke, id: 'default', kind: 'highlighter' },
            { ...stroke, id: 'low', kind: 'highlighter', opacity: -1 },
            { ...stroke, id: 'high', kind: 'highlighter', opacity: 3 },
            { ...stroke, id: 'invalid', kind: 'highlighter', opacity: 'half' },
            { ...stroke, id: 'pen', kind: 'pen', opacity: 0.2 },
            { ...stroke, id: 'unknown', kind: 'other', opacity: 0.2 },
        ],
    });
    strict_1.default.deepEqual(document.strokes.map(({ kind, opacity }) => [kind, opacity]), [
        ['highlighter', 0.45],
        ['highlighter', 0.3],
        ['highlighter', 0.1],
        ['highlighter', 1],
        ['highlighter', 0.3],
        ['pen', 1],
        ['pen', 1],
    ]);
});
//# sourceMappingURL=annotationDocument.test.js.map