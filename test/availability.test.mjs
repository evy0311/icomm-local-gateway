import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Controller} from '../src/controller.mjs';
import profile from '../src/devices/reselec3.mjs';
import {sample} from './helpers.mjs';
import {startMqtt} from '../src/mqtt.mjs';

function setup(){let now=100000;const state={instance:'test',deviceId:'123',vacationDays:7};
 const c=new Controller({state,profile,save:async()=>{},readOnly:false,now:()=>now});
 let connected=true; c.bridgeStatus=()=>({ans:{connected,poll_ready:connected}});
 return{c,state,advance:ms=>{now+=ms;},disconnect:()=>{connected=false;}};
}
test('unchanged reports stay available while authenticated UDP is alive, without changing report age',async()=>{
 const{c,advance,disconnect}=setup();await c.telemetry(sample(130));const time=c.publicState().received_at;
 advance(24*60*60*1000);assert.equal(c.available,false);
 assert.equal(c.telemetryAvailable,true);assert.equal(c.publicState().telemetry_stale,true);
 assert.equal(c.publicState().received_at,time);assert.equal(c.publicState().temperature,130);
 await c.command('mode','VACATION');assert.ok(await c.deliver());
 disconnect();assert.equal(c.telemetryAvailable,false);assert.equal(c.heaterConnected,false);
 assert.equal(c.publicState().temperature,130,'retain cached value when disconnected');
});
test('persisted reports regain availability after live UDP resumes; invalid or missing reports cannot',async()=>{
 const{c,state}=setup();assert.equal(c.telemetryAvailable,false);await c.telemetry(sample());
 const restored=new Controller({state:JSON.parse(JSON.stringify(state)),profile,save:async()=>{}});
 restored.bridgeStatus=()=>({ans:{connected:true,poll_ready:true}});
 assert.equal(restored.available,false);assert.equal(restored.telemetryAvailable,true);
 await assert.rejects(restored.telemetry('invalid'));assert.equal(restored.telemetryAvailable,false);
});
test('MQTT keeps data/control topics online during quiet periods and offlines them on connection loss',async()=>{
 const{c,advance,disconnect}=setup();await c.telemetry(sample());await c.fault('0');advance(900001);
 const client=new EventEmitter();client.connected=true;client.subscribe=()=>{};const messages=[];
 client.publish=(topic,payload,_options,cb)=>{messages.push({topic,payload});cb?.();};
 const bridge=startMqtt({controller:c,name:'Test',url:'mqtt://localhost',discoveryPrefix:'homeassistant',run:fn=>fn(),connect:()=>client});
 const last=topic=>messages.filter(m=>m.topic===`icomm/test/${topic}`).at(-1)?.payload;
 bridge.report();for(const topic of ['heater','controls','temperature_controls','fault','leak'])assert.equal(last(topic),'online');
 disconnect();bridge.report();for(const topic of ['heater','controls','temperature_controls','fault','leak'])assert.equal(last(topic),'offline');
 assert.equal(JSON.parse(last('state')).temperature,120);
});
test('bridge connection uses activity independently of telemetry age and expires without packets',async()=>{
 let now=Date.now();const c=new Controller({state:{},profile,save:async()=>{},gatewayMode:'bridge',now:()=>now});
 c.bridgeStatus=()=>({ans:{last_heater_packet_at:new Date(now).toISOString()}});
 await c.telemetry(sample());now+=900001;assert.equal(c.telemetryAvailable,true);
 const last=now;c.bridgeStatus=()=>({ans:{last_heater_packet_at:new Date(last).toISOString()}});
 now+=90001;assert.equal(c.telemetryAvailable,false);
});
