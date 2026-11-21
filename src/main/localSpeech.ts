import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validSpeechWav } from '../shared/speechAudio.js';
import { speechLanguage, type SpeechLanguage } from '../shared/textToSpeech.js';

const ASSET_HASHES: Record<string, string> = {
  'bin/whisper-cli.exe': '95e3c0b0e778ad9499eb0125f97c1dcf437dd9eb4ea77050b043574f93c2631d',
  'bin/ggml-base.dll': '1482359d921b4c1b183d49db1d770f9b5e90d86a618b8b648d4845c2471ad6b0',
  'bin/ggml-cpu-alderlake.dll': 'd1c5411561361f7ce71ff8455ecf01f666f581b0608fa91a1dfe7d3fd6a25bd1',
  'bin/ggml-cpu-x64.dll': 'af0f1c2f28ff9e3f472481dd969907bda85fa39d4fde17617d4bb0b389301b60',
  'bin/ggml.dll': '894c6237ee7849843213906a2b6a0b371aaa6234048d465f206d910ae846fafb',
  'bin/whisper.dll': '792fc523c7ad16e6b9c348e30ad5e5f591165cbcf6a80ca8d0db02a38ce3eea2',
  'ggml-tiny.bin': 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
};

export const MINIMUM_ASR_AVAILABLE_BYTES = 1024 * 1048576;

function availableMemoryMessage(availableBytes: number | null): string {
  const action = 'Close unused apps or wait for memory to become available, then try again. Check Task Manager > Performance > Memory > Available.';
  if (availableBytes === null) {
    return `Local transcription paused: available memory could not be measured. This app requires at least 1,024 MiB available before starting. ${action}`;
  }
  const availableMiB = Math.floor(availableBytes / 1048576);
  return `Local transcription paused: ${availableMiB} MiB available; 1,024 MiB required by the current safety policy. ${action}`;
}

function readAvailableMemory(sample: () => number): number | null {
  try {
    const bytes = sample();
    // libuv may report zero when the OS query fails. Never treat uncertainty as spare RAM.
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export interface SpeechJob {
  transcribe: (wav: Uint8Array, language?: SpeechLanguage) => Promise<string>;
  cancel: () => void;
  waitForIdle: () => Promise<void>;
}

export function createLocalSpeechJob(options: {
  assetRoot: string;
  spawnProcess?: typeof spawn;
  verifyAssets?: () => Promise<void>;
  availableMemoryBytes?: () => number;
  timeoutMs?: number;
}): SpeechJob {
  const assetRoot = options.assetRoot;
  const launch = options.spawnProcess ?? spawn;
  let active: { cancelled: boolean; child: ChildProcess | null;
    finished: Promise<void>; finish: () => void } | null = null;

  return {
    cancel() {
      if (!active) return;
      active.cancelled = true;
      active.child?.kill();
    },
    async waitForIdle() {
      await active?.finished;
    },
    async transcribe(wav, language: SpeechLanguage = 'es') {
      if (active) throw new Error('A transcription is already running.');
      if (!validSpeechWav(wav)) throw new Error('Unsupported audio. Record up to 20 seconds.');
      const availableBytes = readAvailableMemory(options.availableMemoryBytes ?? os.freemem);
      if (availableBytes === null || availableBytes < MINIMUM_ASR_AVAILABLE_BYTES) {
        throw new Error(availableMemoryMessage(availableBytes));
      }
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const job = { cancelled: false, child: null as ChildProcess | null, finished, finish };
      active = job;
      let directory: string | null = null;
      try {
        if (options.verifyAssets) await options.verifyAssets();
        else await verifyAssets(assetRoot);
        if (job.cancelled) throw new Error('Transcription cancelled.');
        directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-companion-speech-'));
        const input = path.join(directory, 'recording.wav');
        await writeFile(input, wav, { flag: 'wx' });
        if (job.cancelled) throw new Error('Transcription cancelled.');
        const executable = path.join(assetRoot, 'bin', 'whisper-cli.exe');
        const model = path.join(assetRoot, 'ggml-tiny.bin');
        const child = launch(executable,
          ['-m', model, '-f', input, '-l', speechLanguage(language), '-t', '2', '-ng', '-nt'],
          { cwd: path.dirname(executable), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        job.child = child;
        if (job.cancelled) child.kill();
        const stdout = collect(child.stdout);
        const stderr = collect(child.stderr);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 30_000);
        let code: number | null;
        try {
          code = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
          });
        } finally {
          clearTimeout(timer);
        }
        if (job.cancelled) throw new Error('Transcription cancelled.');
        if (timedOut) throw new Error('Transcription timed out.');
        if (code !== 0) throw new Error('Local transcription process failed.');
        const transcript = stdout().replace(/\[[0-9:.]+ --> [0-9:.]+\]/g, '').trim();
        if (!transcript) throw new Error('No speech was recognized.');
        if (transcript.length > 2_000) throw new Error('Transcript exceeded the pilot limit.');
        void stderr; // Captured only to keep the pipe drained; never logged.
        return transcript;
      } catch (error) {
        if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('SHA-256'))) {
          throw new Error('Local Whisper assets are unavailable or failed verification.');
        }
        throw error;
      } finally {
        try {
          if (directory) await rm(directory, { recursive: true, force: true });
        } finally {
          active = null;
          job.finish();
        }
      }
    },
  };
}

async function verifyAssets(root: string): Promise<void> {
  for (const [name, expected] of Object.entries(ASSET_HASHES)) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(root, name))) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error('SHA-256 mismatch');
  }
}

function collect(stream: NodeJS.ReadableStream | null): () => string {
  let result = '';
  stream?.on('data', (chunk: Buffer) => { result = (result + chunk.toString('utf8')).slice(-16_384); });
  return () => result;
}
