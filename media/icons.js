function createLucideIcon(paths, attrs = '') {
  return `
    <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${attrs}>
      ${paths}
    </svg>
  `;
}

export const icons = {
  minus: createLucideIcon('<path d="M5 12h14" />'),
  plus: createLucideIcon('<path d="M12 5v14" /><path d="M5 12h14" />'),
  pen: createLucideIcon(
    '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />'
  ),
  highlighter: createLucideIcon(
    '<path d="m9 11-6 6v3h9l6-6" /><path d="m22 12-4-4" /><path d="M8 16l-2-2" />'
  ),
  underline: createLucideIcon(
    '<path d="M6 4v6a6 6 0 0 0 12 0V4" /><path d="M4 20h16" />'
  ),
  strikeout: createLucideIcon(
    '<path d="M6 4v2a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v2" /><path d="M4 12h16" />'
  ),
  comment: createLucideIcon(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h8" /><path d="M8 7h6" />'
  ),
  commentsExpanded: createLucideIcon(
    '<path d="M4 5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 4z" /><path d="M14 9h5a2 2 0 0 1 2 2v8l-3-3h-4" />'
  ),
  search: createLucideIcon(
    '<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />'
  ),
  layoutDouble: createLucideIcon(
    '<rect x="3" y="5" width="7" height="14" rx="1.5" /><rect x="14" y="5" width="7" height="14" rx="1.5" />'
  ),
  layoutSingle: createLucideIcon(
    '<rect x="6" y="5" width="12" height="14" rx="1.5" />'
  ),
  pointer: createLucideIcon(
    '<path d="m4 4 7.5 18 2.5-7 7-2.5L4 4Z" /><path d="m13 13 6 6" />'
  ),
  eraser: createLucideIcon(
    '<path d="m7 21 10.6-10.6a2 2 0 0 0 0-2.8l-3.2-3.2a2 2 0 0 0-2.8 0L1 15" /><path d="m5 11 8 8" /><path d="M22 21H7" />'
  ),
  undo: createLucideIcon(
    '<path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 1 1 0 14h-1" />'
  ),
  redo: createLucideIcon(
    '<path d="m15 14 5-5-5-5" /><path d="M20 9h-9a7 7 0 1 0 0 14h1" />'
  ),
  menu: createLucideIcon(
    '<path d="M4 12h16" /><path d="M4 6h16" /><path d="M4 18h16" />'
  ),
  floppy: createLucideIcon(
    '<path d="M4 7a2 2 0 0 1 2-2h9l5 5v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M10 5v4h4" /><path d="M8 19v-6h8v6" />'
  ),
  close: createLucideIcon('<path d="m18 6-12 12" /><path d="m6 6 12 12" />'),
  trash: createLucideIcon(
    '<path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />'
  ),
  edit: createLucideIcon(
    '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />'
  ),
  copy: createLucideIcon(
    '<rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />'
  ),
  bookmark: createLucideIcon(
    '<path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1Z" />'
  ),
  sidebar: createLucideIcon('<path d="M4 5h16v14H4z" /><path d="M9 5v14" />'),
  chevronLeft: createLucideIcon(
    '<path d="m15 18-6-6 6-6" />',
    'stroke-width="2.25"'
  ),
  chevronRight: createLucideIcon(
    '<path d="m9 18 6-6-6-6" />',
    'stroke-width="2.25"'
  ),
  chevronDown: createLucideIcon(
    '<path d="m6 9 6 6 6-6" />',
    'stroke-width="2.25"'
  ),
};
