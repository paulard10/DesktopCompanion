import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PABLO_VOICE_NAME,
  clampSpeechRate,
  guessSpeechLang,
  isPabloVoice,
  pickPabloVoice,
  pickSpokenVoice,
  speechLanguage,
  sanitizeSpeechText,
  splitSpeechText,
} from './textToSpeech.ts';

test('pablo voice selection requires es-ES and the name Pablo', () => {
  assert.equal(isPabloVoice({ name: PABLO_VOICE_NAME, lang: 'es-ES' }), true);
  assert.equal(isPabloVoice({ name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES' }), false);
  assert.equal(isPabloVoice({ name: 'Microsoft Laura - Spanish (Spain)', lang: 'es-ES' }), false);
  assert.equal(isPabloVoice({ name: 'Microsoft Pablo - Spanish (Spain)', lang: 'es-MX' }), false);
  assert.equal(isPabloVoice({ name: 'Microsoft Pablo Online', lang: 'es-ES', localService: false }), false);
  assert.equal(
    isPabloVoice({ name: 'Pablo', lang: '', voiceURI: 'MSTTS_V110_esES_PabloM', localService: true }),
    true,
  );
  const picked = pickPabloVoice([
    { name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES', voiceURI: 'h', localService: true },
    { name: PABLO_VOICE_NAME, lang: 'es-ES', voiceURI: 'p', localService: true },
  ]);
  assert.equal(picked?.voiceURI, 'p');
  assert.equal(pickPabloVoice([]), null);
  const helena = { name: 'Microsoft Helena Desktop', lang: 'es-ES', voiceURI: 'helena', localService: true };
  const zira = { name: 'Microsoft Zira Desktop', lang: 'en-US', voiceURI: 'zira', localService: true };
  const cloud = { name: 'Microsoft Zira Online', lang: 'en-US', voiceURI: 'cloud', localService: false };
  assert.equal(pickSpokenVoice([helena, zira, cloud], 'es')?.voiceURI, 'helena');
  assert.equal(pickSpokenVoice([helena, zira, cloud], 'en')?.voiceURI, 'zira');
  assert.equal(pickSpokenVoice([cloud], 'en'), null);
  assert.equal(guessSpeechLang('Hello, how are you?', 'es'), 'en');
  assert.equal(guessSpeechLang('Hola, ¿cómo estás?', 'en'), 'es');
  assert.equal(speechLanguage('auto'), 'auto');
  assert.equal(speechLanguage('fr'), 'es');
});

test('speech text is bounded and split without overlap', () => {
  assert.equal(sanitizeSpeechText('  hola  '), 'hola');
  assert.equal(sanitizeSpeechText(''), '');
  assert.equal(sanitizeSpeechText('x'.repeat(1601)), '');
  const long = `${'palabra '.repeat(90)}fin.`;
  const chunks = splitSpeechText(long);
  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.join(' ').includes('fin.'), true);
  assert.equal(clampSpeechRate(2), 1.25);
  assert.equal(clampSpeechRate(0.5), 0.75);
});
