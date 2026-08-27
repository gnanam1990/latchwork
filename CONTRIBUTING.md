# Contributing to Latchwork

## Required change flow

1. Create a focused branch from the latest `main`.
2. Make one coherent change with tests that cover its behavior.
3. Run `npm run verify` locally.
4. Commit with a conventional, descriptive message.
5. Open a pull request to `main` and record the verification evidence.
6. Review the exact pull-request head for correctness, security, regressions, and missing tests.
7. Resolve every blocking finding and wait for required checks to pass.
8. Merge only the reviewed, unchanged head.

Direct feature pushes to `main` are not allowed. The initial license-only commit is the repository bootstrap exception.

## Review expectations

Review should verify:

- locked constraints cannot be changed by agent tools;
- agent operations stage changes instead of applying them;
- WebMCP schemas and annotations match runtime behavior;
- tests exercise the failure boundary, not only the successful path;
- lint, typecheck, tests, build, and high-severity audit all pass;
- documentation distinguishes implemented behavior from planned work.

## Commit scope

Keep commits small enough to review independently. Do not mix dependency upgrades, broad formatting, and product behavior unless they are inseparable for the change.
