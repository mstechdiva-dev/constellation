// Builds site/data.sample.json from invented data, for previews and the README screenshot.
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeFakeRaw, FAKE_CONFIG } from './lib/fixture.mjs';
import { buildModel } from './lib/model.mjs';
import { validateOutput } from './lib/leak.mjs';

const { data, ctx } = buildModel(makeFakeRaw(), FAKE_CONFIG);
const problems = validateOutput(data, ctx);
if (problems.length) {
  console.log('sample failed the leak check');
  process.exit(1);
}
mkdirSync('site', { recursive: true });
writeFileSync('site/data.sample.json', JSON.stringify(data));
console.log(`sample: ${data.repos.length} planets, ${data.events.length} events, ${data.feed.length} feed lines`);
