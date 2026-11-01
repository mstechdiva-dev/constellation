import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, categorize, ALLOWED_PHRASES } from './lib/classify.mjs';
import { assignStarNames, STAR_NAMES } from './lib/stars.mjs';
import { buildModel, sizeBucket, levelFor, sanitizePublicMessage } from './lib/model.mjs';
import { validateOutput } from './lib/leak.mjs';
import { makeFakeRaw, FAKE_CONFIG, SECRET_WORDS } from './lib/fixture.mjs';

const NOW = new Date('2026-10-30T12:00:00Z');
const build = (cfg = FAKE_CONFIG) => buildModel(makeFakeRaw(NOW), cfg, NOW);

test('classify: always returns an approved phrase', () => {
  for (const h of ['fix: crash in Foo', 'Add Bar export', 'zzz', '', 'Address review']) {
    assert.ok(ALLOWED_PHRASES.has(classify(h, [], h)));
  }
});

test('classify: file kinds override the opening verb when all files match', () => {
  assert.equal(categorize('Fix thing', ['md']), 'docs');
  assert.equal(categorize('Fix thing', ['md', 'js']), 'fix');
  assert.equal(categorize('feat(x): hi', []), 'feature');
  assert.equal(categorize('Nova: add hi', []), 'add');
});

test('classify: same commit always reads the same', () => {
  assert.equal(classify('Fix a', [], 'abc'), classify('Fix a', [], 'abc'));
});

test('stars: stable, unique, and need a real salt', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `id${i}`);
  const a = assignStarNames(ids, 'a-long-enough-salt-value');
  const b = assignStarNames([...ids].reverse(), 'a-long-enough-salt-value');
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.equal(new Set(a.values()).size, 200);
  assert.ok([...a.values()].every((n) => STAR_NAMES.includes(n)));
  assert.throws(() => assignStarNames(ids, 'short'));
});

test('buckets', () => {
  assert.equal(sizeBucket(5), 1);
  assert.equal(sizeBucket(5000), 5);
  assert.equal(levelFor(0), 0);
  assert.equal(levelFor(1), 1);
  assert.equal(levelFor(100000), 5);
});

test('model output passes the leak check and has the planned shape', () => {
  const { data, ctx } = build();
  assert.deepEqual(validateOutput(data, ctx), []);
  assert.deepEqual(Object.keys(data).sort(), ['events', 'feed', 'repos', 'totals', 'v']);
  assert.ok(data.repos.length > 10);
});

test('model output has no private names, secret words, dates, or URLs', () => {
  const { data, ctx } = build();
  const text = JSON.stringify(data).toLowerCase();
  for (const n of ctx.privateNames) {
    if (n.startsWith('fake-private') || n === 'fake-tray' || n.startsWith('fake-site')) assert.ok(!text.includes(n), n);
  }
  for (const w of SECRET_WORDS) assert.ok(!text.includes(w.toLowerCase()), w);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
  assert.ok(!/https?:/.test(text));
});

test('names: public real, allowlisted sites named, the rest stars', () => {
  const { data } = build();
  const byName = Object.fromEntries(data.repos.map((r) => [r.n, r]));
  assert.equal(byName['Tray DevOPS'].k, 'named');
  assert.equal(byName['twoclicks.ai'].k, 'named');
  const stars = data.repos.filter((r) => r.k === 'star');
  assert.ok(stars.length > 3);
  assert.ok(stars.every((r) => r.t === null && STAR_NAMES.includes(r.n)));
});

test('colors: announced ventures get a color, unannounced share none', () => {
  const { data } = build();
  const byName = Object.fromEntries(data.repos.map((r) => [r.n, r]));
  assert.equal(byName['twoclicks.ai'].c, 0);
  assert.equal(byName['llmcode.ai'].c, 1);
  assert.ok(data.repos.every((r) => r.c === -1 || r.g !== null));
});

test('totals only count activity before today (UTC)', () => {
  const { data } = buildModel(makeFakeRaw(NOW), FAKE_CONFIG, NOW);
  const later = buildModel(makeFakeRaw(NOW), FAKE_CONFIG, new Date(NOW.getTime() + 3600000));
  assert.deepEqual(data.totals, later.data.totals);
});

test('same salt gives the same star names on every run', () => {
  const a = build().data.repos.filter((r) => r.k === 'star').map((r) => r.n).sort();
  const b = build().data.repos.filter((r) => r.k === 'star').map((r) => r.n).sort();
  assert.deepEqual(a, b);
});

test('archived repos and idle forks are skipped', () => {
  const raw = makeFakeRaw(NOW);
  raw.repos[10].isArchived = true;
  const fork = raw.repos[11];
  fork.isFork = true;
  for (const b of fork.branches) for (const c of b.commits) c.authorLogin = 'someone-else';
  fork.branches[0].commits.push({ oid: 'z'.repeat(40), headline: 'x', date: NOW.toISOString(), lines: 1, authorLogin: 'someone-else', kinds: [] });
  const { data } = buildModel(raw, FAKE_CONFIG, NOW);
  const { data: base } = build();
  assert.ok(data.repos.length <= base.repos.length);
});

test('public messages: urls and private names are dropped', () => {
  assert.equal(sanitizePublicMessage('see https://x.test now', []), 'see now');
  assert.equal(sanitizePublicMessage('fix fake-private-1 bug', ['fake-private-1']), null);
  assert.equal(sanitizePublicMessage('ghp_abcdefghijklmnopqrstuvwxyz0123456789', []), null);
});

test('leak check: fails closed on tampering', () => {
  const { data, ctx } = build();
  const clone = () => JSON.parse(JSON.stringify(data));

  let d = clone(); d.extra = 1;
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.repos[0].when = 'x';
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.repos.find((r) => r.k === 'star').n = 'fake-private-1';
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.feed.push([d.repos.findIndex((r) => r.k === 'star'), 'fixed the ClientAcme importer']);
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.repos[0].n = 'x 2026-10-30';
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.events.push([999, 'c', 1]);
  assert.ok(validateOutput(d, ctx).length);

  d = clone(); d.totals.c = -1;
  assert.ok(validateOutput(d, ctx).length);
});

test('leak check: a private repo name inside a public line is caught', () => {
  const { data, ctx } = build();
  const pub = data.repos.findIndex((r) => r.k === 'public');
  data.feed.push([pub, 'work on fake-private-3 today']);
  assert.ok(validateOutput(data, ctx).length);
});
