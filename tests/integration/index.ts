import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PDFDocument } from 'pdf-lib';
import { PDF_STUDIO_VIEW_TYPE } from '../../src/constants';

export async function run(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-host-'));
  const pdfPath = path.join(tempDir, 'host-smoke.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  await fs.writeFile(pdfPath, await pdf.save());

  try {
    const uri = vscode.Uri.file(pdfPath);
    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      PDF_STUDIO_VIEW_TYPE
    );
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(activeTab?.input instanceof vscode.TabInputCustom);
    assert.equal(activeTab.input.viewType, PDF_STUDIO_VIEW_TYPE);
    assert.equal(activeTab.input.uri.fsPath, uri.fsPath);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('pdfStudio.setCommentAuthor'));
    assert.ok(commands.includes('pdfStudio.toggleFingerDrawing'));
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
