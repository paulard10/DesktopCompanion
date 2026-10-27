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

const env = { ...process.env, DESKTOP_COMPANION_SMOKE: '1' };
delete env.DESKTOP_COMPANION_DEV;
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), '.'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env,
});

let output = '';
const timeout = setTimeout(() => {
  console.error(output);
  console.error('Smoke test timed out.');
  if (child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  process.exit(1);
}, 40_000);

function finish(code) {
  clearTimeout(timeout);
  const secondInstance = output.includes('desktop-companion: second-instance-exit');
  const started = output.includes('desktop-companion: process-started');
  const preload = output.includes('desktop-companion: preload=m1.6');
  const ready = output.includes('desktop-companion: frame-ready');
  const webgl = output.includes('desktop-companion: webgl ready');
  const webglError = /desktop-companion: webgl-(?:unavailable|render-failed|context-lost)/.test(output);
  const credential = output.includes('desktop-companion: credential-self-check=ok');
  const quitting = output.includes('desktop-companion: quitting');
  if (code !== 0 || secondInstance || !started || !preload || !ready || !webgl || webglError || !credential || !quitting) {
    console.error(output);
    console.error(
      `Smoke failed. exit=${code} second-instance=${secondInstance} started=${started} preload=${preload} frame-ready=${ready} webgl=${webgl} webgl-error=${webglError} credential=${credential} quitting=${quitting}`,
    );
    process.exit(code === 0 ? 1 : code ?? 1);
  }
  const webglLine = output.split(/\r?\n/).find(line => line.startsWith('desktop-companion: webgl ready'));
  console.log(webglLine);
  console.log('Smoke passed: new process, m1.6 preload, first WebGL frame, disposable credential check, clean exit.');
  process.exit(0);
}

child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});
child.on('exit', (code) => {
  finish(code);
});
