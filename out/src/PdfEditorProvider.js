"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfEditorProvider = void 0;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const annotation_1 = require("../models/annotation");
class PdfEditorProvider {
    context;
    saveManager;
    static viewType = 'pdfAnnotator.editor';
    constructor(context, saveManager) {
        this.context = context;
        this.saveManager = saveManager;
    }
    async openCustomDocument(uri) {
        await this.saveManager.getPdfBytes(uri);
        return {
            uri,
            dispose: () => {
                this.saveManager.disposeSession(uri);
            }
        };
    }
    async resolveCustomEditor(document, webviewPanel) {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
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
    async postInitialState(uri, webview) {
        try {
            const pdfBuffer = await this.saveManager.getPdfBytes(uri);
            const message = {
                type: 'init',
                payload: {
                    fileName: path.basename(uri.fsPath),
                    pdfBase64: Buffer.from(pdfBuffer).toString('base64'),
                    annotations: (0, annotation_1.emptyAnnotationDocument)()
                }
            };
            webview.postMessage(message);
        }
        catch (error) {
            await this.postError(webview, error);
        }
    }
    async handleAnnotationSave(uri, annotations, webview) {
        try {
            await this.saveManager.save(uri, annotations);
            const message = {
                type: 'saved',
                payload: {
                    savedAt: new Date().toISOString()
                }
            };
            webview.postMessage(message);
        }
        catch (error) {
            await this.postError(webview, error);
        }
    }
    async postError(webview, error) {
        const message = {
            type: 'error',
            payload: {
                message: error instanceof Error ? error.message : 'Unknown error'
            }
        };
        await webview.postMessage(message);
    }
    getHtmlForWebview(webview) {
        const nonce = getNonce();
        const toWebviewUri = (segments) => webview
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
            `  <script nonce="${nonce}" src="${toWebviewUri(['media', 'libs', 'pdf_viewer.js'])}"></script>`,
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
exports.PdfEditorProvider = PdfEditorProvider;
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < 32; index += 1) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
}
//# sourceMappingURL=PdfEditorProvider.js.map