import { build } from 'esbuild';
const i = process.argv.indexOf('--channel');
const channel = (i > 0 ? process.argv[i + 1] : process.env.SPLITTM_CHANNEL) ?? 'production';
if (!['production', 'developer'].includes(channel)) throw new Error(`Unknown channel "${channel}" (use production or developer)`);
const common = { bundle: true, platform: 'node', target: 'node20', external: ['electron'], sourcemap: true, logLevel: 'info', define: { __BUILD_CHANNEL__: JSON.stringify(channel) } };
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', format: 'cjs' });
await build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/main/preload.cjs', format: 'cjs' });
console.log(`Main process built for channel: ${channel}`);
