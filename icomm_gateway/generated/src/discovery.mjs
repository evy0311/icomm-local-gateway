export function discovery({ instance, name, profile, discoveryPrefix = 'homeassistant' }) {
  const base = `icomm/${instance}`;
  const device = { identifiers: [`icomm_${instance}`], name, manufacturer: profile.manufacturer,
    model: profile.model, sw_version: '0.1.0' };
  const common = { device, state_topic: `${base}/state`, availability_mode: 'all',
    availability: [{ topic: `${base}/gateway` }, { topic: `${base}/heater` }], qos: 1 };
  const control = { ...common, availability: [...common.availability, { topic: `${base}/controls` }],
    command_topic: '', retain: false, optimistic: false, qos: 0 };
  const specs = [
    ['sensor', 'setpoint', { name: 'Set temperature', device_class: 'temperature', unit_of_measurement: profile.unit,
      value_template: '{{ value_json.temperature }}' }],
    ['sensor', 'fault_code', { name: 'Fault code', icon: 'mdi:alert-circle-outline',
      availability: [{ topic: `${base}/gateway` }, { topic: `${base}/fault` }],
      value_template: '{{ value_json.fault_code if value_json.fault_code is not none else none }}',
      json_attributes_topic: `${base}/state`,
      json_attributes_template: '{{ {"reported_at": value_json.fault_received_at, "meaning": "None" if value_json.fault_code == 0 else "Water leak" if value_json.fault_code == 31 else "Unmapped fault"} | tojson }}' }],
    ['binary_sensor', 'water_leak', { name: 'Water leak detected', device_class: 'moisture',
      availability: [{ topic: `${base}/gateway` }, { topic: `${base}/leak` }], payload_on: 'ON', payload_off: 'OFF',
      value_template: '{{ "ON" if value_json.water_leak_detected == true else "OFF" if value_json.water_leak_detected == false else none }}',
      json_attributes_topic: `${base}/state`,
      json_attributes_template: '{{ {"reported_at": value_json.water_leak_updated_at, "fault_code": value_json.fault_code} | tojson }}' }],
    ['sensor', 'hot_water_estimate', { name: 'Estimated hot-water level', icon: 'mdi:water',
      unit_of_measurement: 'bars',
      value_template: '{{ value_json.hot_water_estimate.bars | default(none) }}',
      json_attributes_topic: `${base}/state`,
      json_attributes_template: '{{ value_json.hot_water_estimate | default({}) | tojson }}' }],
    ['sensor', 'mode_reported', { name: 'Reported mode', value_template: '{{ value_json.mode }}' }],
    ['sensor', 'vacation_remaining', { name: 'Vacation days remaining', unit_of_measurement: 'd',
      value_template: '{{ value_json.vacation_days }}' }],
    ['sensor', 'last_seen', { name: 'Last report', device_class: 'timestamp', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], value_template: '{{ value_json.received_at }}' }],
    ['sensor', 'command_status', { name: 'Command status', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], value_template: '{{ value_json.command_status }}' }],
    ['sensor', 'command_error', { name: 'Last error', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], value_template: '{{ value_json.error or "none" }}' }],
    ['sensor', 'gateway_mode', { name: 'Gateway mode', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], value_template: '{{ value_json.gateway_mode }}' }],
    ['binary_sensor', 'heater_connected', { name: 'Heater connected', device_class: 'connectivity', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], payload_on: 'ON', payload_off: 'OFF',
      value_template: '{{ "ON" if value_json.heater_connected else "OFF" }}' }],
    ['binary_sensor', 'ans_connected', { name: 'UDP connected', device_class: 'connectivity', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], payload_on: 'ON', payload_off: 'OFF',
      value_template: '{{ "ON" if value_json.bridge.ans.connected | default(false) else "OFF" }}' }],
    ['binary_sensor', 'read_only', { name: 'Read only', entity_category: 'diagnostic',
      availability: [{ topic: `${base}/gateway` }], payload_on: 'ON', payload_off: 'OFF',
      value_template: '{{ "ON" if value_json.read_only else "OFF" }}' }],
    ['number', 'temperature', { ...control, availability: [{topic: `${base}/gateway`}, {topic: `${base}/temperature_controls`}], name: 'Target temperature', command_topic: `${base}/set/temperature`,
      value_template: '{{ value_json.temperature }}', min: profile.minTemperature, max: profile.maxTemperature,
      step: profile.temperatureStep, unit_of_measurement: profile.unit, device_class: 'temperature', mode: 'box' }],
    ['select', 'mode', { ...control, name: 'Operating mode', command_topic: `${base}/set/mode`,
      value_template: '{{ value_json.mode }}', options: profile.modes }],
    ['number', 'vacation_days', { ...control, name: 'Vacation duration', command_topic: `${base}/set/vacation_days`,
      value_template: '{{ value_json.vacation_duration }}', min: 1, max: 99, step: 1, unit_of_measurement: 'd', mode: 'box' }],
    ['button', 'wake', { name: 'Wake / poll', command_topic: `${base}/set/wake`, payload_press: 'PRESS',
      availability: [{topic: `${base}/gateway`}, {topic: `${base}/wake`}], retain: false, qos: 0, entity_category: 'diagnostic' }],
    ['button', 'cancel', { name: 'Cancel queued command', command_topic: `${base}/set/cancel`, payload_press: 'PRESS',
      availability: control.availability, retain: false, qos: 0, entity_category: 'config' }],
  ];
  return specs.map(([component, id, config]) => {
    const payload = { ...common, ...config, unique_id: `icomm_${instance}_${id}` };
    // A button has a command but no state topic.
    if (component === 'button') delete payload.state_topic;
    return { topic: `${discoveryPrefix}/${component}/icomm_${instance}/${id}/config`, payload };
  });
}
