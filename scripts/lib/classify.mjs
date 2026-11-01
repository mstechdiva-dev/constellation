// Turns a private commit into one generic phrase from a fixed list.
// Inputs are only the opening verb / type prefix of the message and the KINDS of files
// changed (an extension, or one of: lock, workflow, test). No message text is ever copied.
import { createHash } from 'node:crypto';

export const PHRASES = {
  feature: ['add a feature', 'ship a new feature', 'build out a feature'],
  add: ['add something new', 'add a new piece', 'put in something new'],
  fix: ['fix a bug', 'patch a bug', 'fix an edge case'],
  review: ['address review feedback', 'apply review notes', 'tweak after review'],
  remove: ['remove unused code', 'drop dead code', 'delete old pieces'],
  cleanup: ['clean things up', 'tidy up', 'trim and tidy'],
  update: ['update something', 'refresh something', 'bring something up to date'],
  rename: ['rename or move files', 'reorganize files', 'move things around'],
  replace: ['replace an approach', 'swap out an approach', 'switch approaches'],
  refactor: ['refactor code', 'rework some code', 'simplify some code'],
  harden: ['tighten things up', 'harden a piece', 'lock something down'],
  revert: ['revert a change', 'roll back a change', 'undo a change'],
  wire: ['connect pieces together', 'wire things up', 'hook pieces together'],
  tune: ['tune settings', 'adjust settings', 'tweak some settings'],
  show: ['show or hide something', 'adjust what shows', 'change what is visible'],
  expand: ['expand what is covered', 'broaden coverage', 'extend something'],
  archive: ['archive old items', 'move old items aside', 'archive old work'],
  record: ['record results', 'save results', 'capture results'],
  plan: ['plan the next step', 'outline next steps', 'sketch a plan'],
  docs: ['update docs', 'write docs', 'improve docs'],
  ui: ['adjust the page layout', 'tweak page styling', 'polish the layout'],
  config: ['update config', 'adjust config', 'tweak configuration'],
  deps: ['update dependencies', 'bump dependencies', 'refresh dependencies'],
  db: ['change the database', 'update the schema', 'adjust database setup'],
  media: ['add or update images', 'refresh images', 'update media files'],
  tests: ['add tests', 'improve tests', 'update tests'],
  workflow: ['update an automation workflow', 'adjust an automation', 'tweak an automated job'],
  fallback: ['make an update', 'make a change', 'push an update'],
};

export const ALLOWED_PHRASES = new Set(Object.values(PHRASES).flat());

const PREFIX = {
  feat: 'feature', feature: 'feature', fix: 'fix', hotfix: 'fix', docs: 'docs', doc: 'docs',
  test: 'tests', tests: 'tests', refactor: 'refactor', perf: 'refactor', revert: 'revert',
  style: 'ui', ci: 'workflow', build: 'workflow', plan: 'plan', chore: 'update',
};

const VERB = {
  add: 'add', adds: 'add', added: 'add', create: 'add', introduce: 'add',
  fix: 'fix', fixes: 'fix', fixed: 'fix', patch: 'fix', hotfix: 'fix', resolve: 'fix',
  address: 'review', remove: 'remove', removes: 'remove', drop: 'remove', delete: 'remove',
  clean: 'cleanup', cleanup: 'cleanup', tidy: 'cleanup', trim: 'cleanup', prune: 'cleanup',
  update: 'update', updates: 'update', refresh: 'update', sync: 'update', bump: 'update',
  upgrade: 'update', enhance: 'update', improve: 'update', polish: 'update',
  rename: 'rename', move: 'rename', replace: 'replace', switch: 'replace', use: 'replace', swap: 'replace',
  rework: 'refactor', extract: 'refactor', simplify: 'refactor', rewrite: 'refactor',
  refactor: 'refactor', restructure: 'refactor', reorganize: 'refactor',
  harden: 'harden', lock: 'harden', secure: 'harden', revert: 'revert',
  wire: 'wire', hook: 'wire', connect: 'wire', integrate: 'wire',
  set: 'tune', cap: 'tune', tune: 'tune', adjust: 'tune', configure: 'tune',
  show: 'show', hide: 'show', surface: 'show', render: 'show', display: 'show',
  expand: 'expand', extend: 'expand', archive: 'archive',
  record: 'record', capture: 'record', plan: 'plan',
  document: 'docs', clarify: 'docs', describe: 'docs',
};

const DOCS = new Set(['md', 'mdx', 'txt', 'rst']);
const UI = new Set(['html', 'css', 'scss', 'less']);
const CONFIG = new Set(['json', 'yml', 'yaml', 'toml', 'ini', 'cfg']);
const MEDIA = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'mp4', 'mov', 'ico']);

function fileCategory(kind) {
  if (kind === 'lock') return 'deps';
  if (kind === 'workflow') return 'workflow';
  if (kind === 'test') return 'tests';
  if (DOCS.has(kind)) return 'docs';
  if (UI.has(kind)) return 'ui';
  if (CONFIG.has(kind)) return 'config';
  if (kind === 'sql') return 'db';
  if (MEDIA.has(kind)) return 'media';
  return null;
}

// pick a variant deterministically from a seed so the same commit always reads the same
function pick(list, seed) {
  const n = createHash('sha256').update(String(seed)).digest()[0];
  return list[n % list.length];
}

export function categorize(headline, kinds) {
  // the file kinds win when every changed file is the same kind of thing
  if (Array.isArray(kinds) && kinds.length > 0) {
    const cats = new Set(kinds.map(fileCategory));
    if (cats.size === 1 && !cats.has(null)) return [...cats][0];
  }
  const s = String(headline || '').trim().toLowerCase();
  const m = s.match(/^([a-z]+)(\([^)]*\))?!?:\s*(.*)$/);
  let rest = s;
  if (m) {
    if (PREFIX[m[1]]) return PREFIX[m[1]];
    rest = m[3]; // unknown prefix (often a project name): ignore it, use the verb
  }
  rest = rest.replace(/^\[[^\]]*\]\s*/, '');
  const first = (rest.match(/^[a-z][a-z-]*/) || [''])[0];
  return VERB[first] || 'fallback';
}

export function classify(headline, kinds, seed = '') {
  return pick(PHRASES[categorize(headline, kinds)], seed || headline);
}
