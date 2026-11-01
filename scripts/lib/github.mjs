// Reads the last 30 days of activity for every repo the token owner owns.
// Returns the raw shape that model.mjs expects. Nothing here is written anywhere, and
// nothing is logged except counts.
const API = 'https://api.github.com';
const MAX_HISTORY_PAGES = 10; // 100 commits per page
const KIND_LOOKUPS_PER_REPO = 25; // file kinds are only needed for lines shown in the feed

async function call(token, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'constellation',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 500 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${body ? 'a GraphQL call' : 'a REST call'}`);
    return res.json();
  }
  throw new Error('GitHub API kept failing after retries');
}

async function gql(token, query, variables) {
  const out = await call(token, '/graphql', { query, variables });
  if (out.errors?.length) throw new Error(`GraphQL error: ${out.errors[0].type || 'unknown'}`);
  return out.data;
}

const REPOS_Q = `query($after:String){viewer{login repositories(first:50,after:$after,ownerAffiliations:OWNER,orderBy:{field:PUSHED_AT,direction:DESC}){
  pageInfo{hasNextPage endCursor}
  nodes{id name isPrivate isFork isArchived pushedAt owner{login}
    defaultBranchRef{name}
    pullRequests(first:100,orderBy:{field:CREATED_AT,direction:DESC}){nodes{createdAt}}
    issues(first:100,orderBy:{field:CREATED_AT,direction:DESC}){nodes{createdAt}}
  }}}}`;

const BRANCHES_Q = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
  refs(refPrefix:"refs/heads/",first:100,after:$after,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){
    pageInfo{hasNextPage endCursor}
    nodes{name target{... on Commit{committedDate}}}}}}`;

const HISTORY_Q = `query($owner:String!,$name:String!,$ref:String!,$since:GitTimestamp!,$after:String){repository(owner:$owner,name:$name){
  ref(qualifiedName:$ref){target{... on Commit{history(first:100,since:$since,after:$after){
    pageInfo{hasNextPage endCursor}
    nodes{oid messageHeadline committedDate additions deletions author{user{login}}}}}}}}}`;

async function branchesOf(token, owner, name, since) {
  const out = [];
  let after = null;
  for (let i = 0; i < 5; i++) {
    const d = await gql(token, BRANCHES_Q, { owner, name, after });
    const refs = d.repository.refs;
    for (const n of refs.nodes) {
      // only branches whose newest commit is inside the window can have commits to count
      if (n.target?.committedDate && new Date(n.target.committedDate) >= since) out.push(n.name);
    }
    if (!refs.pageInfo.hasNextPage) break;
    after = refs.pageInfo.endCursor;
  }
  return out;
}

async function historyOf(token, owner, name, branch, since) {
  const out = [];
  let after = null;
  for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
    const d = await gql(token, HISTORY_Q, { owner, name, ref: `refs/heads/${branch}`, since: since.toISOString(), after, });
    const h = d.repository.ref?.target?.history;
    if (!h) break;
    for (const c of h.nodes) {
      out.push({
        oid: c.oid,
        headline: c.messageHeadline,
        date: c.committedDate,
        lines: (c.additions || 0) + (c.deletions || 0),
        authorLogin: c.author?.user?.login || '',
      });
    }
    if (!h.pageInfo.hasNextPage) break;
    after = h.pageInfo.endCursor;
  }
  return out;
}

// file KINDS (an extension, or lock / workflow / test) for a commit. File names are read here
// and reduced to kinds immediately; names never leave this function.
async function kindsOf(token, owner, name, sha) {
  const c = await call(token, `/repos/${owner}/${name}/commits/${sha}`);
  const kinds = new Set();
  for (const f of c.files || []) {
    const p = String(f.filename).toLowerCase();
    const base = p.split('/').pop();
    if (p.startsWith('.github/workflows/')) kinds.add('workflow');
    else if (/(^|\/)(tests?|__tests__)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(base)) kinds.add('test');
    else if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|poetry\.lock|go\.sum|cargo\.lock|gemfile\.lock)$/.test(base)) kinds.add('lock');
    else kinds.add(base.includes('.') ? base.split('.').pop() : 'none');
  }
  return [...kinds];
}

export async function fetchRaw(token, now = new Date(), windowDays = 30, log = () => {}) {
  const since = new Date(now.getTime() - windowDays * 86400000);
  // 1. every owned repo, with PR and issue dates
  const nodes = [];
  let viewer = '';
  let after = null;
  for (let i = 0; i < 10; i++) {
    const d = await gql(token, REPOS_Q, { after });
    viewer = d.viewer.login;
    nodes.push(...d.viewer.repositories.nodes);
    if (!d.viewer.repositories.pageInfo.hasNextPage) break;
    after = d.viewer.repositories.pageInfo.endCursor;
  }
  log(`repos found: ${nodes.length}`);

  // 2. commits on all branches, only for repos pushed to inside the window
  const repos = [];
  let commitCount = 0;
  for (const n of nodes) {
    const r = {
      id: n.id,
      name: n.name,
      isPrivate: n.isPrivate,
      isFork: n.isFork,
      isArchived: n.isArchived,
      branches: [],
      prs: n.pullRequests.nodes,
      issues: n.issues.nodes,
    };
    if (!n.isArchived && n.pushedAt && new Date(n.pushedAt) >= since) {
      const def = n.defaultBranchRef?.name;
      const names = new Set(await branchesOf(token, n.owner.login, n.name, since));
      if (def) names.add(def);
      for (const b of names) {
        const commits = await historyOf(token, n.owner.login, n.name, b, since);
        r.branches.push({ name: b, isDefault: b === def, commits });
        commitCount += commits.length;
      }
      // feed lines for private repos: look up file kinds for the newest few commits
      if (n.isPrivate) {
        const uniq = new Map();
        for (const b of r.branches) for (const c of b.commits) if (!uniq.has(c.oid)) uniq.set(c.oid, c);
        const newest = [...uniq.values()].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, KIND_LOOKUPS_PER_REPO);
        for (const c of newest) {
          try {
            c.kinds = await kindsOf(token, n.owner.login, n.name, c.oid);
          } catch {
            c.kinds = [];
          }
        }
        // share kinds with the same commit seen on other branches
        for (const b of r.branches) for (const c of b.commits) if (uniq.get(c.oid)?.kinds) c.kinds = uniq.get(c.oid).kinds;
      }
    }
    repos.push(r);
  }
  log(`commit records read: ${commitCount}`);
  return { viewer, repos };
}
