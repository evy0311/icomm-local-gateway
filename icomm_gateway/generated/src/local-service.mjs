import { randomBytes, randomInt } from 'node:crypto';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ parseTagValue: false, processEntities: false });
const builder = new XMLBuilder({ format: true, suppressEmptyNode: false });

// Local enrollment is deliberately separate from appliance commands. No vendor
// tokens or cloud responses are imported to create a fresh local identity.
export class LocalDeviceService {
  constructor(controller, { now = Date.now, configureReporting = false } = {}) {
    this.controller = controller;
    this.now = now;
    this.configureReporting = configureReporting;
    this.reportingPending = true;
  }
  async lookup(dsn) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dsn)) throw new Error('Invalid DSN');
    const { state, profile } = this.controller;
    if (state.localIdentity?.dsn && state.localIdentity.dsn !== dsn) throw new Error('Different device rejected');
    if (!profile.bootstrap) throw new Error('Profile has no local startup configuration');
    if (!state.localIdentity) {
      state.localIdentity = { dsn, ansKey: randomBytes(64).toString('base64'),
        registrationToken: randomBytes(3).toString('hex') };
      state.deviceId ??= String(randomInt(1, 2147483647));
      await this.controller.commit();
    }
    if (state.localIdentity.registrationToken.length !== 6 || state.localIdentity.setupToken !== undefined) {
      state.localIdentity.registrationToken = randomBytes(3).toString('hex');
      delete state.localIdentity.setupToken;
      await this.controller.commit();
    }
    this.reportingPending = true;
    return this.deviceXml();
  }
  deviceXml() {
    const { state, profile } = this.controller;
    const identity = state.localIdentity;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build({ device: {
      ...profile.bootstrap, ...identity.metadata,
      key: state.deviceId, regtoken: identity.registrationToken, 'setup-token': '',
      oem: '', 'oem-model': '', 'log-server': '', 'setup-location': '', imei: '',
      'ans-cipher-key': identity.ansKey, 'ans-server': 'ans-field.aylanetworks.com',
      'unix-time': Math.floor(this.now() / 1000), 'lan-enabled': false,
      'local-access-enabled': false, registered: 0,
    } });
  }
  async updateDevice(id, body) {
    await this.controller.identify(id);
    if (!this.controller.state.localIdentity) throw new Error('Device lookup required');
    if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error('Invalid device XML');
    const parsed = parser.parse(body);
    // The module sends an empty <device> update once lookup metadata already
    // matches. This is a no-op, not a malformed scalar or arbitrary XML root.
    const value = Object.hasOwn(parsed, 'device') && parsed.device === '' ? {} : parsed.device;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid device update');
    const allowed = new Set(['sw-version', 'lan-ip', 'ssid']);
    const metadata = { ...this.controller.state.localIdentity.metadata };
    for (const [name, field] of Object.entries(value)) {
      if (!allowed.has(name) || typeof field !== 'string' || field.length > 256) throw new Error('Unsupported device metadata');
      metadata[name] = field;
    }
    this.controller.state.localIdentity.metadata = metadata;
    await this.controller.commit();
    return this.deviceXml();
  }
  async oemInfo(id, body) {
    await this.controller.identify(id);
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid OEM metadata');
    // This metadata update does not change appliance settings or cloud ownership.
    // Do not persist arbitrary untrusted fields in the device profile.
    return '{}';
  }
  takeReportingConfiguration() {
    if (!this.configureReporting || !this.reportingPending || !this.controller.profile.reportingConfiguration) return null;
    this.reportingPending = false;
    return this.controller.profile.reportingConfiguration;
  }
}
