# Changelog

## 0.0.3

- Reduced packaged extension size by trimming shipped runtime dependency files without changing functionality
- Collapsed open comment views and cleared empty comment composers when switching to other tools

## 0.0.2

- Improved default PDF text clarity on Retina/high-DPI displays
- Limited undo/redo session history to the 30 most recent states
- Reduced redundant annotation cloning on the save path
- Removed unnecessary local source-path exposure from webview bootstrap markup
- Added a toolbar toggle for single-page and two-page document layouts
- Refined toolbar responsiveness with staged compaction and controlled multi-row wrapping
- Saved comments as native PDF text annotations for compatibility with Adobe and other PDF viewers
- Synced external PDF comment edits back into PDF Studio on reopen
- Moved Studio comment storage to native PDF comments as the primary source of truth
- Added a global show-all-comments toggle and made it contextual to comment mode
- Improved comment popup and composer placement, including two-page layout behavior
- Polished comment action buttons and comment-toolbar ordering

## 0.0.1

- Initial public PDF Studio
- Custom PDF editor for VS Code
- Freehand annotation, highlight, comment, search, and navigation support
- Auto-save back into the source PDF
