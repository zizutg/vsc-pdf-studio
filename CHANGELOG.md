# Changelog

## Unreleased

- Replaced feature-specific color swatch access with one shared toolbar color button for all color-aware tools
- Added a Strike Out action to the selection mini toolbar and imported native StrikeOut annotations
- Added an Underline action to the selection mini toolbar before Bookmark
- Added a Bookmark action to the selection mini toolbar for quick Studio bookmark creation
- Made Studio bookmark add/remove participate in undo/redo and insert new bookmarks in page/position order
- Surfaced external PDF outline entries as first-class bookmarks in Studio navigation, with clearer labeling and page metadata
- Added native PDF AcroForm filling for existing text fields, checkboxes, radio groups, dropdowns, and option lists
- Saved supported form values back through standard PDF form mechanisms for compatibility with other PDF editors and readers
- Added signer-aware handling for full name, email, and date text fields in supported PDF forms
- Added native PDF button-field recognition and visible button rendering
- Added safe native PDF button actions for ResetForm, HTTP(S) SubmitForm, and mailto targets
- Broadened native button action detection to cover more PDF button event dictionaries and standard URI link actions
- Stopped Studio from recreating replacement PDF button widgets during form-base rebuilds, preserving native button behavior more reliably
- Reset form actions now use the PDF field defaults instead of Studio's opened-session snapshot, improving cross-editor reset behavior
- Limited native comment sync to Studio-managed PDF comments so external editor round-trips stop creating stray comment markers

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
