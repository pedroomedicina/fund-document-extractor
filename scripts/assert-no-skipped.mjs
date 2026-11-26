#!/usr/bin/env node
// Fails CI when any test was skipped or left as todo, so a broken service container
// (or a stray `it.skip`) cannot pass silently. Ported from the Python repo's CI rule.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'test-results.json';
const report = JSON.parse(readFileSync(file, 'utf8'));
const { numTotalTests = 0, numPendingTests = 0, numTodoTests = 0 } = report;

const skipped = [];
for (const suite of report.testResults ?? []) {
  for (const test of suite.assertionResults ?? []) {
    if (test.status === 'pending' || test.status === 'skipped' || test.status === 'todo') {
      skipped.push(`${suite.name}: ${test.fullName}`);
    }
  }
}

if (numTotalTests === 0) {
  console.error('::error::no tests ran');
  process.exit(1);
}
if (numPendingTests > 0 || numTodoTests > 0 || skipped.length > 0) {
  console.error(`::error::${numPendingTests + numTodoTests} test(s) were skipped in CI`);
  for (const line of skipped) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`All ${numTotalTests} tests ran; none skipped.`);
