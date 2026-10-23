# Quality Gates

## Change Gate

1. Add a regression test that fails before a bug fix. For new features, test the neighboring behavior that must not change.
2. Run `npm run check` before merging. It compiles, lints, checks formatting, runs the Node tests, and checks drawing operation budgets against the recorded baseline.
3. For changes to extension activation, document loading, or webview bootstrap, run `npm run test:integration` in a VS Code Extension Development Host.
4. For rendering, save, or compatibility changes, run `npm run test:private` with real Acrobat/Foxit fixtures. These files are never committed.
5. For drawing or save optimizations, run `npm run benchmark:drawing` and `npm run benchmark:save` locally and review timings against the recorded baselines. Timing results are informative; deterministic drawing operation counts, pixel checks, save-state invariants, and repeated-save growth are automated gates.

## Private PDF Fixtures

Place PDFs in `tests/fixtures/private/` and create `manifest.json` there:

```json
{
  "fixtures": [
    {
      "file": "adobe-mixed.pdf",
      "source": "Acrobat",
      "shapeCounts": [2, 0]
    },
    {
      "file": "foxit-mixed.pdf",
      "source": "Foxit",
      "shapeCounts": [1]
    }
  ]
}
```

`shapeCounts` has one entry per page, so a zero count is meaningful. The test copies each file to a temporary directory, opens it through `SaveManager`, checks PDF.js display annotations, saves and reopens the copy, and verifies shape counts and form field names. Originals remain untouched. Include at least one PDF with existing Studio ink plus subsequently added third-party shapes, one with external comments/markup, and one with forms. Do not commit PDFs containing private data.

## Release Gate

The actual checklist is `.release-checklist.local.md`, ignored by Git. Its template is in `docs/release-checklist-template.md`. `npm run release:check` runs automated checks, requires private fixtures and a versioned changelog heading, packages into the ignored `.vscode-test/release-candidate.vsix`, and refuses to pass until every checklist item is checked. It does not publish anything or overwrite the prior versioned VSIX.

CI runs Node checks and Extension Development Host smoke tests on macOS and Windows. Host tests confirm editor activation and opening, not visual fidelity or Adobe/Foxit behavior. Manual cross-editor checks remain required for release.
