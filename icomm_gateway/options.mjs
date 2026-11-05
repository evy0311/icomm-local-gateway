export function optionEnvironment(options) {
  const url = new URL(options.mqtt_url);
  if (!['mqtt:', 'mqtts:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an MQTT URL without embedded credentials');
  if (!['local','bridge'].includes(options.gateway_mode) || !['redacted','full'].includes(options.capture_mode) ||
      typeof options.read_only !== 'boolean' || options.device_profile !== 'reselec3') throw new Error('Invalid App options');
  return { MQTT_URL: options.mqtt_url, MQTT_USERNAME: options.mqtt_username ?? '', MQTT_PASSWORD: options.mqtt_password ?? '',
    DEVICE_NAME: options.device_name, DEVICE_PROFILE: options.device_profile, DEVICE_ID: '',
    READ_ONLY: String(options.read_only), GATEWAY_MODE: options.gateway_mode,
    CLOUD_HOST: options.cloud_host ?? '', UPSTREAM_DNS: options.upstream_dns, CAPTURE_MODE: options.capture_mode,
    DISCOVERY_PREFIX: options.discovery_prefix, DATA_FILE: '/data/state.json', HA_INGRESS: 'true' };
}
