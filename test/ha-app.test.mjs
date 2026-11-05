import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {optionEnvironment} from '../icomm_gateway/options.mjs';
import {createWebServer} from '../src/admin.mjs';
import {loadSettings} from '../src/settings.mjs';
import {Controller} from '../src/controller.mjs';
import profile from '../src/devices/reselec3.mjs';

test('HA options map read-only, private credentials, and ingress without enabling host access',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../icomm_gateway/config.json',import.meta.url),'utf8'));
 const env=optionEnvironment({...manifest.options,mqtt_username:'synthetic',mqtt_password:'fixture'});
 assert.equal(env.READ_ONLY,'true');assert.equal(env.HA_INGRESS,'true');assert.equal(env.MQTT_PASSWORD,'fixture');
 assert.equal(manifest.ports['8081/tcp'],undefined);
 assert.throws(()=>optionEnvironment({...manifest.options,mqtt_url:'http://broker'}));
 assert.throws(()=>optionEnvironment({...manifest.options,mqtt_url:'mqtt://user:secret@broker'}));
 assert.throws(()=>optionEnvironment({...manifest.options,read_only:'false'}));
});
test('ingress denies spoofed headers from other peers and permits trusted origin-preserving CSRF requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'icomm-ingress-'));
 const settings=await loadSettings(join(dir,'runtime.json'),{mode:'local',cloudHost:'',captureMode:'redacted'});
 const controller=new Controller({state:{instance:'synthetic'},profile,save:async()=>{}});
 const server=createWebServer({controller,settings,ingress:true,name:'Fixture',run:fn=>fn(),restart:()=>{},mqttStatus:()=>({connected:false})});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/settings',{headers:{'X-Ingress-Path':'/spoof','X-Forwarded-For':'172.30.32.2'}})).status,403);
  assert.equal((await fetch(base+'/health')).status,200);
  // Test fixture only: stand in for Supervisor's actual socket peer.
  server.prependListener('request',req=>Object.defineProperty(req.socket,'remoteAddress',{value:'::ffff:172.30.32.2',configurable:true}));
  const page=await fetch(base+'/');assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match(await page.text(),/href="\.\/app.css"/);
  const config=await(await fetch(base+'/api/settings')).json();
  const headers={'Content-Type':'application/json','X-iCOMM-Token':config.csrf,Origin:'https://home-assistant.example'};
  assert.equal((await fetch(base+'/api/settings',{method:'POST',headers,body:JSON.stringify({mode:'local'})})).status,202);
  assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{...headers,'X-iCOMM-Token':'bad'},body:'{}'})).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
