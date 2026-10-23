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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const pdf_lib_1 = require("pdf-lib");
const constants_1 = require("../../src/constants");
async function run() {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-studio-host-'));
    const pdfPath = path.join(tempDir, 'host-smoke.pdf');
    const pdf = await pdf_lib_1.PDFDocument.create();
    pdf.addPage([400, 500]);
    await fs.writeFile(pdfPath, await pdf.save());
    try {
        const uri = vscode.Uri.file(pdfPath);
        await vscode.commands.executeCommand('vscode.openWith', uri, constants_1.PDF_STUDIO_VIEW_TYPE);
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        strict_1.default.ok(activeTab?.input instanceof vscode.TabInputCustom);
        strict_1.default.equal(activeTab.input.viewType, constants_1.PDF_STUDIO_VIEW_TYPE);
        strict_1.default.equal(activeTab.input.uri.fsPath, uri.fsPath);
        const commands = await vscode.commands.getCommands(true);
        strict_1.default.ok(commands.includes('pdfStudio.setCommentAuthor'));
        strict_1.default.ok(commands.includes('pdfStudio.toggleFingerDrawing'));
    }
    finally {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
//# sourceMappingURL=index.js.map