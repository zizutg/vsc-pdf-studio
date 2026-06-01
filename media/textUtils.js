export function formatCommentDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function findTextNode(node) {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node;
  }

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSelectedText(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function slugify(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}
