import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {optionEnvironment} from './options.mjs';

const options=JSON.parse(await readFile('/data/options.json','utf8'));
const env={...process.env,...optionEnvironment(options)};
await mkdir('/data/certs',{recursive:true,mode:0o700});
let cert=false,key=false;
try{await access('/data/certs/device.crt');cert=true;}catch{}
try{await access('/data/certs/device.key');key=true;}catch{}
if(cert!==key)throw new Error('Incomplete certificate pair; restore both files from a private backup');
if(!cert){
  const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','3650',
    '-config','/app/openssl.cnf','-extensions','v3_ca','-keyout','/data/certs/device.key','-out','/data/certs/device.crt'],{stdio:'ignore'});
  if(result.status!==0)throw new Error('Certificate generation failed');
  const{chmod}=await import('node:fs/promises');await chmod('/data/certs/device.key',0o600);
}
const apache=(await readFile('/app/apache.conf','utf8')).replaceAll('/certs/','/data/certs/').replaceAll('http://gateway:8080/','http://127.0.0.1:8080/');
await writeFile('/tmp/icomm-httpd.conf',apache,{mode:0o600});
const check=spawnSync('/usr/local/apache2/bin/httpd',['-t','-f','/tmp/icomm-httpd.conf'],{stdio:'inherit'});
if(check.status!==0)throw new Error('TLS configuration rejected');
const children=[spawn(process.execPath,['/app/src/main.mjs'],{env,stdio:'inherit'}),
  spawn('/usr/local/apache2/bin/httpd',['-DFOREGROUND','-f','/tmp/icomm-httpd.conf'],{stdio:'inherit'})];
let stopping=false;
function stop(code){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');
  Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))))
    .then(()=>process.exit(code));setTimeout(()=>process.exit(code),8000).unref();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop(0));
for(const child of children){child.on('error',()=>stop(1));child.on('exit',()=>stop(1));}
