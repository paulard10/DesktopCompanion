import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, selector);
  return css.slice(start, css.indexOf('}', start));
}

test('the conversation column keeps the welcome text off the composer', () => {
  const html = readFileSync(path.join(root, 'src/renderer/chat.html'), 'utf8');
  const css = readFileSync(path.join(root, 'src/renderer/chat.css'), 'utf8');
  const log = html.indexOf('id="log"');
  const composer = html.indexOf('id="composer"');
  const live = html.indexOf('id="live"');
  assert.ok(log > 0 && log < composer && composer < live);
  assert.ok(html.indexOf('</form>') < html.indexOf('id="clear"'));
  assert.match(html, /class="frame"/);
  assert.match(html, /id="thread"/);
  assert.match(html, /class="dock"/);
  assert.match(html, /id="connection"/);
  assert.match(html, /id="mic"/);
  assert.match(html, /id="send"/);
  assert.match(html, /aria-label="Stop reply"/);
  assert.match(html, /id="speech-insert"/);
  assert.match(html, /id="tts-stop"/);
  assert.match(html, /Enter sends/);
  const connection = html.slice(html.indexOf('<details id="connection"'), html.indexOf('>', html.indexOf('<details id="connection"')) + 1);
  const settings = html.slice(html.indexOf('<div id="settings"'), html.indexOf('>', html.indexOf('<div id="settings"')) + 1);
  assert.equal(/\sopen[\s>]/.test(connection), false);
  assert.match(settings, /\shidden[\s>]/);
  assert.equal(html.includes('id="mic-tap"'), false);
  assert.equal(html.includes('id="mic-hold"'), false);
  assert.match(html, /id="hold-to-talk"(?![^>]*checked)/);
  assert.equal(html.includes('id="developer"'), false);
  assert.equal(html.includes('Developer Tools'), false);
  assert.equal(html.includes('Dev preview'), false);
  assert.equal(html.includes('Test left arm'), false);
  const frame = rule(css, '.frame');
  const logWrap = rule(css, '.log-wrap');
  const history = rule(css, '.thread');
  const empty = rule(css, '.empty');
  const dock = rule(css, '.dock');
  assert.match(frame, /flex-direction: column/);
  assert.match(frame, /min-height: 0/);
  assert.match(frame, /overflow: hidden/);
  assert.match(logWrap, /min-height: 0/);
  assert.match(logWrap, /overflow: hidden/);
  assert.match(history, /overflow: auto/);
  assert.match(history, /min-height: 0/);
  assert.match(dock, /flex: 0 0 auto/);
  assert.equal(css.includes('.dev-panel'), false);
  assert.equal(css.includes('.developer'), false);
  assert.equal(empty.includes('position:'), false);
  assert.equal(rule(css, '.composer').includes('position:'), false);
});

test('developer expression controls stay out of the chat', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  assert.equal(chat.includes('import.meta.env.DEV'), false);
  assert.equal(chat.includes('#developer'), false);
  assert.equal(chat.includes('previewPresence'), false);
  assert.equal(chat.includes('Dev preview'), false);
  assert.equal(chat.includes('Test window move'), false);
  assert.equal(chat.includes('Test left arm'), false);
  assert.match(chat, /event\.key === 'Enter' && !event\.shiftKey/);
  assert.match(chat, /form\.requestSubmit\(\)/);
  assert.match(chat, /thread\.scrollTop = thread\.scrollHeight/);
  assert.match(chat, /shouldFollowTranscript/);
  const built = readdirSync(path.join(root, 'dist/renderer/assets')).filter((name) => name.startsWith('chat-') && name.endsWith('.js'));
  assert.equal(built.length, 1);
  const bundle = readFileSync(path.join(root, 'dist/renderer/assets', built[0] ?? ''), 'utf8');
  assert.equal(bundle.includes('Test left arm'), false);
  assert.equal(bundle.includes('PROBE_LEFT'), false);
  assert.equal(bundle.includes('previewPresence'), false);
});
