import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function verifyKernel(base=root, manifest=new URL('./kernel-lock.json',import.meta.url)) {
  const lock=JSON.parse(await readFile(manifest,'utf8')),changed=[];
  for(const [file,expected] of Object.entries(lock.files)) {
    const actual=await readFile(join(base,file)).then(b=>createHash('sha256').update(b).digest('hex')).catch(()=>null);
    if(actual!==expected)changed.push(file);
  }
  return {ok:changed.length===0,baseline:lock.baselineCommit,files:Object.keys(lock.files).length,changed};
}
