# Release Checklist (Copy to `.release-checklist.local.md`)

- [ ] Tested the exact candidate VSIX, not only the source in F5.
- [ ] Opened a PDF with Studio annotations; draw, highlight, comment, erase, undo/redo, save, close, and reopen still work.
- [ ] Opened real Acrobat and Foxit fixtures in Studio; shapes, comments, markup, forms, links, and bookmarks that exist in each remain visible.
- [ ] Edited in Acrobat/Foxit, reopened in Studio, saved, and reopened in the original app; no annotation duplication or missing appearances.
- [ ] Tested form values and reset in Studio and another PDF reader.
- [ ] Checked toolbar, color, search, zoom, panels, mouse, touch, and pen on applicable devices.
- [ ] Reviewed drawing and save benchmark timings against the recorded baselines; investigated material regressions.
- [ ] Tested macOS and Windows, or recorded which platform could not be tested before release.
- [ ] Confirmed package version, changelog, VSIX icon size, and package contents.
