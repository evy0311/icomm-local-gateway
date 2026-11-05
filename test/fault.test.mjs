import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Controller } from '../src/controller.mjs';
import { createHeaterServer } from '../src/http.mjs';
import profile from '../src/devices/reselec3.mjs';
import { sample } from './helpers.mjs';
import { discovery } from '../src/discovery.mjs';

const setup = state => new Controller({state, profile, save:async()=>{}, now:()=>100000});
test('fault31 asserts leak; zero explicitly clears; unrelated faults cannot silently clear it', async () => {
  const state={};const c=setup(state);
  assert.equal(c.publicState().fault_code,null);
  assert.equal(c.publicState().water_leak_detected,null);
  await c.fault('101');assert.equal(c.publicState().fault_code,101);
  assert.equal(c.publicState().water_leak_detected,null);
  await c.fault('31');assert.equal(c.publicState().water_leak_detected,true);
  await c.fault('101');assert.equal(c.publicState().water_leak_detected,true);
  await c.fault('0');assert.equal(c.publicState().fault_code,0);
  assert.equal(c.publicState().water_leak_detected,false);
  assert.equal(c.available,false,'faults do not refresh temperature telemetry');
  assert.equal(setup(JSON.parse(JSON.stringify(state))).publicState().water_leak_detected,false);
});
test('malformed fault reports preserve the last valid fault and temperature cannot clear a leak', async () => {
  const c=setup({});await c.fault('31');
  for(const bad of [undefined,'','-1','31.0','foo','65536','0<extra/>'])await assert.rejects(c.fault(bad));
  assert.equal(c.publicState().fault_code,31);
  await c.telemetry(sample());assert.equal(c.publicState().water_leak_detected,true);
});
for (const bridge of [false,true]) test(`fault reports are observed in ${bridge?'bridge':'local'} HTTP mode`,async()=>{
  const c=setup({});const forwarded=[];
  const cloud=bridge?{forward:async(req,res,body)=>{forwarded.push(body.toString());res.writeHead(202);res.end();}}:undefined;
  const server=createHeaterServer(c,task=>task(),()=>{}, {cloud});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const root=`http://127.0.0.1:${server.address().port}`;
  const post=(id,body)=>fetch(`${root}/devices/${id}/properties/faultCode/datapoints.xml`,{method:'POST',body});
  try {
    for(const [value,wet] of [['31',true],['0',false]]){
      const body=`<datapoint><value>${value}</value></datapoint>`;
      assert.equal((await post(123,body)).status,bridge?202:200);
      assert.equal(c.publicState().water_leak_detected,wet);
      if(bridge)assert.equal(forwarded.at(-1),body);
    }
    assert.equal((await post(456,'<datapoint><value>31</value></datapoint>')).status,bridge?202:400);
    assert.equal(c.publicState().fault_code,0,'different heater cannot overwrite state');
    assert.equal((await post(123,'invalid')).status,bridge?202:400);
    assert.equal(c.publicState().fault_code,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('HA moisture/fault entities use independent known-report availability',()=>{
  const configs=discovery({instance:'test',name:'Test',profile});
  const fault=configs.find(c=>c.payload.unique_id==='icomm_test_fault_code').payload;
  const leak=configs.find(c=>c.payload.unique_id==='icomm_test_water_leak').payload;
  assert.equal(leak.device_class,'moisture');assert.equal(leak.command_topic,undefined);
  assert.deepEqual(fault.availability,[{topic:'icomm/test/gateway'},{topic:'icomm/test/fault'}]);
  assert.deepEqual(leak.availability,[{topic:'icomm/test/gateway'},{topic:'icomm/test/leak'}]);
});
