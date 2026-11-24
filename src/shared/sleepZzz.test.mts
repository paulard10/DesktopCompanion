import assert from 'node:assert/strict';
import test from 'node:test';
import { SLEEP_ZZZ_COUNT, SLEEP_ZZZ_LIFE_MS, createSleepMarks, writeSleepMarks } from './sleepZzz.ts';

test('sleep marks drift up and disappear as soon as the robot wakes', () => {
  const marks = createSleepMarks();
  assert.equal(marks.length, SLEEP_ZZZ_COUNT);
  writeSleepMarks(0, false, false, marks);
  assert.equal(marks.every((mark) => !mark.visible), true);
  writeSleepMarks(SLEEP_ZZZ_LIFE_MS / 2, true, false, marks);
  assert.equal(marks.some((mark) => mark.visible && mark.opacity > 0.2), true);
  assert.ok(marks.some((mark) => mark.scale >= 0.25));
  assert.ok(Math.max(...marks.map((mark) => mark.scale)) > Math.min(...marks.map((mark) => mark.scale)));
  const low = marks[0]?.y ?? 0;
  writeSleepMarks(SLEEP_ZZZ_LIFE_MS * 0.85, true, false, marks);
  assert.ok((marks[0]?.y ?? 0) > low);
  writeSleepMarks(1_000, true, true, marks);
  assert.equal(marks.every((mark) => !mark.visible && mark.opacity === 0), true);
  writeSleepMarks(1_000, false, false, marks);
  assert.equal(marks.every((mark) => !mark.visible), true);
});
