// main.ts — the program the harness runs.
//
// Reads every case from <input>/cases.json and writes the answers (one per
// case, in the cases' order) to <output>/answers.json. The input and output
// directories come from MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR, which the
// harness sets to the mounts; in the grader's container they are /input and
// /output. Deterministic: the same input always produces the same bytes.
//
// The --no-incremental-marking flag is set before solve.js is imported,
// matching how the baseline is timed (the flag is only a runtime hint for
// the grader's timing harness; it changes no answer).
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const { run } = await import('./solve.js');

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(inputDir + '/cases.json', 'utf8'));
const answers = cases.map((c) => run(c.input));
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/answers.json', JSON.stringify(answers));
