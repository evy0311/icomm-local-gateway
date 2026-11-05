import mqtt from 'mqtt';
import { discovery } from './discovery.mjs';

export function startMqtt({ url, username, password, controller, name, discoveryPrefix, run, log = console.log, connect = mqtt.connect }) {
  const base = `icomm/${controller.state.instance}`;
  const client = connect(url, { username, password, clientId: `icomm_${controller.state.instance}`,
    clean: true, reconnectPeriod: 5000, connectTimeout: 10000, queueQoSZero: false,
    will: { topic: `${base}/gateway`, payload: 'offline', retain: true, qos: 1 } });
  const publish = (topic, value) => {
    if (client.connected) client.publish(topic, typeof value === 'string' ? value : JSON.stringify(value),
      { retain: true, qos: 1 }, (error) => { if (error) log('MQTT publish failed'); });
  };
  const report = () => {
    publish(`${base}/state`, controller.publicState());
    publish(`${base}/heater`, controller.telemetryAvailable ? 'online' : 'offline');
    publish(`${base}/fault`, controller.heaterConnected && Number.isInteger(controller.state.fault?.code) ? 'online' : 'offline');
    publish(`${base}/leak`, controller.heaterConnected && typeof controller.state.fault?.leak_detected === 'boolean' ? 'online' : 'offline');
    publish(`${base}/temperature_controls`, controller.canSetTemperature && controller.heaterConnected ? 'online' : 'offline');
    publish(`${base}/wake`, controller.gatewayMode === 'local' && controller.bridgeStatus?.().ans?.poll_ready ? 'online' : 'offline');
    publish(`${base}/controls`, controller.canControl ? 'online' : 'offline');
  };
  const announce = () => {
    for (const item of discovery({ instance: controller.state.instance, name, profile: controller.profile, discoveryPrefix })) {
      publish(item.topic, item.payload);
    }
    report();
    publish(`${base}/gateway`, 'online');
  };
  client.on('connect', () => {
    client.subscribe([`${base}/set/+`, `${discoveryPrefix}/status`], { qos: 0 }, (error) => {
      if (error) log('MQTT subscribe failed');
    });
    announce();
    log('MQTT connected; discovery published');
  });
  client.on('error', () => log('MQTT connection error (check broker settings)'));
  client.on('message', (topic, payload, packet) => {
    if (topic === `${discoveryPrefix}/status`) {
      if (payload.toString() === 'online') announce();
      return;
    }
    // Retained commands must never be replayed on reconnect. Commands are QoS 0.
    if (packet.retain || payload.length > 128) return;
    void run(async () => {
      try {
        await controller.expire();
        const kind = topic.slice(`${base}/set/`.length);
        const raw = payload.toString().trim();
        if (kind === 'wake') {
          if (raw !== 'PRESS') throw new Error('Invalid wake command');
          await controller.wake();
        } else if (kind === 'cancel') {
          if (raw !== 'PRESS') throw new Error('Invalid cancel command');
          await controller.cancelQueued();
        } else if (kind === 'temperature' || kind === 'vacation_days') {
          if (!/^\d+(?:\.0+)?$/.test(raw)) throw new Error('Expected a whole number');
          await controller.command(kind, Number(raw));
        } else if (kind === 'mode') await controller.command(kind, raw);
        else throw new Error('Unsupported command');
      } catch (error) {
        controller.state.lastError = error.message;
        await controller.commit();
      }
    }).catch(() => log('Command persistence failed'));
  });
  return { report, client, async close() {
    if (client.connected) await client.publishAsync(`${base}/gateway`, 'offline', { retain: true, qos: 1 });
    await client.endAsync();
  } };
}
