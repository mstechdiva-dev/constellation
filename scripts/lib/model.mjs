// Pure function: raw GitHub data in, anonymized public data out. No network, no files.
// The output is built from scratch from a small set of allowed fields. Nothing is copied
// and then stripped, and no dates or times are ever written to it.
import { randomInt } from 'node:crypto';
import { assignStarNames } from './stars.mjs';
import { classify } from './classify.mjs';

export const WINDOW_DAYS = 30;
const MAX_EVENTS = 900;
const MAX_FEED = 150;
const FEED_PER_REPO = 25;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sizeBucket(lines) {
  if (lines < 20) return 1;
  if (lines < 100) return 2;
  if (lines < 400) return 3;
  if (lines < 1500) return 4;
  return 5;
}

export function levelFor(n) {
  if (n <= 0) return 0;
  return Math.min(5, 1 + Math.floor(Math.log2(n)));
}

// public commit messages are already public, but we still clean them and drop any that
// mention a private repo name or look like a credential
export function sanitizePublicMessage(msg, privateNames) {
  let s = String(msg || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > 90) s = s.slice(0, 87).trimEnd() + '...';
  const low = s.toLowerCase();
  if (privateNames.some((n) => n.length >= 4 && low.includes(n))) return null;
  if (/(ghp_|gho_|ghs_|github_pat_|sk-[a-z0-9]|AKIA[0-9A-Z]{8})/i.test(s)) return null;
  if (/[0-9a-f]{32,}/i.test(s)) return null;
  return s;
}

export function buildModel(raw, config, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const viewer = String(raw.viewer || '').toLowerCase();
  const ventureMap = config.ventureMap || {};
  const siteNames = config.siteNames || {};
  const announced = config.announced || [];

  const inWindow = (iso) => {
    const t = new Date(iso);
    return t >= since && t <= now;
  };
  const beforeToday = (iso) => new Date(iso) < dayStart;

  // 1. decide which repos are shown and gather their unique commits
  const repos = [];
  for (const r of raw.repos) {
    if (r.isArchived) continue;
    const seen = new Set();
    const commits = []; // {oid, headline, date, lines, kinds, branch}
    const ordered = [...r.branches].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name));
    for (const b of ordered) {
      for (const c of b.commits) {
        if (seen.has(c.oid) || !inWindow(c.date)) continue;
        seen.add(c.oid);
        commits.push({ ...c, branch: b.isDefault ? null : b.name });
      }
    }
    // a fork is shown only if I committed to it in the window
    if (r.isFork && !commits.some((c) => String(c.authorLogin || '').toLowerCase() === viewer)) continue;
    const prs = (r.prs || []).filter((p) => inWindow(p.createdAt));
    const issues = (r.issues || []).filter((p) => inWindow(p.createdAt));
    repos.push({ r, commits, prs, issues });
  }

  // 2. names: public = real, private allowlisted = site name, otherwise a star
  const privateNames = raw.repos.filter((x) => x.isPrivate).map((x) => x.name.toLowerCase());
  const siteLabel = (x) => (x.isPrivate ? siteNames[x.name.toLowerCase()] : undefined);
  const reserved = new Set(Object.values(siteNames));
  const starIds = repos.filter(({ r }) => r.isPrivate && !siteLabel(r)).map(({ r }) => r.id);
  const stars = assignStarNames(starIds, config.salt, reserved);

  const items = repos.map((e) => {
    const { r } = e;
    const site = siteLabel(r);
    const kind = !r.isPrivate ? 'public' : site ? 'named' : 'star';
    const label = kind === 'public' ? r.name : site || stars.get(r.id);
    const ventureKey = ventureMap[r.name.toLowerCase()];
    const gi = ventureKey ? announced.indexOf(ventureKey) : -1;
    const nEvents = e.commits.length;
    const moons = {};
    for (const c of e.commits) if (c.branch) moons[c.branch] = (moons[c.branch] || 0) + 1;
    const moonSizes = Object.values(moons).sort((a, b) => b - a).slice(0, 6).map((n) => (n <= 2 ? 1 : n <= 8 ? 2 : 3));
    const asOf = (list, key) => list.filter((x) => beforeToday(x[key])).length;
    return {
      e,
      kind,
      label,
      out: {
        n: label,
        k: kind,
        g: gi >= 0 ? gi : null,
        c: gi >= 0 ? gi % 5 : -1,
        l: levelFor(nEvents),
        m: moonSizes,
        t: kind === 'star' ? null : asOf(e.commits, 'date'),
      },
    };
  });

  // 3. stable, activity-first order
  items.sort((a, b) => b.out.l - a.out.l || b.e.commits.length - a.e.commits.length || a.label.localeCompare(b.label));
  const index = new Map(items.map((it, i) => [it, i]));

  // 4. events (no times): commits sized by lines changed, PRs and issues fixed size
  let events = [];
  const totals = { c: 0, p: 0, i: 0 };
  for (const it of items) {
    const ri = index.get(it);
    for (const c of it.e.commits) {
      events.push([ri, 'c', sizeBucket(c.lines || 0)]);
      if (beforeToday(c.date)) totals.c++;
    }
    for (const p of it.e.prs) {
      events.push([ri, 'p', 3]);
      if (beforeToday(p.createdAt)) totals.p++;
    }
    for (const p of it.e.issues) {
      events.push([ri, 'i', 3]);
      if (beforeToday(p.createdAt)) totals.i++;
    }
  }
  events = shuffle(events).slice(0, MAX_EVENTS);

  // 5. feed: real (cleaned) messages for public repos, generic phrases for private ones
  let feed = [];
  for (const it of items) {
    const ri = index.get(it);
    const recent = [...it.e.commits].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, FEED_PER_REPO);
    for (const c of recent) {
      const m = it.kind === 'public' ? sanitizePublicMessage(c.headline, privateNames) : classify(c.headline, c.kinds, c.oid);
      if (m) feed.push([ri, m]);
    }
  }
  feed = shuffle(feed).slice(0, MAX_FEED);

  const data = { v: 1, repos: items.map((it) => it.out), events, feed, totals };
  const ctx = {
    privateNames,
    publicNames: items.filter((it) => it.kind === 'public').map((it) => it.label),
    siteLabels: Object.values(siteNames),
    starNames: items.filter((it) => it.kind === 'star').map((it) => it.label),
  };
  return { data, ctx };
}
