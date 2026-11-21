# BUILD-NOTES — csv-reader-speed-21-nov

Entry for make.fun bounty **csv-reader-speed-01-run-20261121** — "Read broken
CSV files faster, 21 November 2026" (Code, program/v1, $100 total: 10 places
× $10). Built 2026-11-21 by the builder subagent; submitted by the parent
agent (bundle route — the bounty does not take recorded transcripts).

## What it is

- `solve.js` — dependency-free ES module. `run({text, header})` returns
  `{columns, rows, errors}`, exactly what csv-reader 1.0.0 returns.
  Written fresh from the RULES.txt specification; the baseline and vendor
  sources were never read (only executed, to verify and benchmark).
- `main.ts` — the program the harness runs: reads every case from
  `$MAKEFUN_INPUT_DIR/cases.json` (`/input` in the container), answers each
  with `run`, writes `$MAKEFUN_OUTPUT_DIR/answers.json` (`/output`).
  Sets `--no-incremental-marking` before importing solve.js, as the baseline
  is timed with it. No dependencies, no network, deterministic output.

## Design

Single pass, left to right. Unquoted fields and the junk after a closing
quote are scanned with a tight `charCodeAt` loop (cheaper than indexOf jumps
for the short fields here); quoted fields are located with indexOf jumps
over the closing quote and their value is a `slice` unless it holds `""`
escapes or CRs, in which case a native `replace` folds them. Line breaks
inside quotes are counted with indexOf loops and advance the line number.

One semantic the RULES text alone does not spell out, found by differential
fuzzing against the baseline: **a field whose first character is a lone CR
reads as unquoted** — the CR is dropped (stray_cr) and a quote after it is
a literal character. This holds at a record boundary (`a,b\n\r"q",c` →
field `"q"`) and after a comma (`a,\r"q"` → field `"q"`), but only for the
field that starts at the CR; later fields parse normally. A CRLF between
the CR and the quote restores quoted parsing. Implemented with a
`boundaryCR` flag, cleared by an empty line and after the record's first
field. Verified by 27,136 differential checks with zero diffs (below).

## Correctness

Differential-tested my `run()` against the baseline (executed, never read):

| Battery | Checks | Diffs |
|---|---|---|
| Hand-written probe edge cases (quotes, CRs, CRLF, BOM, junk, unterminated, short/long, empty lines, boundary CRs) | 130 | 0 |
| Practice set (6 cases, vs expected.json and vs baseline) | 6 | 0 |
| Random token-soup fuzz (two seeds, up to 120 pieces) | 19,000 | 0 |
| Structured fuzz (realistic rows + injected breakage) | 8,000 | 0 |
| **Total** | **27,136** | **0** |

Probe/fuzz scripts: `/tmp/diff.mjs`, `/tmp/diff2.mjs` (kept in the builder
session's /tmp, not part of the entry).

## Benchmark

Practice set: 6 cases, 10,193,953 bytes total. Node 24.22.1 on this machine
(grader runs Node 22.23.4; relative speed is what matters). Each figure is
the mean of 10 runs of the whole set, CPU time from `process.cpuUsage()`.

| Run | Mine (CPU ms/set) | Baseline csv-reader 1.0.0 (CPU ms/set) | Ratio |
|---|---|---|---|
| 1 | 87.2 | 699.3 | 8.02× |
| 2 | 88.9 | 674.8 | 7.59× |
| 3 | 89.8 | 645.6 | 7.19× |
| 4 | 86.6 | 736.6 | 8.50× |

**~7.2–8.5× faster than the house baseline** (~87–90 ms vs ~646–737 ms
CPU per 10.2 MB set; ~122 MB/s wall). The baseline's own RULES figure is
~1.38 s CPU on a ~10–12 MB set; my direct measurement on this machine is
~0.65–0.74 s for the same baseline, so the ratio above is the honest
comparison. Earlier indexOf-based version measured 3.5×; switching the
unquoted-field scan to a charCodeAt loop took it to ~8×.

Command used (benchmark script `/tmp/bench.mjs`):

```sh
node --no-incremental-marking bench.mjs
```

## Official checks

`grade-local` (process driver, worktree), 2026-11-21:

```sh
node cli/makefun.mjs grade-local --kit . \
  --bot ~/workspace/makefun/csv-reader-speed-01-run-20261121/repo \
  --driver process --worktree
```

- `scores {"cases_passed":6,"cases_total":6,"passed":1}`
- `checks 6 of 6 points over 1 check`
- `L1 regrade reproduced byte for byte` (two executions byte-identical)
- Baseline graded the same way also passes 6/6 (sanity check).

`makefun check` (pre-submit checks, no transcripts), 2026-11-21:

```sh
node cli/makefun.mjs check --kit . \
  --repo ~/workspace/makefun/csv-reader-speed-01-run-20261121/repo --worktree
```

- pass: competition_open, snapshot (5 files, 19,180 bytes), license_osi
  (SPDX-License-Identifier: MIT), entrypoint (main.ts → node22),
  entry_size (19,180 bytes < 1,048,576 cap)
- 0 failed; the rest are the site's at submission (repo_public, repo_owner,
  repo_created_after_open, commit_in_repo, duplicate_snapshot) or
  transcript-gate skips (this bounty does not require transcripts; the
  parent still bundles them for authorship).

## Repo

- Total size: 5 files, 19,180 bytes (cap 1,048,576 bytes).
- License: MIT, `SPDX-License-Identifier: MIT` first line.
- README: make.fun template with all three live badges
  (donatfarm01 / csv-reader-speed-21-nov), referral code donatfarm01.
