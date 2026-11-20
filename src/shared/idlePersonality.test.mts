import assert from 'node:assert/strict';
import test from 'node:test';
import { applyIdleEyes, idleBeat } from './idlePersonality.ts';
import { restEyes } from './faceExpression.ts';

test('idle acts stay occasional and keep both eyes the same size', () => {
  let rests = 0;
  let acts = 0;
  const seen = new Set<string>();
  for (let slot = 0; slot < 80; slot += 1) {
    const beat = idleBeat(slot * 6_400 + 200);
    seen.add(beat.act);
    if (beat.active) {
      acts += 1;
      const eyes = restEyes();
      applyIdleEyes(eyes, beat.act);
      assert.equal(eyes.left.openness, eyes.right.openness);
      assert.equal(eyes.left.gazeYaw, eyes.right.gazeYaw);
      assert.equal(eyes.left.gazePitch, eyes.right.gazePitch);
    } else {
      rests += 1;
      assert.equal(beat.act, 'rest');
    }
  }
  assert.ok(rests >= 20);
  assert.ok(acts >= 20);
  assert.ok(seen.size >= 4);
});
