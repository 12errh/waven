import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINI_HEIGHT,
  MINI_MAX_HEIGHT,
  MINI_MAX_WIDTH,
  MINI_MIN_HEIGHT,
  MINI_MIN_WIDTH,
  MINI_WIDTH,
  isNarrowMini,
  miniProgressRatio,
  miniSeekRatio,
} from './mini.ts';

test('mini window geometry matches the native bounds', () => {
  assert.equal(MINI_WIDTH, 380);
  assert.equal(MINI_HEIGHT, 128);
  assert.equal(MINI_MIN_WIDTH, 320);
  assert.equal(MINI_MIN_HEIGHT, 112);
  assert.equal(MINI_MAX_WIDTH, 560);
  assert.equal(MINI_MAX_HEIGHT, 220);
});

test('miniProgressRatio clamps and survives unknown durations', () => {
  assert.equal(miniProgressRatio(30, 120), 0.25);
  assert.equal(miniProgressRatio(-5, 120), 0);
  assert.equal(miniProgressRatio(500, 120), 1);
  assert.equal(miniProgressRatio(30, 0), 0);
  assert.equal(miniProgressRatio(Number.NaN, 120), 0);
  assert.equal(miniProgressRatio(30, Number.POSITIVE_INFINITY), 0);
});

test('miniSeekRatio clamps a press inside the strip', () => {
  assert.equal(miniSeekRatio(150, 100, 200), 0.25);
  assert.equal(miniSeekRatio(50, 100, 200), 0);
  assert.equal(miniSeekRatio(400, 100, 200), 1);
  assert.equal(miniSeekRatio(150, 100, 0), 0);
});

test('isNarrowMini only flips below the narrow breakpoint', () => {
  assert.equal(isNarrowMini(MINI_WIDTH), false);
  assert.equal(isNarrowMini(MINI_MIN_WIDTH), true);
  assert.equal(isNarrowMini(0), false);
});
