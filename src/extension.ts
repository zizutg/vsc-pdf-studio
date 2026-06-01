import * as vscode from 'vscode';
import { PDF_STUDIO_VIEW_TYPE } from './constants';
import { PdfEditorProvider } from './PdfEditorProvider';
import { SaveManager } from '../storage/saveManager';

export function activate(context: vscode.ExtensionContext): void {
  const saveManager = new SaveManager();
  const provider = new PdfEditorProvider(context, saveManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('pdfStudio.setCommentAuthor', async () => {
      const config = vscode.workspace.getConfiguration('pdfStudio');
      const currentAuthor = config.get<string>('commentAuthor') ?? '';
      const nextAuthor = await vscode.window.showInputBox({
        title: 'PDF Studio: Set Comment Author',
        prompt:
          'Enter the author name to write into native PDF comments. Leave empty to use the OS username fallback.',
        placeHolder:
          currentAuthor || 'Leave empty to use the OS username fallback',
        value: currentAuthor,
        ignoreFocusOut: true,
      });

      if (typeof nextAuthor !== 'string') {
        return;
      }

      await config.update(
        'commentAuthor',
        nextAuthor.trim(),
        vscode.ConfigurationTarget.Global
      );
      const message = nextAuthor.trim()
        ? `PDF Studio comment author set to "${nextAuthor.trim()}".`
        : 'PDF Studio comment author cleared. OS username fallback will be used.';
      void vscode.window.showInformationMessage(message);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pdfStudio.commentAuthor')) {
        void provider.notifyCommentAuthorChanged();
      }
    }),
    vscode.window.registerCustomEditorProvider(PDF_STUDIO_VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );
}

export function deactivate(): void {}
