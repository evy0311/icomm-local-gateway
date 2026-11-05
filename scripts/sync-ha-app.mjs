// Supervisor builds each App folder as its own Docker context. Keep a generated,
// allowlisted source copy there; CI refuses drift. Never copy runtime data.
import {readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {resolve,relative,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=join(root,'icomm_gateway/generated');
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){
 const p=join(dir,e.name);if(e.isDirectory())result.push(...await files(p));else if(e.isFile())result.push(p);}return result;}
const expected=new Map();
for(const p of await files(join(root,'src')))expected.set(relative(root,p),await readFile(p));
for(const p of ['package.json','package-lock.json','apache.conf','scripts/openssl.cnf','LICENSE','NOTICE'])expected.set(p,await readFile(join(root,p)));
if(process.argv.includes('--check')){
 let actual=[];try{actual=await files(target);}catch{}
 if(actual.length!==expected.size)throw new Error('Generated App context file count differs; run node scripts/sync-ha-app.mjs');
 for(const [name,body]of expected)if(!body.equals(await readFile(join(target,name))))throw new Error('Generated App context differs: '+name);
 console.log('App context matches canonical source');
}else{
 await rm(target,{recursive:true,force:true});
 for(const[name,body]of expected){await mkdir(dirname(join(target,name)),{recursive:true});await writeFile(join(target,name),body);}
 console.log('Generated App source context');
}
