import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startMqtt } from '../src/mqtt.mjs';
import { Controller } from '../src/controller.mjs';
import { getProfile } from '../src/devices/index.mjs';
import { sample } from './helpers.mjs';

test('MQTT rejects retained commands, announces on HA birth, and publishes confirmed state', async () => {
  const client = new EventEmitter();
  client.connected = true;
  const messages = [];
  client.publish = (topic, payload, options, callback) => { messages.push({ topic, payload, options }); callback?.(); };
  client.subscribe = () => {};
  const state = { instance: 'synthetic', vacationDays: 7 };
  const controller = new Controller({ state, save: async () => {}, profile: getProfile('reselec3'), readOnly: false });
  await controller.telemetry(sample());
  let pending;
  let options;
  const bridge = startMqtt({ controller, name: 'Test heater', discoveryPrefix: 'homeassistant',
    url: 'mqtt://localhost', run: (task) => { pending = task(); return pending; }, log: () => {},
    connect: (_url, passed) => { options = passed; return client; } });
  client.emit('connect');
  assert.equal(options.clean, true);
  assert.equal(options.queueQoSZero, false);
  assert.equal(options.will.payload, 'offline');
  assert.equal(messages.filter((m) => m.topic.endsWith('/config')).length, 18);
  client.emit('message', 'icomm/synthetic/set/temperature', Buffer.from('121'), { retain: true });
  assert.equal(state.pending, undefined);
  client.emit('message', 'icomm/synthetic/set/temperature', Buffer.from('121'), { retain: false });
  await pending;
  assert.equal(state.pending.target.temperature, 121);
  bridge.report();
  const reported = JSON.parse(messages.filter((m) => m.topic.endsWith('/state')).at(-1).payload);
  assert.equal(reported.temperature, 120, 'target must not become reported state before physical confirmation');
  const before = messages.length;
  client.emit('message', 'homeassistant/status', Buffer.from('online'), { retain: false });
  assert.ok(messages.length > before);
  await controller.cancelQueued();
  controller.readOnly = true;
  client.emit('message', 'icomm/synthetic/set/temperature', Buffer.from('122'), { retain: false });
  await pending;
  assert.equal(state.pending, null);
  assert.match(state.lastError, /disabled/);
});

test('MQTT wake accepts only non-retained PRESS and works without fresh telemetry', async () => {
  const client=new EventEmitter();client.connected=true;client.publish=(_t,_p,_o,cb)=>cb?.();client.subscribe=()=>{};
  const controller=new Controller({state:{instance:'synthetic'},save:async()=>{},profile:getProfile('reselec3')});
  let wakes=0,pending;controller.wake=async()=>{wakes++;};
  startMqtt({controller,name:'Test',url:'mqtt://localhost',discoveryPrefix:'homeassistant',log:()=>{},connect:()=>client,
    run:task=>{pending=task();return pending;}});
  client.emit('message','icomm/synthetic/set/wake',Buffer.from('PRESS'),{retain:true});assert.equal(wakes,0);
  client.emit('message','icomm/synthetic/set/wake',Buffer.from('bad'),{retain:false});await pending;assert.equal(wakes,0);
  client.emit('message','icomm/synthetic/set/wake',Buffer.from('PRESS'),{retain:false});await pending;assert.equal(wakes,1);
  assert.equal(controller.available,false);assert.equal(controller.state.pending,undefined);
});

test('MQTT publishes independent fault/leak availability and retained reported values', async () => {
  const client=new EventEmitter();client.connected=true;client.subscribe=()=>{};
  const messages=[];client.publish=(topic,payload,options,callback)=>{messages.push({topic,payload,options});callback?.();};
  const controller=new Controller({state:{instance:'synthetic'},save:async()=>{},profile:getProfile('reselec3')});
  const bridge=startMqtt({controller,name:'Test',discoveryPrefix:'homeassistant',url:'mqtt://localhost',run:task=>task(),log:()=>{},connect:()=>client});
  controller.bridgeStatus=()=>({ans:{connected:true,poll_ready:true}});
  const last=path=>messages.filter(m=>m.topic===`icomm/synthetic/${path}`).at(-1);
  bridge.report();assert.equal(last('fault').payload,'offline');assert.equal(last('leak').payload,'offline');
  await controller.fault('31');bridge.report();
  assert.equal(last('fault').payload,'online');assert.equal(last('leak').payload,'online');
  assert.equal(last('heater').payload,'offline');
  assert.equal(JSON.parse(last('state').payload).water_leak_detected,true);
  await controller.fault('0');bridge.report();
  assert.equal(JSON.parse(last('state').payload).fault_code,0);
  assert.equal(JSON.parse(last('state').payload).water_leak_detected,false);
  assert.equal(last('state').options.retain,true);
});
