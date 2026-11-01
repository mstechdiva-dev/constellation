// Final gate before anything is published. Checks the output against a strict schema and
// scans it for anything that must never be public. Returns a list of problems that never
// quote the offending value (so logs stay clean). An empty list means PASS.
import { STAR_NAMES } from './stars.mjs';
import { ALLOWED_PHRASES } from './classify.mjs';

const TOP = ['v', 'repos', 'events', 'feed', 'totals'];
const REPO = ['n', 'k', 'g', 'c', 'l', 'm', 't'];
const isInt = (x) => Number.isInteger(x);

export function validateOutput(data, ctx) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const sameKeys = (obj, keys, where) => {
    const got = Object.keys(obj || {}).sort().join(',');
    if (got !== [...keys].sort().join(',')) bad(`${where}: unexpected or missing fields`);
  };

  if (!data || typeof data !== 'object') return ['output is not an object'];
  sameKeys(data, TOP, 'top level');
  if (data.v !== 1) bad('version must be 1');

  const publicNames = new Set((ctx.publicNames || []).map((s) => s.toLowerCase()));
  const siteLabels = new Set((ctx.siteLabels || []).map((s) => s.toLowerCase()));
  const stars = new Set(STAR_NAMES.map((s) => s.toLowerCase()));
  const kinds = [];

  (data.repos || []).forEach((r, i) => {
    sameKeys(r, REPO, `repos[${i}]`);
    kinds.push(r.k);
    if (typeof r.n !== 'string' || r.n.length === 0 || r.n.length > 60) bad(`repos[${i}]: bad label`);
    if (!['public', 'named', 'star'].includes(r.k)) bad(`repos[${i}]: bad kind`);
    if (!(r.g === null || (isInt(r.g) && r.g >= 0 && r.g < 20))) bad(`repos[${i}]: bad group`);
    if (!(isInt(r.c) && r.c >= -1 && r.c <= 4)) bad(`repos[${i}]: bad color`);
    if (!(isInt(r.l) && r.l >= 0 && r.l <= 5)) bad(`repos[${i}]: bad level`);
    if (!Array.isArray(r.m) || r.m.length > 6 || !r.m.every((x) => isInt(x) && x >= 1 && x <= 3)) bad(`repos[${i}]: bad moons`);
    if (!(r.t === null || (isInt(r.t) && r.t >= 0))) bad(`repos[${i}]: bad count`);
    if (r.k === 'star' && !stars.has(String(r.n).toLowerCase())) bad(`repos[${i}]: label is not an approved star name`);
    if (r.k === 'named' && !siteLabels.has(String(r.n).toLowerCase())) bad(`repos[${i}]: label is not an approved site name`);
    if (r.k === 'public' && !publicNames.has(String(r.n).toLowerCase())) bad(`repos[${i}]: label is not a known public repo`);
    if (r.k === 'star' && r.t !== null) bad(`repos[${i}]: star nodes must not carry counts`);
  });

  const nRepos = (data.repos || []).length;
  (data.events || []).forEach((e, i) => {
    if (!Array.isArray(e) || e.length !== 3 || !isInt(e[0]) || e[0] < 0 || e[0] >= nRepos || !['c', 'p', 'i'].includes(e[1]) || !isInt(e[2]) || e[2] < 1 || e[2] > 5) {
      bad(`events[${i}]: bad record`);
    }
  });
  (data.feed || []).forEach((f, i) => {
    if (!Array.isArray(f) || f.length !== 2 || !isInt(f[0]) || f[0] < 0 || f[0] >= nRepos || typeof f[1] !== 'string' || f[1].length === 0 || f[1].length > 100) {
      bad(`feed[${i}]: bad record`);
      return;
    }
    if (kinds[f[0]] !== 'public' && !ALLOWED_PHRASES.has(f[1])) bad(`feed[${i}]: private repo line is not an approved phrase`);
  });
  sameKeys(data.totals, ['c', 'p', 'i'], 'totals');
  for (const k of ['c', 'p', 'i']) if (!isInt(data.totals?.[k]) || data.totals[k] < 0) bad(`totals.${k}: bad number`);

  // text scans. Only the visible text is searched (labels and feed lines), so a private repo
  // named like a field ("feed") cannot trip it. Approved labels and phrases are removed first
  // so a short private name that sits inside one of them does not count.
  const privateNames = (ctx.privateNames || []).map((s) => s.toLowerCase()).filter((s) => s.length >= 4);
  const stripped = JSON.stringify({ ...data, feed: (data.feed || []).filter((f) => kinds[f[0]] !== 'public') });
  const approved = [...publicNames, ...siteLabels, ...stars, ...[...ALLOWED_PHRASES].map((p) => p.toLowerCase())].sort((a, b) => b.length - a.length);
  let visible = [...(data.repos || []).map((r) => r.n), ...(data.feed || []).map((f) => f[1])].join('\n').toLowerCase();
  for (const a of approved) visible = visible.split(a).join(' ');
  if (privateNames.some((n) => visible.includes(n))) bad('a private repo name appears in the output');
  if (/https?:\/\/|www\./i.test(stripped)) bad('a URL appears in the output');
  if (/\b\d{4}-\d{2}-\d{2}/.test(stripped) || /\d{2}:\d{2}/.test(stripped)) bad('a date or time appears in the output');
  if (/\b[0-9a-f]{7,40}\b/i.test(stripped.replace(/\d+/g, ''))) bad('a hash-like string appears in the output');
  if (/(ghp_|gho_|ghs_|github_pat_)/i.test(JSON.stringify(data))) bad('a token-like string appears in the output');
  return problems;
}
