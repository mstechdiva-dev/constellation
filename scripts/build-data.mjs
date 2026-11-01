// Fetches the last 30 days, builds the anonymized public data, and checks it.
// Reads all settings from environment variables. Logs counts and PASS/FAIL only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchRaw } from './lib/github.mjs';
import { buildModel } from './lib/model.mjs';
import { validateOutput } from './lib/leak.mjs';

function lowerKeys(obj) {
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k.toLowerCase(), v]));
}

function readJson(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

const token = process.env.GH_TOKEN;
const salt = process.env.STAR_SALT;
if (!token) throw new Error('GH_TOKEN is not set');
if (!salt) throw new Error('STAR_SALT is not set');

const config = {
  salt,
  siteNames: lowerKeys(readJson('SITE_NAMES', {})),
  ventureMap: lowerKeys(readJson('VENTURE_MAP', {})),
  announced: readJson('ANNOUNCED_VENTURES', []),
};

const raw = await fetchRaw(token, new Date(), 30, (m) => console.log(m));

// hide private names from the logs, in case anything ever prints one
if (process.env.GITHUB_ACTIONS) {
  for (const r of raw.repos) if (r.isPrivate && r.name.length >= 4) console.log(`::add-mask::${r.name}`);
}

const { data, ctx } = buildModel(raw, config);
const problems = validateOutput(data, ctx);
if (problems.length) {
  console.log(`Leak check: FAIL (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
  for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
  process.exit(1);
}

mkdirSync('site', { recursive: true });
mkdirSync('.tmp', { recursive: true });
writeFileSync('site/data.json', JSON.stringify(data));
// the context file lets leak-check.mjs run as a separate, independent gate; it stays in .tmp
writeFileSync('.tmp/leak-ctx.json', JSON.stringify(ctx));
console.log(`planets: ${data.repos.length}, events: ${data.events.length}, feed lines: ${data.feed.length}`);
console.log(`totals: commits ${data.totals.c}, pull requests ${data.totals.p}, issues ${data.totals.i}`);
console.log('Leak check: PASS');
