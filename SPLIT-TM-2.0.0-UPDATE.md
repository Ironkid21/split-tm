# Split TM 2.0.0 – source update

This archive contains the complete Split TM project with the 2.0.0 source updates.

## Updated files
- `split-tm/package.json` and `split-tm/package-lock.json` — version 2.0.0
- `split-tm/CHANGELOG.md` — 2.0.0 change notes
- `split-tm/src/engine/processor.ts` — Unicode-safe filename tokens, `(2)` collision suffixes, output configuration in run results, awaited output writes
- `split-tm/src/engine/exporters.ts` — writable-stream backpressure support
- `split-tm/src/engine/tmxParser.ts` — await asynchronous consumers between bounded input chunks
- `split-tm/src/engine/dataset.ts` — async unit visitor support
- `split-tm/src/renderer/App.tsx` — stale scan guard and full four-dimension completion summary
- `split-tm/tests/outputConfiguration.test.ts` — regression coverage for multi-dimension and multi-format output

The existing Add Files flow and the filters/output page layout have been retained.

## Verification status
The source was reviewed and updated. A full dependency install could not complete in this environment because the npm registry package `zip-stream@4.1.1` was not available from the local cache and network installation timed out. Consequently, `npm run typecheck`, `npm test`, and the build have **not** been successfully completed here. Run `npm ci` followed by `npm run verify` and `npm run build` in your development environment before packaging or release.
