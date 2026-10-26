// Isolated development pilot; the Electron application never imports this file.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, readFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, freemem } from 'node:os';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '../.local-asr');
const bin = path.join(root, 'bin', 'whisper-cli.exe');
const model = path.join(root, 'ggml-tiny.bin');
const publicSample = path.join(root, 'es_1_16k.wav');
const consentedSample = path.join(root, 'consented.wav');
const naturalDir = path.join(root, 'natural');
const naturalNames = ['short', 'technical', 'long'];
const naturalReferences = path.join(naturalDir, 'references.json');
const monitor = path.join(scriptDir, 'asr-pilot-monitor.ps1');
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const hashes = {
  bin: '95e3c0b0e778ad9499eb0125f97c1dcf437dd9eb4ea77050b043574f93c2631d',
  model: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  sample: 'd777a456362fe5e430d690fd33b7c6cca8344a4520e5ae0ffbe3df21cbd37af9',
};
const dllHashes = {
  'ggml-base.dll': '1482359d921b4c1b183d49db1d770f9b5e90d86a618b8b648d4845c2471ad6b0',
  'ggml-cpu-alderlake.dll': 'd1c5411561361f7ce71ff8455ecf01f666f581b0608fa91a1dfe7d3fd6a25bd1',
  'ggml-cpu-x64.dll': 'af0f1c2f28ff9e3f472481dd969907bda85fa39d4fde17617d4bb0b389301b60',
  'ggml.dll': '894c6237ee7849843213906a2b6a0b371aaa6234048d465f206d910ae846fafb',
  'whisper.dll': '792fc523c7ad16e6b9c348e30ad5e5f591165cbcf6a80ca8d0db02a38ce3eea2',
};
const reference = 'El zorro marrón rápido salta sobre el perro perezoso.';

function options(argv) {
  const out = { threads: 2, timeoutMs: 30000, cancelAfterMs: null, sample: 'public', profile: null };
  for (const arg of argv) {
    const parts = arg.split('=');
    const [key, value] = parts;
    if (parts.length !== 2 || !value || !['--threads', '--timeout-ms', '--cancel-after-ms', '--sample', '--profile'].includes(key)) {
      throw new Error('Unsupported option: ' + key);
    }
    if (key === '--sample') {
      if (!['public', 'consented', ...naturalNames.map(name => 'natural-' + name)].includes(value)) {
        throw new Error('Sample must be public, consented, or one of the three natural clips');
      }
      out.sample = value;
      continue;
    }
    if (key === '--profile') {
      if (!['baseline', 'workload'].includes(value)) throw new Error('Profile must be baseline or workload');
      out.profile = value;
      continue;
    }
    const number = Number(value);
    if (!Number.isInteger(number)) throw new Error(key + ' must be an integer');
    if (key === '--threads' && (number < 1 || number > 4)) throw new Error('Threads must be 1–4');
    if (key === '--timeout-ms' && (number < 1000 || number > 120000)) throw new Error('Timeout must be 1000–120000 ms');
    if (key === '--cancel-after-ms' && (number < 1 || number > 120000)) throw new Error('Cancel delay must be 1–120000 ms');
    if (key === '--threads') out.threads = number;
    if (key === '--timeout-ms') out.timeoutMs = number;
    if (key === '--cancel-after-ms') out.cancelAfterMs = number;
  }
  if (out.sample.startsWith('natural-') && !out.profile) {
    throw new Error('Natural tests require --profile=baseline or --profile=workload');
  }
  return out;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verify(file, expected, label) {
  if (await hashFile(file) !== expected) throw new Error(label + ' SHA-256 mismatch; refusing to run');
}

function wavSeconds(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF/WAVE audio');
  let format = null;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error('Invalid WAV chunk length');
    if (name === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format');
      format = {
        codec: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        rate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22),
      };
    }
    if (name === 'data') dataBytes += size;
    offset += 8 + size + (size % 2);
  }
  if (!format || format.codec !== 1 || format.channels !== 1 ||
      format.rate !== 16000 || format.bits !== 16 || dataBytes === 0) {
    throw new Error('Expected 16 kHz mono 16-bit PCM WAV');
  }
  const duration = dataBytes / 32000;
  if (duration > 20 || buffer.length > 2_000_000) throw new Error('Audio exceeds 20-second pilot limit');
  return duration;
}

function words(text) {
  return text.toLocaleLowerCase('es').normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function accuracy(hypothesis, truth) {
  const expected = words(truth);
  const actual = words(hypothesis);
  const row = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let i = 1; i <= expected.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= actual.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + Number(expected[i - 1] !== actual[j - 1]));
      previous = old;
    }
  }
  return { reference: truth, edits: row[actual.length], referenceWords: expected.length,
    wordErrorRate: Number((row[actual.length] / expected.length).toFixed(3)) };
}

async function referenceFor(config) {
  if (config.sample === 'public') return reference;
  if (!config.sample.startsWith('natural-')) return null;
  const name = config.sample.slice('natural-'.length);
  const refs = JSON.parse(await readFile(naturalReferences, 'utf8'));
  if (!refs || typeof refs !== 'object' || typeof refs[name] !== 'string' ||
      refs[name].length < 2 || refs[name].length > 400 || words(refs[name]).length < 2) {
    throw new Error('Missing or invalid exact reference for ' + name);
  }
  return refs[name];
}

function cpuTotals() {
  return cpus().reduce((sum, cpu) => {
    for (const [name, value] of Object.entries(cpu.times)) sum[name] = (sum[name] ?? 0) + value;
    return sum;
  }, {});
}

function collect(stream, maxCharacters = 262144) {
  let data = '';
  stream.on('data', chunk => { data = (data + chunk.toString('utf8')).slice(-maxCharacters); });
  return () => data;
}

function startMonitor(pid) {
  const observer = spawn(powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', monitor, '-TargetPid', String(pid)],
    { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const output = collect(observer.stdout, 4096);
  const done = new Promise(resolve => {
    observer.on('error', () => resolve(null));
    observer.on('close', () => {
      try { resolve(JSON.parse(output())); } catch { resolve(null); }
    });
  });
  return async () => {
    const guard = setTimeout(() => observer.kill(), 3000);
    try { return await done; } finally { clearTimeout(guard); }
  };
}

async function transcribe(config, audio, duration, truth) {
  const args = ['-m', model, '-f', audio, '-l', 'es', '-t', String(config.threads), '-ng', '-nt'];
  const freeBeforeMiB = freemem() / 1048576;
  const cpuBefore = cpuTotals();
  const start = performance.now();
  const child = spawn(bin, args, {
    cwd: path.dirname(bin), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const finishMonitor = child.pid ? startMonitor(child.pid) : async () => null;
  let reason = null;
  const stop = why => { reason ??= why; if (!child.killed) child.kill(); };
  const deadline = setTimeout(() => stop('timed out'), config.timeoutMs);
  const cancel = config.cancelAfterMs == null ? null : setTimeout(() => stop('cancelled'), config.cancelAfterMs);
  const onSignal = () => stop('cancelled by user');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(deadline);
    if (cancel) clearTimeout(cancel);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  const elapsedMs = performance.now() - start;
  const cpuAfter = cpuTotals();
  const freeAfterMiB = freemem() / 1048576;
  const usage = await finishMonitor();
  const monitorSettleMs = performance.now() - start - elapsedMs;
  if (reason) throw new Error('Transcription ' + reason + '; helper exit ' + exitCode);
  if (exitCode !== 0) throw new Error('whisper-cli exited ' + exitCode + ': ' + stderr().slice(-1500));
  const transcript = stdout().replace(/\[[0-9:.]+ --> [0-9:.]+\]/g, '').trim();
  const load = stderr().match(/load time\s*=\s*([\d.]+)\s*ms/i);
  const totalTicks = Object.keys(cpuAfter).reduce((sum, key) => sum + cpuAfter[key] - cpuBefore[key], 0);
  const idleTicks = cpuAfter.idle - cpuBefore.idle;
  return {
    sample: config.sample,
    profile: config.profile,
    inputSeconds: Number(duration.toFixed(3)),
    threads: config.threads,
    availableRamBeforeMiB: Math.round(freeBeforeMiB),
    availableRamAfterMiB: Math.round(freeAfterMiB),
    totalMs: Math.round(elapsedMs),
    monitorSettleMs: Math.round(monitorSettleMs),
    engineReportedLoadMs: load ? Number(load[1]) : null,
    peakWorkingSetMiB: usage?.sampleCount ? Number((usage.peakWorkingSetBytes / 1048576).toFixed(1)) : null,
    peakPrivateMiB: usage?.sampleCount ? Number((usage.peakPrivateBytes / 1048576).toFixed(1)) : null,
    cpuTimeMs: usage?.sampleCount ? usage.cpuTimeMs : null,
    approximateCpuPercentOfMachine: usage?.sampleCount
      ? Number((100 * usage.cpuTimeMs / elapsedMs / cpus().length).toFixed(1)) : null,
    observedSystemCpuBusyPercent: totalTicks > 0 ? Number((100 * (1 - idleTicks / totalTicks)).toFixed(1)) : null,
    memorySamples: usage?.sampleCount ?? 0,
    transcript,
    ...(truth ? accuracy(transcript, truth) : {}),
  };
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 only');
  const config = options(process.argv.slice(2));
  const sample = config.sample === 'public' ? publicSample
    : config.sample === 'consented' ? consentedSample
    : path.join(naturalDir, config.sample.slice('natural-'.length) + '.wav');
  let disposable = null;
  let result = null;
  let tempCleanupMs = null;
  try {
    await verify(bin, hashes.bin, 'Executable');
    for (const [name, hash] of Object.entries(dllHashes)) {
      await verify(path.join(path.dirname(bin), name), hash, name);
    }
    await verify(model, hashes.model, 'Multilingual Tiny model');
    if (config.sample === 'public') await verify(sample, hashes.sample, 'Public Spanish sample');
    const truth = await referenceFor(config);
    const duration = wavSeconds(await readFile(sample));
    if (config.sample === 'public') {
      disposable = path.join(root, 'pilot-' + randomUUID() + '.wav');
      await copyFile(sample, disposable);
    }
    result = await transcribe(config, disposable ?? sample, duration, truth);
  } finally {
    if (disposable) {
      const cleanupStart = performance.now();
      await unlink(disposable).catch(error => { if (error.code !== 'ENOENT') throw error; });
      tempCleanupMs = Math.round(performance.now() - cleanupStart);
    }
  }
  console.log(JSON.stringify({ ...result, tempCleanupMs }, null, 2));
}

export { accuracy, options, wavSeconds };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
