// Fake GitHub data for tests and the preview. Every name here is invented.
export const FAKE_SALT = 'fake-salt-for-tests-only-1234567890';

export const FAKE_CONFIG = {
  salt: FAKE_SALT,
  siteNames: { 'fake-tray': 'Tray DevOPS', 'fake-site-a': 'twoclicks.ai', 'fake-site-b': 'llmcode.ai' },
  ventureMap: { 'fake-site-a': 'v-one', 'fake-site-b': 'v-two', 'fake-private-3': 'v-two', 'fake-private-4': 'v-hidden' },
  announced: ['v-one', 'v-two'],
};

const SECRET_WORDS = ['TOPSECRET', 'ClientAcme', 'ProjectNova'];
const HEADLINES = [
  'fix: crash in TOPSECRET importer',
  'feat: add ClientAcme export',
  'Add retry for ProjectNova sync',
  'Update dashboard layout',
  'Remove unused helper',
  'docs: explain setup',
  'Switch to new parser',
  'address review notes',
  'chore: bump packages',
  'Refactor ProjectNova loader',
  'Set cap on batch size',
  'Move files into folders',
];
const KIND_SETS = [['js'], ['md'], ['html', 'css'], ['json'], ['py', 'md'], ['ts', 'tsx'], ['sql'], ['lock'], ['workflow'], ['test']];

export function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export function makeFakeRaw(now = new Date(), seed = 7) {
  const rnd = seeded(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const day = 86400000;
  const names = [
    ['demo-public-one', false], ['demo-public-two', false], ['demo-public-three', false],
    ['fake-tray', true], ['fake-site-a', true], ['fake-site-b', true],
  ];
  for (let i = 1; i <= 29; i++) names.push([`fake-private-${i}`, true]);
  const repos = names.map(([name, isPrivate], idx) => {
    // roughly a third of repos are active; the first few are busy
    const active = idx === 3 || idx === 4 || idx === 5 || idx === 0 || rnd() < 0.3;
    const weight = idx === 3 ? 140 : idx < 6 ? 30 : 14;
    const nCommits = active ? Math.max(1, Math.floor(rnd() * weight) + (idx === 3 ? 80 : 2)) : 0;
    const mainCommits = [];
    const sideCommits = {};
    for (let i = 0; i < nCommits; i++) {
      const c = {
        oid: `${seed}${idx}${i}`.padEnd(40, 'a'),
        headline: pick(HEADLINES),
        date: new Date(now.getTime() - rnd() * 29 * day).toISOString(),
        lines: Math.floor(Math.pow(rnd(), 2.2) * 2000),
        authorLogin: 'fake-owner',
        kinds: pick(KIND_SETS),
      };
      if (rnd() < 0.2) (sideCommits[`feature-${Math.floor(rnd() * 4)}`] ||= []).push(c);
      else mainCommits.push(c);
    }
    const branches = [{ name: 'main', isDefault: true, commits: mainCommits }];
    for (const [bn, commits] of Object.entries(sideCommits)) branches.push({ name: bn, isDefault: false, commits });
    const stamp = () => ({ createdAt: new Date(now.getTime() - rnd() * 29 * day).toISOString() });
    return {
      id: `R_fake_${idx}`,
      name,
      isPrivate,
      isFork: false,
      isArchived: false,
      branches,
      prs: active ? Array.from({ length: Math.floor(rnd() * 6) }, stamp) : [],
      issues: active ? Array.from({ length: Math.floor(rnd() * 4) }, stamp) : [],
    };
  });
  // public commit messages are real text; keep these clean and invented
  for (const r of repos.filter((x) => !x.isPrivate)) for (const b of r.branches) for (const c of b.commits) c.headline = pick(['Add dark mode toggle', 'Fix typo in readme', 'Tidy up the build script', 'Update example data']);
  return { viewer: 'fake-owner', repos };
}

export { SECRET_WORDS };
