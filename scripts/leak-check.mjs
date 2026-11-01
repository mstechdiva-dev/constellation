// Independent final gate: usage  node scripts/leak-check.mjs <data.json> <ctx.json>
// Exits 1 on any problem. Prints counts and PASS/FAIL only, never the offending value.
import { readFileSync } from 'node:fs';
import { validateOutput } from './lib/leak.mjs';

const [dataPath, ctxPath] = process.argv.slice(2);
if (!dataPath || !ctxPath) {
  console.log('Leak check: FAIL (usage: leak-check.mjs <data.json> <ctx.json>)');
  process.exit(1);
}
let problems;
try {
  problems = validateOutput(JSON.parse(readFileSync(dataPath, 'utf8')), JSON.parse(readFileSync(ctxPath, 'utf8')));
} catch {
  console.log('Leak check: FAIL (could not read inputs)');
  process.exit(1);
}
if (problems.length) {
  console.log(`Leak check: FAIL (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
  for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Leak check: PASS');
