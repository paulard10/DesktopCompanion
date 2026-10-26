import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${args.join(' ')} exited with ${code}`));
    });
  });
}

const tsc = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');
await runNode([tsc, '-p', 'tsconfig.node.json']);
await runNode([tsc, '-p', 'tsconfig.preload.json']);

const server = await createServer({
  configFile: path.join(root, 'vite.config.mts'),
});
await server.listen();

const env = { ...process.env, DESKTOP_COMPANION_DEV: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DESKTOP_COMPANION_SMOKE;

const electron = spawn(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), '.'], {
  cwd: root,
  stdio: 'inherit',
  env,
});

let closing = false;

async function stop(code) {
  if (closing) {
    return;
  }
  closing = true;
  if (electron.exitCode === null && !electron.killed) {
    electron.kill();
  }
  await server.close();
  process.exit(code);
}

electron.on('exit', (code) => {
  void stop(code ?? 0);
});

process.on('SIGINT', () => {
  void stop(0);
});
process.on('SIGTERM', () => {
  void stop(0);
});
