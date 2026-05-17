import * as vscode from 'vscode';
import { PDF_STUDIO_VIEW_TYPE } from './constants';
import { PdfEditorProvider } from './PdfEditorProvider';
import { SaveManager } from '../storage/saveManager';

export function activate(context: vscode.ExtensionContext): void {
  const saveManager = new SaveManager();
  const provider = new PdfEditorProvider(context, saveManager);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PDF_STUDIO_VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );
}

export function deactivate(): void {}
