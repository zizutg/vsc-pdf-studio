# PDF Studio

VS Code extension scaffold for opening a PDF in a custom editor, drawing freehand annotations across multiple pages, and saving those annotations directly into the PDF after the user stops drawing.

## Current behavior

- Opens `*.pdf` files with a custom editor.
- Renders all PDF pages in the webview using a vendored local `pdf.js` bundle.
- Draws freehand annotations on a page overlay.
- Auto-saves directly into the same PDF file for compatibility with other PDF readers.

## Notes

- The extension does not create sidecar JSON files or base-copy PDFs.
- Saved annotations are flattened into the PDF and are not reloaded as editable strokes.
- If you update `pdfjs-dist`, run `npm run sync:pdfjs` to refresh the vendored files in `media/libs/`.

## Development

```bash
npm install
npm run compile
```
