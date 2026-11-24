import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HOME_AWAKE_SLEEP_MS, homeAwakeExpired, houseAction, houseTooltip } from './houseGesture.ts';

test('single and double clicks map to the three modes without an inactivity roam sleep', () => {
  assert.equal(houseAction('FREE_ROAM', 'single'), 'dock-awake');
  assert.equal(houseAction('HOME_AWAKE', 'single'), 'leave');
  assert.equal(houseAction('HOME_SLEEPING', 'single'), 'wake-leave');
  assert.equal(houseAction('FREE_ROAM', 'double'), 'sleep');
  assert.equal(houseAction('HOME_AWAKE', 'double'), 'sleep');
  assert.equal(houseAction('HOME_SLEEPING', 'double'), 'stay-asleep');
  assert.equal(homeAwakeExpired(0, HOME_AWAKE_SLEEP_MS - 1), false);
  assert.equal(homeAwakeExpired(0, HOME_AWAKE_SLEEP_MS), true);
  assert.equal(homeAwakeExpired(Number.NaN, HOME_AWAKE_SLEEP_MS), false);
  assert.equal(houseTooltip('FREE_ROAM'), 'Click: return home · Double-click: sleep');
  assert.equal(houseTooltip('HOME_AWAKE'), 'Click: explore · Double-click: sleep');
  assert.equal(houseTooltip('HOME_SLEEPING'), 'Click: wake up');
});

test('main keeps free-roam awake and uses the one-minute platform sleep only', () => {
  const main = readFileSync(new URL('../main/main.ts', import.meta.url), 'utf8');
  assert.match(main, /HOME_AWAKE_SLEEP_MS/);
  assert.match(main, /houseAction\(currentMode\(\), 'single'\)/);
  assert.match(main, /houseAction\(currentMode\(\), 'double'\)/);
  assert.match(main, /requestDocking\(bounds, true, true\)/);
  assert.match(main, /function publishHouseTip/);
  assert.match(main, /mode === 'HOME_SLEEPING' \? 'asleep'/);
  assert.match(readFileSync(new URL('../preload/homePreload.ts', import.meta.url), 'utf8'), /value === 'asleep'/);
  assert.match(readFileSync(new URL('../renderer/homeInteraction.ts', import.meta.url), 'utf8'), /houseTooltip\(/);
  assert.equal(main.includes('armQuiet(') && main.includes('beginBedtime('), true);
  const armed = main.slice(main.indexOf('function armQuiet'), main.indexOf('function rememberSleep'));
  assert.equal(armed.includes('beginBedtime'), false);
});
