import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { HOME, homeCaptures, homeHit, placeHome } from './homeGeometry.ts';
import { attachHome } from '../renderer/homeInteraction.ts';
import { isHomeRendererUrl, isChatRendererUrl } from './trustedUrl.ts';

test('Home has a fixed compact DIP footprint and respects the supplied taskbar-free workArea', () => {
  assert.equal(HOME.width, 112); assert.equal(HOME.height, 88);
  assert.deepEqual(placeHome({ x: 0, y: 0, width: 1920, height: 1040 }),
    { x: 1792, y: 936, width: 112, height: 88 });
  assert.deepEqual(placeHome({ x: 0, y: 48, width: 1920, height: 992 }),
    { x: 1792, y: 936, width: 112, height: 88 });
});

test('negative display coordinates and fractional native alignment remain inside workArea', () => {
  assert.deepEqual(placeHome({ x: -1920, y: 40, width: 1920, height: 1040 }),
    { x: -128, y: 976, width: 112, height: 88 });
  const area = { x: -1900.25, y: 40.25, width: 300.5, height: 200.75 };
  const bounds = placeHome(area)!;
  assert.ok(Number.isInteger(bounds.x) && Number.isInteger(bounds.y));
  assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
  assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
});

test('small valid workAreas reduce inset; invalid or unavailable placement fails closed without resizing', () => {
  assert.deepEqual(placeHome({ x: 2, y: 3, width: 112, height: 88 }),
    { x: 2, y: 3, width: 112, height: 88 });
  for (const area of [null, { x: 0, y: 0, width: 111, height: 88 },
    { x: 0, y: 0, width: 112, height: 87 }, { x: Infinity, y: 0, width: 400, height: 300 },
    { x: 0.5, y: 0, width: 112, height: 88 }]) assert.equal(placeHome(area), null);
});

test('painted platform captures; corners, former shelter roof and close outside edges pass through', () => {
  for (const [x, y] of [[56, 30], [56, 50], [5, 48], [5, 60], [107, 54], [56, 78]]) assert.equal(homeHit(x!, y!), true);
  for (const [x, y] of [[0, 0], [111, 0], [0, 87], [111, 87], [10, 30], [56, 29.99],
    [4.99, 54], [107.01, 54], [56, 78.01], [56, 10], [NaN, 50]]) assert.equal(homeHit(x!, y!), false);
});

test('curved platform hit region follows its projected ellipse instead of a bounding rectangle', () => {
  // Halfway from the center to each side, the upper/lower elliptical arcs
  // are at y=48-18*sqrt(3/4) and y=60+18*sqrt(3/4), respectively.
  const upper = 32.411542731880104, lower = 75.5884572681199;
  for (const x of [30.5, 81.5]) {
    assert.equal(homeHit(x, upper + 0.01), true);
    assert.equal(homeHit(x, upper - 0.01), false);
    assert.equal(homeHit(x, lower - 0.01), true);
    assert.equal(homeHit(x, lower + 0.01), false);
  }
  // The visible sidewall belongs to the extrusion, beyond the top ellipse.
  assert.equal(homeHit(6, 54), true);
  assert.equal(homeHit(106, 54), true);
});

test('trusted cursor conversion, immediate exit, staleness, visibility and avatar input priority', () => {
  const bounds = { x: -128, y: 976, width: 112, height: 88 };
  const sample = { cursor: { x: -72, y: 1026 }, at: 1000, avatarOwnsPointer: false };
  assert.equal(homeCaptures(sample, bounds, 1000, true), true);
  assert.equal(homeCaptures({ ...sample, cursor: { x: -128, y: 976 } }, bounds, 1000, true), false);
  assert.equal(homeCaptures(sample, bounds, 1250, true), true);
  assert.equal(homeCaptures(sample, bounds, 1251, true), false);
  assert.equal(homeCaptures(sample, bounds, 999, true), false);
  assert.equal(homeCaptures(sample, bounds, 1000, false), false);
  assert.equal(homeCaptures({ ...sample, avatarOwnsPointer: true }, bounds, 1000, true), false);
  assert.equal(homeCaptures(null, bounds, 1000, true), false);
  assert.equal(homeCaptures(sample, { ...bounds, width: 216 }, 1000, true), false);
});

test('Home trusts only its exact first-party page; it is never a chat microphone URL', () => {
  assert.equal(isHomeRendererUrl('http://127.0.0.1:5173/home.html', true), true);
  assert.equal(isHomeRendererUrl('app://companion/home.html', false), true);
  for (const url of ['https://example.com/home.html', 'http://127.0.0.1:5173/chat.html',
    'http://127.0.0.1:5173/home.html?capture=true', 'http://127.0.0.1:5173/home.html#other']) {
    assert.equal(isHomeRendererUrl(url, true), false);
  }
  assert.equal(isChatRendererUrl('http://127.0.0.1:5173/home.html', true), false);
});

test('actual renderer binding synchronizes SVG/hit geometry, requires main feedback and releases listeners', () => {
  class Element extends EventEmitter {
    attrs: Record<string, string> = {};
    classes = new Set<string>();
    classList = { add: (s: string) => this.classes.add(s), remove: (s: string) => this.classes.delete(s) };
    offsetWidth = 112;
    setAttribute(key: string, value: string) { this.attrs[key] = value; }
    addEventListener(name: string, fn: (...args: any[]) => void) { this.on(name, fn); }
    removeEventListener(name: string, fn: (...args: any[]) => void) { this.off(name, fn); }
  }
  const button = new Element(), svg = new Element(), chassis = new Element(), deck = new Element(), surface = new Element();
  let ready = 0, clicks = 0, unsubscribed = 0, feedback: (value: import('./ipc.ts').HomeFeedback) => void = () => {};
  const dispose = attachHome({ button, svg, chassis, deck, surface } as any, {
    notifyReady: () => ready++, notifyClick: () => clicks++,
    onFeedback(fn) { feedback = fn; return () => unsubscribed++; },
  });
  assert.equal(ready, 1); assert.equal(svg.attrs.viewBox, '0 0 112 88');
  assert.deepEqual(chassis.attrs, { d: 'M 5 48 A 51 18 0 0 1 107 48 V 60 A 51 18 0 0 1 5 60 Z' });
  assert.deepEqual(deck.attrs, { cx: '56', cy: '48', rx: '51', ry: '18' });
  assert.deepEqual(surface.attrs, { cx: '56', cy: '46', rx: '42', ry: '13' });
  button.emit('click', { isTrusted: true, button: 0, clientX: 56, clientY: 50 });
  assert.equal(clicks, 1); assert.equal(button.classes.has('feedback'), false);
  button.emit('click', { isTrusted: true, button: 0, clientX: 0, clientY: 0 });
  button.emit('click', { isTrusted: false, button: 0, clientX: 56, clientY: 50 });
  button.emit('click', { isTrusted: true, button: 2, clientX: 56, clientY: 50 });
  assert.equal(clicks, 1);
  feedback('busy'); assert.equal(button.classes.has('busy'),true); assert.equal(button.classes.has('feedback'),false);
  feedback('docked'); assert.equal(button.classes.has('docked'),true); assert.equal(button.classes.has('busy'),false);
  assert.equal(button.attrs.title, 'Click: explore · Double-click: sleep');
  feedback('pulse'); assert.equal(button.classes.has('feedback'), true);
  button.emit('animationend'); assert.equal(button.classes.has('feedback'), false);
  assert.equal(button.classes.has('docked'),true, 'rest feedback remains static after the event pulse');
  feedback('idle'); assert.equal(button.classes.has('docked'),false); assert.equal(button.attrs.title, 'Click: return home · Double-click: sleep');
  feedback('asleep'); assert.equal(button.classes.has('docked'), false);
  assert.equal(button.attrs.title, 'Click: wake up');
  assert.equal(button.attrs['aria-label'], 'Click: wake up');
  feedback('blocked'); assert.equal(button.classes.has('blocked'),true); assert.ok(button.attrs.title!.includes('unavailable'));
  dispose(); assert.equal(unsubscribed, 1); assert.equal(button.listenerCount('click'), 0);
  assert.equal(button.listenerCount('animationend'), 0);
});
