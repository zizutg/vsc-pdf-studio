import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { emptyAnnotationDocument, type AnnotationDocument } from '../models/annotation';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from './messaging';
import { SaveManager } from '../storage/saveManager';

export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'pdfAnnotator.editor';

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly saveManager: SaveManager
  ) {}

  public async openCustomDocument(
    uri: vscode.Uri
  ): Promise<vscode.CustomDocument> {
    await this.saveManager.getPdfBytes(uri);

    return {
      uri,
      dispose: () => {
        this.saveManager.disposeSession(uri);
      }
    };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready': {
          await this.postInitialState(document.uri, webviewPanel.webview);
          break;
        }
        case 'annotationsChanged': {
          await this.handleAnnotationSave(document.uri, message.payload.annotations, webviewPanel.webview);
          break;
        }
      }
    });
  }

  private async postInitialState(uri: vscode.Uri, webview: vscode.Webview): Promise<void> {
    try {
      const pdfBuffer = await this.saveManager.getPdfBytes(uri);

      const message: ExtensionToWebviewMessage = {
        type: 'init',
        payload: {
          fileName: path.basename(uri.fsPath),
          pdfBase64: Buffer.from(pdfBuffer).toString('base64'),
          annotations: emptyAnnotationDocument()
        }
      };

      webview.postMessage(message);
    } catch (error) {
      await this.postError(webview, error);
    }
  }

  private async handleAnnotationSave(
    uri: vscode.Uri,
    annotations: AnnotationDocument,
    webview: vscode.Webview
  ): Promise<void> {
    try {
      await this.saveManager.save(uri, annotations);

      const message: ExtensionToWebviewMessage = {
        type: 'saved',
        payload: {
          savedAt: new Date().toISOString()
        }
      };

      webview.postMessage(message);
    } catch (error) {
      await this.postError(webview, error);
    }
  }

  private async postError(webview: vscode.Webview, error: unknown): Promise<void> {
    const message: ExtensionToWebviewMessage = {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    };

    await webview.postMessage(message);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const toWebviewUri = (segments: string[]): string =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...segments))
        .toString();

    const indexHtmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.html');

    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource} blob:; font-src ${webview.cspSource};">`,
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `  <link rel="stylesheet" href="${toWebviewUri(['media', 'styles.css'])}" />`,
      `  <script nonce="${nonce}" src="${toWebviewUri(['media', 'libs', 'pdf.worker.min.js'])}"></script>`,
      `  <script nonce="${nonce}" src="${toWebviewUri(['media', 'libs', 'pdf.min.js'])}"></script>`,
      '</head>',
      '<body>',
      '  <div id="app"></div>',
      `  <script nonce="${nonce}" type="module" src="${toWebviewUri(['media', 'main.js'])}"></script>`,
      `  <!-- Source scaffold: ${indexHtmlPath.fsPath} -->`,
      '</body>',
      '</html>'
    ].join('\n');

    return html;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}
