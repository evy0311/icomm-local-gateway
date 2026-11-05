// Verified protocol and decoder adapted from evy0311/icomm-local-gateway (MIT).
import { estimateHotWater } from '../hot-water-estimate.mjs';
import { decodeSuperBlock } from '../decoder.mjs';
import { encodeSetpointCommand, encodeStandardCommand, encodeVacationCommand } from '../protocol.mjs';

export default {
  id: 'reselec3',
  manufacturer: 'A. O. Smith',
  model: 'EE9-50H55DV-A / iCOMM ResElec3',
  // Observed startup fields for the tested ResElec3 module. Local enrollment
  // supplies fresh identity, time and notification keys separately.
  bootstrap: {
    'product-name': 'Residential Electric Phase III', model: 'AY001MTL1',
    'api-major': 1, 'api-minor': 0, 'device-type': 'Wifi',
    'registration-type': 'Same-LAN', 'transport-type': 'http',
    'message-version': 1, 'template-version': 'RE3.V5',
  },
  // Same vendor subscription bitmap observed in two bridge sessions. Bit
  // meanings/rate are not inferred; this is not an appliance control frame.
  reportingConfiguration: [[73, [43]], [105, []], [26, [0, 15, 17, 18, 19, 20]],
    [26, [3, 10, 11, 12, 13, 14, 15, 25]]]
    .map(([length, positions]) => Array.from({ length }, (_, i) => positions.includes(i) ? '1' : '0').join(''))
    .join(','),
  minTemperature: 95,
  maxTemperature: 130,
  temperatureStep: 1,
  unit: '°F',
  modes: ['STANDARD', 'VACATION'],
  decode(value) {
    const decoded = decodeSuperBlock(value);
    if (![1, 2].includes(decoded.mode.code)) throw new Error('Unrecognized operating mode');
    const temperature = decoded.setpoint.fahrenheit;
    // Vacation legitimately reports a reduced setpoint below the normal command range.
    if (temperature < 32 || temperature > 150) throw new Error('Implausible setpoint');
    if (decoded.mode.vacationDays > 99) throw new Error('Unrecognized vacation duration');
    // Segment lengths/hex were validated above. This word remains an unverified
    // temperature candidate, never an actual tank-temperature sensor.
    const candidateRaw = Buffer.from(value.split(',')[1], 'hex').readUInt16BE(2);
    return { temperature, mode: decoded.mode.name, vacation_days: decoded.mode.vacationDays,
      hot_water_estimate: estimateHotWater(candidateRaw, temperature, decoded.mode.name) };
  },
  decodeFault(value) {
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value.trim()) || Number(value) > 65535) {
      throw new Error('Invalid fault code');
    }
    return Number(value);
  },
  encode(kind, value) {
    if (kind === 'temperature') return { frame: encodeSetpointCommand(value), target: { temperature: value } };
    if (kind === 'mode' && value === 'STANDARD') return { frame: encodeStandardCommand(), target: { mode: value } };
    if (kind === 'vacation_days') return { frame: encodeVacationCommand(value), target: { mode: 'VACATION', vacation_days: value } };
    throw new Error('Unsupported command');
  },
  matches(target, telemetry) {
    return Object.entries(target).every(([key, value]) => telemetry[key] === value);
  },
};
