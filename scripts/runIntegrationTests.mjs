import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = {
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'out/tests/integration/index.js'),
  launchArgs: ['--disable-extensions'],
};
try {
  const executable =
    process.env.VSCODE_EXECUTABLE_PATH ||
    (await downloadAndUnzipVSCode({ extensionDevelopmentPath: root }));
  const macExecutable =
    process.platform === 'darwin' && executable.endsWith('/Electron')
      ? path.join(path.dirname(executable), 'Code')
      : null;
  options.vscodeExecutablePath =
    !existsSync(executable) && macExecutable && existsSync(macExecutable)
      ? macExecutable
      : executable;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_') || key === 'ELECTRON_RUN_AS_NODE') {
      delete process.env[key];
    }
  }
  const write = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    return write(chunk, ...args);
  };
  await runTests(options);
  if (output.includes('Webview is disposed:')) {
    throw new Error(
      'Closing the PDF editor accessed an already disposed webview.'
    );
  }
} catch (error) {
  console.error('Extension Development Host smoke test failed:', error);
  process.exitCode = 1;
}
