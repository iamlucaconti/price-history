import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const INTERVAL = 5 * 60000, WINDOW = 24 * 3600000, SHARDS = 32;
const platforms = { console: 'player-prices-ps5', pc: 'player-prices-pc' };
const validId = id => Number.isSafeInteger(id) && id > 0;
export const shardName = n => String(n).padStart(2, '0');

export function decode(data) {
  if (data?.v !== 2 || !validId(data.id0) || !Array.isArray(data.d) || !Array.isArray(data.p)
      || data.p.length !== data.d.length + 1 || data.d.some(n => !validId(n))) throw Error('Invalid price index');
  const unavailable = new Set(data.n ?? []), result = new Map(); let id = data.id0;
  data.p.forEach((price, i) => {
    if (i) id += data.d[i - 1];
    if (!validId(id) || !Number.isSafeInteger(price) || price < 0) throw Error('Invalid card price');
    result.set(id, price > 0 && !unavailable.has(id) ? price : null);
  });
  return result;
}

export function merge(index, fixed, dynamic) {
  if (!validId(index?.id0) || !Array.isArray(index.d) || index.d.some(n => !validId(n))) throw Error('Invalid FUT.GG index');
  const length = index.d.length + 1;
  if (!Array.isArray(fixed?.p) || fixed.p.length !== length || !Array.isArray(dynamic?.p)
      || dynamic.p.length !== length) throw Error('FUT.GG price/index lengths differ');
  const states = Array.isArray(fixed.s) && fixed.s.length === length ? fixed.s : dynamic.s;
  if (!Array.isArray(states) || states.length !== length || states.some(n => !Number.isInteger(n) || n < 0)) throw Error('Missing market availability states');
  const data = { v: 2, id0: index.id0, d: index.d, p: [], n: [] }; let id = index.id0;
  for (let i = 0; i < length; i++) {
    if (i) id += index.d[i - 1];
    if (!validId(id)) throw Error('Invalid FUT.GG card ID');
    const fresh = dynamic.p[i], fallback = fixed.p[i];
    for (const value of [fresh, fallback]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw Error('Invalid FUT.GG price');
    if (states[i] !== 0) data.n.push(id);
    data.p.push(states[i] !== 0 ? 0 : fresh > 0 ? fresh : fallback > 0 ? fallback : 0);
  }
  if (![...decode(data).values()].some(price => price !== null)) throw Error('No market prices in feed');
  return data;
}

export async function download(game = '27', fetcher = fetch) {
  if (!/^\d{2}$/.test(game)) throw Error('Invalid FC edition');
  const root = `https://r2.fut.gg/${game}/`;
  async function json(url) {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`FUT.GG HTTP ${response.status}: ${new URL(url).pathname}`);
    return response.json();
  }
  const manifest = await json(root + 'manifest.json');
  const address = key => {
    const hash = manifest[key], version = manifest._version ?? 1;
    if (typeof hash !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(hash) || !Number.isSafeInteger(version) || version < 1) throw Error('Invalid FUT.GG manifest');
    return `${root}${key}.v${version}.${hash}.json`;
  };
  const index = await json(address('player-prices-index'));
  const lists = {}, sourcePublishedAt = {};
  await Promise.all(Object.entries(platforms).map(async ([platform, key]) => {
    // Both feeds are required: do not quietly record an old base list as a fresh observation.
    const [fixed, dynamic] = await Promise.all([json(address(key)), json(address(key + '-dyn'))]);
    lists[platform] = merge(index, fixed, dynamic);
    const timestamp = manifest._published_at?.[key + '-dyn'];
    sourcePublishedAt[platform] = Number.isFinite(timestamp) ? timestamp * 1000 : null;
  }));
  return { lists, sourcePublishedAt };
}

export function append(previous, prices, at, { game = '27', platform, shard } = {}) {
  if (!Number.isSafeInteger(at) || at <= 0 || !Object.hasOwn(platforms, platform) || !Number.isInteger(shard) || shard < 0 || shard >= SHARDS) throw Error('Invalid observation');
  if (previous && (previous.v !== 1 || previous.game !== game || previous.platform !== platform || previous.shard !== shard
      || !Array.isArray(previous.times) || previous.times.length > 289 || typeof previous.prices !== 'object' || !previous.prices)) throw Error('Invalid saved history');
  const times = previous?.times ?? [];
  if (times.some((time, i) => !Number.isSafeInteger(time) || time <= 0 || (i && time <= times[i - 1]) || time > at)) throw Error('Invalid saved timestamps');
  const bucket = Math.floor(at / INTERVAL);
  const keep = times.flatMap((time, i) => time >= at - WINDOW && Math.floor(time / INTERVAL) !== bucket ? [i] : []);
  const output = { v: 1, game, platform, shard, times: [...keep.map(i => times[i]), at], prices: {} };
  const ids = new Set([...Object.keys(previous?.prices ?? {}).map(Number), ...prices.keys()]);
  for (const id of ids) {
    if (!validId(id) || id % SHARDS !== shard) throw Error('History card is in the wrong shard');
    const old = previous?.prices[id];
    if (old && (!Array.isArray(old) || old.length !== times.length || old.some(p => p !== null && (!validId(p))))) throw Error('Invalid saved price series');
    const series = [...keep.map(i => old?.[i] ?? null), prices.get(id) ?? null];
    if (series.some(value => value !== null)) output.prices[id] = series;
  }
  return output;
}

export async function build({ output = 'public', previous = 'state', game = '27', at, fetcher } = {}) {
  if (path.resolve(output) === path.resolve(previous)) throw Error('Use separate input and output directories');
  let prior = null;
  try { prior = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior && (prior.v !== 1 || prior.game !== game || prior.shards !== SHARDS)) throw Error('Incompatible saved history');
  const downloaded = await download(game, fetcher), observedAt = at ?? Date.now();
  const documents = [];
  const counts = {};
  for (const platform of Object.keys(platforms)) {
    const groups = Array.from({ length: SHARDS }, () => new Map());
    for (const [id, price] of decode(downloaded.lists[platform])) groups[id % SHARDS].set(id, price);
    let observations; const histories = [];
    for (let shard = 0; shard < SHARDS; shard++) {
      const file = `history/${platform}/${shardName(shard)}.json`;
      const saved = prior ? JSON.parse(await readFile(path.join(previous, file), 'utf8')) : null;
      if (prior && JSON.stringify(saved.times) !== JSON.stringify(prior.times)) throw Error('Saved shards have inconsistent timestamps');
      const data = append(saved, groups[shard], observedAt, { game, platform, shard });
      observations = data.times;
      histories.push(data);
      documents.push([file, data]);
    }
    counts[platform] = [...decode(downloaded.lists[platform]).values()].filter(price => price !== null).length;
    documents.push([`listino-${platform}.json`, downloaded.lists[platform]]);
    // One compact market snapshot per observation enables market-wide comparisons
    // with a single download instead of fetching all card-history shards.
    const rows = histories.flatMap(data => Object.entries(data.prices).map(([id, series]) => [Number(id), series])).sort((a, b) => a[0] - b[0]);
    if (rows.length) {
      const d = rows.slice(1).map(([id], i) => id - rows[i][0]);
      for (let i = 0; i < observations.length; i++) documents.push([`snapshots/${observations[i]}-${platform}.json`,
        { v: 2, id0: rows[0][0], d, p: rows.map(([, series]) => series[i] ?? 0), n: [] }]);
    }
    if (platform === 'console') documents.push(['times.json', observations]);
  }
  const times = documents.find(([file]) => file === 'times.json')[1];
  const manifest = { v: 1, game, source: 'FUT.GG', generatedAt: observedAt, sourcePublishedAt: downloaded.sourcePublishedAt,
    retentionHours: 24, intervalMinutes: INTERVAL / 60000, shards: SHARDS, snapshots: true, times, counts };
  documents.push(['manifest.json', manifest]);
  // Validate everything before writing. The workflow publishes only successful builds.
  for (const [file, data] of documents) {
    const target = path.join(output, file); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target + '.tmp', JSON.stringify(data) + '\n'); await rename(target + '.tmp', target);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = { game: process.env.ANNO_FC ?? '27' };
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--output': 'output', '--previous': 'previous' }[args[i]];
      if (!key || !args[i + 1]) throw Error('Usage: node collect.mjs [--previous state] [--output public]');
      options[key] = args[i + 1];
    }
    console.log(JSON.stringify(await build(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
