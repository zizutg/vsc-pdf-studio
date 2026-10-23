import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const testPath = path.join(root, 'out/tests/privateFixtures.test.js');
const child = spawn(process.execPath, ['--test', testPath], {
  cwd: root,
  env: { ...process.env, REQUIRE_PRIVATE_FIXTURES: '1' },
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
