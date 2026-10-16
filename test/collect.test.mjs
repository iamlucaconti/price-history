import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { append, merge, decode, build, INTERVAL, WINDOW } from '../collect.mjs';

const now = Date.UTC(2026, 9, 16, 12, 7), card = 100, options = { game: '27', platform: 'console', shard: 4 };
function fixture({ failPc = false } = {}) {
  return async url => {
    if (failPc && url.includes('pc-dyn')) return new Response('', { status: 503 });
    const value = url.endsWith('manifest.json') ? { _version: 1, 'player-prices-index': 'index', 'player-prices-ps5': 'base', 'player-prices-ps5-dyn': 'live', 'player-prices-pc': 'base', 'player-prices-pc-dyn': 'live' }
      : url.includes('index') ? { id0: card, d: [1, 1] } : { p: [2000, 3000, 4000], s: [0, 1, 0] };
    return Response.json(value);
  };
}
test('Exact IDs retain tradable prices and exclude SBC/objective costs', () => {
  const data = merge({ id0: 100, d: [5, 10] }, { p: [100, 200, 300], s: [0, 1, 2] }, { p: [150, 250, 350] });
  assert.deepEqual([...decode(data)], [[100, 150], [105, null], [115, null]]);
});
test('Incomplete or shifted feeds fail instead of assigning prices to wrong cards', () => {
  assert.throws(() => merge({ id0: 100, d: [5] }, { p: [100], s: [0] }, { p: [150] }));
  assert.throws(() => merge({ id0: 100, d: [] }, { p: [100] }, { p: [150] }));
});
test('Manual runs in the same quarter hour replace only that observation', () => {
  let data = append(null, new Map([[card, 2000]]), now, options);
  data = append(data, new Map([[card, 2100]]), now + 60000, options);
  assert.deepEqual(data.times, [now + 60000]); assert.deepEqual(data.prices[card], [2100]);
});
test('24 hours retain a boundary point while pruning older observations', () => {
  let data = null;
  for (let i = 0; i <= 310; i++) data = append(data, new Map([[card, 2000 + i]]), now + i * INTERVAL, options);
  assert.equal(data.times.length, 97); assert.equal(data.times[0], now + 310 * INTERVAL - WINDOW);
});

test('Switching from five-minute history preserves the existing observations', () => {
  const previous = { v: 1, game: '27', platform: 'console', shard: 4,
    times: [now - 10 * 60000, now - 5 * 60000, now], prices: { [card]: [1000, 1500, 2000] } };
  const next = append(previous, new Map([[card, 2100]]), now + INTERVAL, options);
  assert.deepEqual(next.times, [...previous.times, now + 15 * 60000]);
  assert.deepEqual(next.prices[card], [1000, 1500, 2000, 2100]);
});
test('Missing, newly released and removed cards retain real gaps', () => {
  let data = append(null, new Map([[100, 2000]]), now, options);
  data = append(data, new Map([[132, 3000]]), now + INTERVAL, options);
  assert.deepEqual(data.prices[100], [2000, null]); assert.deepEqual(data.prices[132], [null, 3000]);
});
test('No observations are manufactured during an outage', () => {
  let data = append(null, new Map([[100, 2000]]), now, options);
  data = append(data, new Map([[100, 3000]]), now + 6 * INTERVAL, options);
  assert.deepEqual(data.times, [now, now + 6 * INTERVAL]);
});
test('Future, unordered and cross-platform histories are rejected', () => {
  const data = append(null, new Map([[100, 2000]]), now, options);
  assert.throws(() => append(data, new Map(), now - 1, options));
  assert.throws(() => append({ ...data, platform: 'pc' }, new Map(), now + 1, options));
  assert.throws(() => append(data, new Map([[101, 2000]]), now + 1, options));
});
test('Build round trip preserves history, publishes both platforms, and failed downloads leave output intact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'price-history-test-'));
  try {
    const first = path.join(dir, 'first'), second = path.join(dir, 'second');
    await build({ output: first, previous: path.join(dir, 'absent'), at: now, fetcher: fixture() });
    await build({ output: second, previous: first, at: now + INTERVAL, fetcher: fixture() });
    const manifest = JSON.parse(await readFile(path.join(second, 'manifest.json')));
    assert.deepEqual(manifest.times, [now, now + INTERVAL]); assert.deepEqual(manifest.counts, { console: 2, pc: 2 });
    assert.equal(manifest.snapshots, true);
    assert.equal(manifest.intervalMinutes, 15);
    const snapshot = JSON.parse(await readFile(path.join(second, 'snapshots', `${now}-console.json`)));
    assert.deepEqual([...decode(snapshot)], [[100, 2000], [102, 4000]]);
    const before = await readFile(path.join(second, 'manifest.json'), 'utf8');
    await assert.rejects(build({ output: second, previous: first, at: now + INTERVAL, fetcher: fixture({ failPc: true }) }), /503/);
    assert.equal(await readFile(path.join(second, 'manifest.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
