import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnnotationDocument } from '../src/validation/annotationDocument';

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

test('legacy strokes normalize to opaque pen strokes', () => {
  const document = sanitizeAnnotationDocument({ strokes: [stroke] });
  assert.equal(document.strokes[0]?.kind, 'pen');
  assert.equal(document.strokes[0]?.opacity, 1);
  assert.deepEqual(document.strokes[0]?.points, stroke.points);
});

test('highlighter metadata is validated and pen strokes stay opaque', () => {
  const document = sanitizeAnnotationDocument({
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
  assert.deepEqual(
    document.strokes.map(({ kind, opacity }) => [kind, opacity]),
    [
      ['highlighter', 0.45],
      ['highlighter', 0.3],
      ['highlighter', 0.1],
      ['highlighter', 1],
      ['highlighter', 0.3],
      ['pen', 1],
      ['pen', 1],
    ]
  );
});
