import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ANS_TYPES, decodeAnsPacket, decodeAnsRegistration, encodeAnsPacket } from './ans-protocol.mjs';

// One heater per gateway. No DNS resolver or cloud client is used here.
export class LocalAnsService {
  constructor({ identity, send, record = () => {}, now = () => performance.now(),
    random = randomBytes, wallNow = Date.now, persist = () => {} }) {
    Object.assign(this, { identity, send, record, now, random, wallNow, persist });
    this.clockOffset = 0; this.session = null; this.pendingId = null; this.registrations = new Map();
    this.stats = { received: 0, sent: 0, rejected: 0, errors: 0, registrations: 0, notifications: 0, poll_requests: 0 };
  }
  clock() { return Math.floor(this.now() + this.clockOffset) >>> 0; }
  snapshot() {
    const s = this.session;
    if (!s) return null;
    return { version: 1, registration: s.registration, header: s.header.toString('base64'),
      remote: s.remote, sequence: s.sequence, lastPacket: s.lastPacket ?? null,
      lastSeenAt: this.wallNow() - (this.now() - s.lastSeen),
      savedAt: this.wallNow(), serverClock: this.clock() };
  }
  save() { this.persist(this.snapshot()); }
  restore(saved) {
    try {
      if (!saved || saved.version !== 1) return false;
      const { identity, key } = this.material();
      const proof = Buffer.from(saved.registration, 'base64');
      const registration = decodeAnsRegistration(proof, key, identity.dsn);
      const age = this.wallNow() - saved.lastSeenAt;
      const elapsed = this.wallNow() - saved.savedAt;
      if (registration.argument < 5 || registration.argument > 300 || age < 0 ||
          age > Math.max(90000, registration.argument * 3000 + 10000) || elapsed < 0 ||
          !Number.isInteger(saved.sequence) || saved.sequence < 0 || saved.sequence > 65535 ||
          !Number.isInteger(saved.serverClock) || saved.serverClock < 0 || saved.serverClock > 0xffffffff ||
          typeof saved.remote?.address !== 'string' || !Number.isInteger(saved.remote.port) ||
          saved.remote.port < 1 || saved.remote.port > 65535) return false;
      const header = Buffer.from(saved.header, 'base64');
      if (header.length !== 8 || header.readUInt32LE(0) !== 4 || header.readUInt16LE(6) !== 2) return false;
      const last = saved.lastPacket ? decodeAnsPacket(Buffer.from(saved.lastPacket, 'base64'), key) : null;
      if (last && (!last.header.equals(header) ||
          ![ANS_TYPES.keepalive, ANS_TYPES.probe, ANS_TYPES.probeReply, ANS_TYPES.notifyReply].includes(last.type))) return false;
      this.clockOffset = ((saved.serverClock + elapsed) >>> 0) - this.now();
      this.session = { endpoint: `${saved.remote.address}:${saved.remote.port}`, remote: saved.remote, key, header,
        sequence: saved.sequence, registration: saved.registration, registrationSequence: registration.sequence,
        registrationClock: registration.senderClock, interval: registration.argument * 1000,
        lastSeen: this.now() - age, lastClock: last?.senderClock ?? registration.senderClock,
        lastPacket: saved.lastPacket, ready: false, probeAt: this.now() + 1000, notice: null };
      this.registrations.set(proof.subarray(-20).toString('hex'), true);
      this.record('ans.local.resumed', {});
      return true;
    } catch { return false; }
  }
  status() { return { ...this.stats, connected: Boolean(this.session), poll_ready: Boolean(this.session?.ready),
    poll_status: this.lastPoll?.status ?? 'idle', last_poll_at: this.lastPoll?.at ?? null }; }
  material() {
    const identity = this.identity();
    if (!identity?.dsn || !identity.ansKey) throw new Error('Local lookup required before ANS');
    const key = Buffer.from(identity.ansKey, 'base64');
    if (key.length !== 64) throw new Error('Invalid local notification material');
    return { identity, key };
  }
  emit(type, sequence, argument = 0) {
    const session = this.session;
    if (!session) return;
    const packet = encodeAnsPacket({ header: session.header, type, sequence,
      senderClock: this.clock(), argument }, session.key);
    this.record('ans.local.sent', { message_type: type, sequence, bytes: packet.length,
      payload_base64: packet.toString('base64') });
    this.save();
    this.send(packet, session.remote, (error) => {
      if (error) { this.stats.errors++; this.record('ans.local.failure', { reason: 'send_failed' }); }
      else this.stats.sent++;
    });
  }
  nextSequence() { this.session.sequence = (this.session.sequence + 1) & 0xffff; return this.session.sequence; }
  receive(packet, remote) {
    this.stats.received++;
    try {
      this.tick();
      const { identity, key } = this.material();
      const endpoint = `${remote.address}:${remote.port}`;
      if (packet.length !== 40) {
        const registration = decodeAnsRegistration(packet, key, identity.dsn);
        if (registration.argument < 5 || registration.argument > 300) throw new Error('Invalid keepalive interval');
        const prior = this.session;
        const fingerprint = packet.subarray(-20).toString('hex');
        const duplicate = prior && prior.endpoint === endpoint && prior.registrationSequence === registration.sequence &&
          prior.registrationClock === registration.senderClock && prior.key.equals(key);
        if (this.registrations.has(fingerprint) && !duplicate) throw new Error('Replayed registration');
        if (!prior || prior.endpoint !== endpoint || prior.registrationSequence !== registration.sequence || prior.registrationClock !== registration.senderClock ||
            !prior.key.equals(key)) {
          this.session = { endpoint, remote: { address: remote.address, port: remote.port }, key,
            // The server assigns an opaque session identifier between the
            // observed framing bytes. No vendor identifier is reused.
            header: Buffer.concat([Buffer.from([4, 0, 0, 0]), this.random(2), Buffer.from([2, 0])]),
            registration: packet.toString('base64'),
            sequence: registration.sequence, registrationSequence: registration.sequence, registrationClock: registration.senderClock,
            interval: registration.argument * 1000, lastSeen: this.now(),
            lastClock: registration.senderClock, probeAt: this.now() + 30000, notice: null, ready: false };
          this.registrations.set(fingerprint, true);
          if (this.registrations.size > 64) this.registrations.delete(this.registrations.keys().next().value);
          this.stats.registrations++;
          this.record('ans.local.registered', { interval_seconds: registration.argument });
        }
        this.session.lastSeen = this.now();
        this.emit(ANS_TYPES.registered, registration.sequence, registration.argument);
        return true;
      }
      const session = this.session;
      if (!session || session.remote.address !== remote.address || !session.key.equals(key)) throw new Error('Unknown ANS session');
      const message = decodeAnsPacket(packet, key);
      if (!message.header.equals(session.header)) throw new Error('Different ANS session');
      if (![ANS_TYPES.keepalive, ANS_TYPES.probe, ANS_TYPES.probeReply, ANS_TYPES.notifyReply].includes(message.type)) throw new Error('Invalid client message');
      const elapsed = (message.senderClock - session.lastClock) >>> 0;
      // Permit short reordering/retransmission, but reject older captured traffic.
      if (elapsed > 0x80000000 && ((session.lastClock - message.senderClock) >>> 0) > 5000) throw new Error('Old ANS message');
      if (elapsed <= 0x80000000) session.lastClock = message.senderClock;
      session.remote = { address: remote.address, port: remote.port }; session.endpoint = endpoint;
      session.lastSeen = this.now(); session.ready = true;
      session.lastPacket = packet.toString('base64');
      this.save();
      this.record('ans.local.message', { message_type: message.type, sequence: message.sequence });
      if (message.type === ANS_TYPES.probe) this.emit(ANS_TYPES.probeReply, message.sequence);
      if (message.type === ANS_TYPES.keepalive) this.emit(ANS_TYPES.keepaliveReply, message.sequence);
      if (message.type === ANS_TYPES.notifyReply && session.notice?.sequence === message.sequence) {
        session.notice.acknowledged = true;
        if (this.lastPoll?.sequence === message.sequence && this.lastPoll.status === 'requested') this.lastPoll.status = 'acknowledged';
      }
      this.maybeNotify();
      return true;
    } catch {
      this.stats.rejected++;
      this.record('ans.local.rejected', { reason: 'invalid_session_or_packet' });
      return false;
    }
  }
  requestPoll() {
    this.tick();
    const session = this.session;
    const { key } = this.material();
    if (!session?.ready || !session.key.equals(key)) throw new Error('Waiting for a live authenticated UDP connection');
    if (this.lastPoll && this.now() - this.lastPoll.started < 10000) throw new Error('Wait ten seconds before polling again');
    session.notice = { id: this.pendingId ?? 'manual-poll', sequence: this.nextSequence(),
      attempts: 1, at: this.now(), acknowledged: false };
    this.lastPoll = { started: this.now(), at: new Date(this.wallNow()).toISOString(), status: 'requested', sequence: session.notice.sequence };
    this.stats.poll_requests++; this.stats.notifications++;
    this.record('ans.local.poll_requested', { sequence: session.notice.sequence });
    this.emit(ANS_TYPES.notify, session.notice.sequence);
  }
  polled() {
    if (!this.lastPoll || this.now() - this.lastPoll.started > 30000 || this.lastPoll.status === 'fetched') return;
    this.lastPoll.status = 'fetched';
    if (this.session?.notice?.sequence === this.lastPoll.sequence) this.session.notice.acknowledged = true;
    this.record('ans.local.poll_fetched', {});
  }
  setPending(id) {
    if (id !== this.pendingId && this.session) this.session.notice = null;
    this.pendingId = id;
    this.maybeNotify();
  }
  maybeNotify() {
    const session = this.session;
    if (!this.pendingId || !session?.ready || session.notice) return;
    session.notice = { id: this.pendingId, sequence: this.nextSequence(), attempts: 1, at: this.now(), acknowledged: false };
    this.stats.notifications++;
    this.emit(ANS_TYPES.notify, session.notice.sequence);
  }
  tick() {
    const session = this.session;
    if (!session) return;
    const current = this.now();
    if (current - session.lastSeen > Math.max(90000, session.interval * 3 + 10000)) {
      this.session = null; this.save(); this.record('ans.local.expired', {}); return;
    }
    if (session.ready && current >= session.probeAt) {
      this.emit(ANS_TYPES.probe, this.nextSequence()); session.probeAt = current + 30000;
    }
    const notice = session.notice;
    if (notice && !notice.acknowledged && notice.attempts < 3 && current - notice.at >= 4000) {
      notice.at = current; notice.attempts++; this.emit(ANS_TYPES.notify, notice.sequence);
    }
  }
}
