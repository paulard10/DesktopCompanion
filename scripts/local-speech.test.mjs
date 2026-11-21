import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLocalSpeechJob, MINIMUM_ASR_AVAILABLE_BYTES } from '../dist/main/localSpeech.js';
import { pcmWav } from '../dist/shared/speechAudio.js';

function fakeProcess(onLaunch) {
  return (exe, args, settings) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('close', null));
      return true;
    };
    onLaunch(child, exe, args, settings);
    return child;
  };
}

function job(spawnProcess, more = {}) {
  return createLocalSpeechJob({
    assetRoot: path.join(os.tmpdir(), 'fixed-speech-assets'),
    verifyAssets: async () => {},
    availableMemoryBytes: () => MINIMUM_ASR_AVAILABLE_BYTES + 1,
    spawnProcess,
    ...more,
  });
}
const wav = pcmWav([new Float32Array(1600).fill(0.1)], 1600);

test('fixed Spanish CLI args, one process, private WAV cleanup and no shell', async () => {
  let input = '';
  let launches = 0;
  const speech = job(fakeProcess((child, exe, args, settings) => {
    launches++;
    assert.match(exe, /whisper-cli.exe$/);
    assert.equal(settings.shell, false);
    assert.deepEqual(args.slice(4), ['-l', 'es', '-t', '2', '-ng', '-nt']);
    input = args[3];
    assert.equal(existsSync(input), true);
    setImmediate(() => {
      child.stdout.write('[00:00:00.000 --> 00:00:00.100] Hola mundo\n');
      child.emit('close', 0);
    });
  }));
  const first = speech.transcribe(wav);
  await assert.rejects(speech.transcribe(wav), /already running/);
  assert.equal(await first, 'Hola mundo');
  assert.equal(launches, 1);
  assert.equal(existsSync(input), false);
  assert.equal(existsSync(path.dirname(input)), false);
});

test('English and automatic language stay inside the fixed CLI allowlist', async () => {
  const seen = [];
  const speech = job(fakeProcess((child, _exe, args) => {
    seen.push(args[5]);
    setImmediate(() => {
      child.stdout.write('[00:00:00.000 --> 00:00:00.100] Hello\n');
      child.emit('close', 0);
    });
  }));
  assert.equal(await speech.transcribe(wav, 'en'), 'Hello');
  assert.equal(await speech.transcribe(wav, 'auto'), 'Hello');
  assert.equal(await speech.transcribe(wav, 'fr'), 'Hello');
  assert.deepEqual(seen, ['en', 'auto', 'es']);
});

test('failure and cancellation remove application-created audio', async () => {
  let input = '';
  const failed = job(fakeProcess((child, _exe, args) => {
    input = args[3];
    setImmediate(() => child.emit('close', 1));
  }));
  await assert.rejects(failed.transcribe(wav), /process failed/);
  assert.equal(existsSync(input), false);
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const cancelled = job(fakeProcess((child, _exe, args) => {
    input = args[3];
    started(child);
  }));
  const pending = cancelled.transcribe(wav);
  const child = await running;
  cancelled.cancel();
  const idle = cancelled.waitForIdle();
  await assert.rejects(pending, /cancelled/);
  await idle;
  assert.equal(child.killed, true);
  assert.equal(existsSync(input), false);
});

test('timeout and empty transcript return clear errors', async () => {
  const timeout = job(fakeProcess(() => {}), { timeoutMs: 10 });
  await assert.rejects(timeout.transcribe(wav), /timed out/);
  const empty = job(fakeProcess(child => setImmediate(() => child.emit('close', 0))));
  await assert.rejects(empty.transcribe(wav), /No speech was recognized/);
});

test('unsupported audio never starts a process', async () => {
  let launched = false;
  const speech = job(fakeProcess(() => { launched = true; }));
  await assert.rejects(speech.transcribe(new Uint8Array([1, 2])), /Unsupported audio/);
  assert.equal(launched, false);
});

test('memory above and exactly at the policy threshold permits transcription', async () => {
  for (const available of [MINIMUM_ASR_AVAILABLE_BYTES,
    MINIMUM_ASR_AVAILABLE_BYTES + 1]) {
    let samples = 0;
    let launches = 0;
    const speech = job(fakeProcess(child => {
      launches++;
      setImmediate(() => {
        child.stdout.write('Hola mundo\n');
        child.emit('close', 0);
      });
    }), { availableMemoryBytes: () => { samples++; return available; } });
    assert.equal(await speech.transcribe(wav), 'Hola mundo');
    assert.equal(samples, 1);
    assert.equal(launches, 1);
  }
});

test('below-threshold memory gives a specific user message without assets, temp audio or process', async () => {
  let launches = 0;
  let verifications = 0;
  const speech = job(fakeProcess(() => { launches++; }), {
    availableMemoryBytes: () => 765 * 1048576,
    verifyAssets: async () => { verifications++; },
  });
  await assert.rejects(speech.transcribe(wav), error => {
    assert.match(error.message, /765 MiB available; 1,024 MiB required/);
    assert.match(error.message, /Close unused apps or wait/);
    assert.match(error.message, /Task Manager > Performance > Memory > Available/);
    return true;
  });
  assert.equal(launches, 0);
  assert.equal(verifications, 0);
  await speech.waitForIdle();
});

test('missing or invalid memory metrics fail closed without claiming zero measured RAM', async () => {
  for (const sample of [() => 0, () => Number.NaN, () => -1,
    () => Number.POSITIVE_INFINITY, () => { throw new Error('OS query failed'); }]) {
    let launches = 0;
    const speech = job(fakeProcess(() => { launches++; }),
      { availableMemoryBytes: sample });
    await assert.rejects(speech.transcribe(wav), error => {
      assert.match(error.message, /available memory could not be measured/);
      assert.match(error.message, /at least 1,024 MiB/);
      assert.doesNotMatch(error.message, /0 MiB available/);
      return true;
    });
    assert.equal(launches, 0);
  }
});
