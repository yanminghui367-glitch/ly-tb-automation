import {build} from '../workbench/node_modules/esbuild/lib/main.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['workbench/execution-orb.tsx'],outfile:'workbench/execution-orb.js',bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'});
