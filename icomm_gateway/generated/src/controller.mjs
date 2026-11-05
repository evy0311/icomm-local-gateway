import { randomUUID } from 'node:crypto';

export class Controller {
  constructor({ state, save, profile, readOnly = true, gatewayMode = 'local', staleMs = 900000, commandMs = 900000, now = Date.now, changed = () => {} }) {
    Object.assign(this, { state, save, profile, readOnly, gatewayMode, staleMs, commandMs, now, changed });
    if (gatewayMode === 'bridge') this.readOnly = true;
    this.freshAt = null;
  }
  get available() { return this.freshAt !== null && this.now() - this.freshAt < this.staleMs; }
  get heaterConnected() {
    const status = this.bridgeStatus?.();
    if (this.gatewayMode === 'local' && typeof status?.ans?.connected === 'boolean') {
      // A quiet data stream is normal. Authenticated UDP remains the liveness
      // signal; a recent HTTP report also covers initial session establishment.
      return Boolean(status.ans.connected && status.ans.poll_ready) ||
        (this.freshAt !== null && this.now() - this.freshAt < 90000);
    }
    if (this.gatewayMode === 'bridge' && status) {
      const activity = Math.max(Date.parse(status.ans?.last_heater_packet_at ?? '') || 0,
        Date.parse(status.https?.last_response_at ?? '') || 0, Date.parse(status.http?.last_response_at ?? '') || 0);
      return activity > 0 && this.now() - activity < 90000;
    }
    return this.available;
  }
  get telemetryAvailable() {
    return Boolean(this.state.latest && this.state.telemetryValid !== false && this.heaterConnected);
  }
  get canControl() { return !this.readOnly && this.telemetryAvailable; }
  get canSetTemperature() {
    const latest = this.state.latest;
    return !this.readOnly && this.gatewayMode === 'local' && (this.telemetryAvailable ||
      Boolean(this.state.deviceId && latest && this.state.telemetryValid !== false &&
        this.profile.modes.includes(latest.mode) && Number.isFinite(latest.temperature) &&
        latest.temperature >= 32 && latest.temperature <= 150));
  }
  async commit() { await this.save(); this.changed(); }
  async identify(id) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid device ID');
    if (this.state.deviceId && id !== this.state.deviceId) throw new Error('Different device rejected');
    if (!this.state.deviceId) { this.state.deviceId = id; await this.commit(); }
  }
  async telemetry(value) {
    await this.expire();
    let decoded;
    try { decoded = this.profile.decode(value); }
    catch {
      this.freshAt = null;
      this.state.telemetryValid = false;
      this.state.lastError = 'Telemetry does not match the selected device profile';
      await this.commit();
      throw new Error(this.state.lastError);
    }
    this.freshAt = this.now();
    this.state.telemetryValid = true;
    this.state.latest = { ...decoded, received_at: new Date(this.now()).toISOString() };
    this.state.lastError = null;
    // A queued command must not be confirmed by telemetry received before delivery.
    const pending = this.state.pending;
    if (pending?.deliveredAt !== undefined && this.profile.matches(pending.target, decoded)) {
      this.state.lastCommand = { ...this.state.pending, status: 'confirmed', finishedAt: this.state.latest.received_at };
      this.state.pending = null;
    }
    await this.commit();
  }
  async fault(value) {
    const code = this.profile.decodeFault(value);
    const receivedAt = new Date(this.now()).toISOString();
    const previous = this.state.fault;
    // Faults are event-driven: keep a leak asserted until an explicit clear.
    // Another fault is not evidence that a previously reported leak is gone.
    const leak = code === 31 ? true : code === 0 ? false : previous?.leak_detected ?? null;
    this.state.fault = { code, received_at: receivedAt, leak_detected: leak,
      leak_updated_at: code === 31 || code === 0 ? receivedAt : previous?.leak_updated_at ?? null };
    await this.commit();
  }
  async command(kind, value, { allowStale = false } = {}) {
    if (this.readOnly) throw new Error('Commands are disabled (read-only mode)');
    if (allowStale && (kind !== 'temperature' || this.gatewayMode !== 'local' || !this.state.deviceId || !this.state.latest)) {
      throw new Error('Diagnostic stale-state command requires a known local heater and a temperature target');
    }
    const staleTemperature = kind === 'temperature' && this.canSetTemperature && !this.available;
    if (!this.telemetryAvailable && !allowStale && !staleTemperature) throw new Error('Waiting for fresh compatible telemetry');
    if (this.state.pending) throw new Error('Another command is pending');
    if (kind === 'cancel') throw new Error('Use cancelQueued');
    if (kind === 'vacation_days') {
      if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error('Vacation duration must be 1–99 days');
      // This helper is a duration preference in Standard mode, not an implicit mode switch.
      if (this.state.latest.mode !== 'VACATION') {
        this.state.vacationDays = value;
        await this.commit();
        return;
      }
    }
    const encoded = kind === 'mode' && value === 'VACATION'
      ? this.profile.encode('vacation_days', this.state.vacationDays)
      : this.profile.encode(kind, value);
    if (kind === 'vacation_days') this.state.vacationDays = value;
    this.state.pending = { id: randomUUID(), kind, ...encoded, status: 'queued', queuedAt: this.now(),
      ...(allowStale ? { diagnosticStaleState: true } : {}),
      ...(staleTemperature ? { temperatureWithoutFreshTelemetry: true } : {}) };
    this.state.lastError = null;
    await this.commit();
  }
  async deliver() {
    await this.expire();
    const pending = this.state.pending;
    if (!pending || pending.status !== 'queued' || this.readOnly || (!this.telemetryAvailable && !pending.diagnosticStaleState && !(pending.temperatureWithoutFreshTelemetry && this.canSetTemperature))) return null;
    pending.status = 'delivered';
    pending.deliveredAt = this.now();
    // Persist delivery before returning the frame. Never automatically resend.
    await this.commit();
    return pending.frame;
  }
  async acknowledge(value, { emptyReceipt = false } = {}) {
    const pending = this.state.pending;
    const normalize = (s) => s?.trim().replace(/\s+/g, ' ').toUpperCase();
    // The tested module posts an empty body as its command receipt. This
    // acknowledges delivery only; a fresh report must still confirm the target.
    if (pending?.status === 'delivered' && (emptyReceipt || normalize(value) === normalize(pending.frame))) {
      pending.status = 'acknowledged';
      pending.acknowledgedAt = this.now();
      await this.commit();
    }
  }
  async cancelQueued() {
    const pending = this.state.pending;
    if (!pending || pending.status !== 'queued') throw new Error('Only an undelivered command can be canceled');
    this.state.lastCommand = { ...pending, status: 'canceled', finishedAt: new Date(this.now()).toISOString() };
    this.state.pending = null;
    await this.commit();
  }
  async expire() {
    const pending = this.state.pending;
    if (pending && this.now() - pending.queuedAt >= this.commandMs) {
      this.state.lastCommand = { ...pending, status: 'timed_out', finishedAt: new Date(this.now()).toISOString() };
      this.state.pending = null;
      await this.commit();
    }
  }
  publicState() {
    return { ...(this.state.latest ?? {}),
      fault_code: this.state.fault?.code ?? null,
      fault_received_at: this.state.fault?.received_at ?? null,
      water_leak_detected: this.state.fault?.leak_detected ?? null,
      water_leak_updated_at: this.state.fault?.leak_updated_at ?? null,
      available: this.available, heater_connected: this.heaterConnected, telemetry_available: this.telemetryAvailable,
      telemetry_stale: !this.available, read_only: this.readOnly,
      gateway_mode: this.gatewayMode, temperature_commands_enabled: this.canSetTemperature, ...(this.bridgeStatus ? { bridge: this.bridgeStatus() } : {}),
      vacation_duration: this.state.vacationDays,
      command_status: this.state.pending?.status ?? this.state.lastCommand?.status ?? 'idle',
      error: this.state.lastError };
  }
}
