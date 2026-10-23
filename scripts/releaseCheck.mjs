import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function run(script, args = []) {
  console.log(`\n> npm run ${script} ${args.join(' ')}`);
  const child = spawn(npm, ['run', script, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(exitCode, 0, `${script} failed`);
}

function checklistItems(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^- \[([ xX])\] (.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      checked: match[1].toLowerCase() === 'x',
      text: match[2],
    }));
}

async function checkChecklist() {
  const template = checklistItems(
    await readFile(
      path.join(root, 'docs/release-checklist-template.md'),
      'utf8'
    )
  );
  const local = checklistItems(
    await readFile(path.join(root, '.release-checklist.local.md'), 'utf8')
  );
  for (const item of template) {
    assert.ok(
      local.some(
        (candidate) => candidate.text === item.text && candidate.checked
      ),
      `Release checklist item not checked: ${item.text}`
    );
  }
}

if (process.argv.includes('--checklist-only')) {
  await checkChecklist();
  console.log('Local release checklist is complete.');
} else {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  );
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.equal(
    /^## (.+)$/m.exec(changelog)?.[1],
    manifest.version,
    'The first changelog section must match the release version.'
  );
  const icon = await stat(path.join(root, manifest.icon));
  assert.ok(icon.size <= 1024 * 1024, 'Marketplace icon exceeds 1024 KB.');

  await run('check');
  await run('test:private');
  await run('test:integration');
  await run('check:performance');

  const candidateDir = path.join(root, '.vscode-test');
  await mkdir(candidateDir, { recursive: true });
  const vsix = path.join(candidateDir, 'release-candidate.vsix');
  await run('package', ['--', '--out', vsix]);
  assert.ok((await stat(vsix)).size > 0, 'Release VSIX is missing.');

  await checkChecklist();
  console.log(`Release gate passed for ${manifest.name} ${manifest.version}.`);
}
