// M1.8B.0 voice inventory + optional Chromium measurement. Isolated from the app.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freemem, totalmem } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const inventory = path.join(here, 'tts-voice-inventory.ps1');
const electronMain = path.join(here, 'tts-pilot-electron.mjs');
const html = path.join(here, 'tts-pilot.html');
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

const mode = process.argv[2] ?? 'inventory';
if (mode === 'inventory') {
  const { stdout } = await run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', inventory]);
  process.stdout.write(stdout);
} else if (mode === 'measure') {
  const beforeFree = freemem();
  const started = Date.now();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await run(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), electronMain, '--headless', '--autoplay'], env);
  const elapsed = Date.now() - started;
  const afterFree = freemem();
  process.stdout.write(JSON.stringify({
    mode: 'chromium-autoplay',
    elapsedMs: elapsed,
    freememBeforeMiB: Math.floor(beforeFree / 1048576),
    freememAfterMiB: Math.floor(afterFree / 1048576),
    log: (stdout + stderr).split(/\r?\n/).filter((line) => line.includes('tts-pilot:')),
  }, null, 2));
} else if (mode === 'verify-files') {
  const text = await readFile(html, 'utf8');
  if (text.includes('document.getElementById(\'play\').click()') && !text.includes('DOMContentLoaded')) {
    throw new Error('pilot must not auto-play on load');
  }
  process.stdout.write('tts-pilot files ok\n');
} else {
  throw new Error('Usage: node scripts/tts-pilot.mjs [inventory|measure|verify-files]');
}
