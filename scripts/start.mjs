import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainFile = path.join(root, 'dist', 'main', 'main.js');

if (!existsSync(mainFile)) {
  console.error('Build output is missing. Run npm run build first.');
  process.exit(1);
}

const env = { ...process.env };
delete env.DESKTOP_COMPANION_DEV;
delete env.ELECTRON_RUN_AS_NODE;
delete env.DESKTOP_COMPANION_SMOKE;

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), '.'], {
  cwd: root,
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
