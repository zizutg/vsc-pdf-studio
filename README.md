# PDF Studio

PDF Studio is a VS Code custom editor for reviewing and annotating PDF files without leaving the editor.

![PDF Studio demo](https://raw.githubusercontent.com/zizutg/vsc-pdf-studio/master/demo.png)

![PDF Studio workflow demo](https://raw.githubusercontent.com/zizutg/vsc-pdf-studio/master/demo.gif)

## Features

- Opens `*.pdf` files inside a custom PDF editor in VS Code
- Freehand annotation with color and width controls
- Text selection, inline highlight, and comment workflows
- Search, page navigation, and PDF outline/bookmark navigation
- Clickable PDF hyperlinks in Select mode, including websites, email links, and destinations within the document
- Undo and redo support
- Auto-save directly back into the PDF file

## How It Works

- PDF pages are rendered in a local webview using vendored `pdf.js` assets
- Annotations are embedded back into the PDF for compatibility with other PDF readers
- Extension-managed annotation data is also embedded in the PDF so Studio can restore editable state on reopen

## Settings

- **Opening PDFs:** Documents open at Page Width zoom with both side panels collapsed. Use the toolbar to open either panel or change the zoom.

- **Annotation tools:** Use the rightmost toolbar button to open or collapse the Tools panel. Choose a preset or any custom color; pen size is always available and applies to new pen strokes. The color-chip button also opens the panel. On narrow windows, the panel overlays the PDF instead of reducing its width.

- **Comment author:** Open the Command Palette and run `PDF Studio: Set Comment Author` to set the name written into PDF comments.

- **Finger drawing:** Enable `PDF Studio: Allow Finger Drawing` in VS Code Settings, or run `PDF Studio: Toggle Finger Drawing` from the Command Palette. It is disabled by default so fingers scroll the document while a pen or mouse draws and erases annotations.

## Current Limitations

- The editor is optimized for review and markup workflows, not full PDF text editing
- Saved comments/highlights are rendered into the PDF for external-reader compatibility
- Comment/search/selection behavior depends on the embedded text layer of the source PDF; scanned image PDFs may not behave like text PDFs
- Clickable links require hyperlink annotations in the PDF; plain URL text is not automatically converted into a link

## Git Tracking

If you want to track PDF revisions in Git, configure your repository with an appropriate `.gitattributes` setup for PDF files.

- PDF Studio writes changes back into the PDF itself, but version tracking and diff strategy are still handled by Git rather than by the extension.

For standard Git tracking, add this to `.gitattributes`:

```gitattributes
*.pdf binary
```

If your repository uses Git LFS for large binary files, use this instead:

```gitattributes
*.pdf filter=lfs diff=lfs merge=lfs -text
```

This ensures PDFs are tracked as binary assets. It does not create human-readable PDF diffs by itself; it only tells Git how to store and treat the files.

## Development

```bash
npm install
npm run compile
```

If you update `pdfjs-dist`, refresh the vendored frontend assets with:

```bash
npm run sync:pdfjs
```
