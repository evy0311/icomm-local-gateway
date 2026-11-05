// A bounded bridge diagnostic, not a standalone ANS server. It substitutes one
// keepalive reply only after observing a valid reply from the real server.
import { performance } from 'node:perf_hooks';
import { ANS_TYPES, decodeAnsPacket, encodeAnsPacket } from './ans-protocol.mjs';

export function createAnsKeepaliveTrial(material, { now = () => performance.now(), record = () => {} } = {}) {
  if (!Buffer.isBuffer(material) || material.length !== 64) throw new Error('Invalid ANS trial material');
  let anchor = null;
  let used = false;
  let pending = null;
  return {
    fromCloud(packet, remote) {
      let message;
      try { message = decodeAnsPacket(packet, material); } catch { return; }
      anchor = { message, at: now(), endpoint: `${remote.address}:${remote.port}` };
      record('ans.trial.cloud.decoded', { message_type: message.type, sequence: message.sequence });
    },
    fromHeater(packet, remote) {
      let message;
      try { message = decodeAnsPacket(packet, material); } catch { return null; }
      const endpoint = `${remote.address}:${remote.port}`;
      if (pending && pending.endpoint === endpoint && message.type === ANS_TYPES.keepalive) {
        record('ans.trial.next.keepalive', { elapsed_ms: Math.round(now() - pending.at),
          same_sequence: message.sequence === pending.sequence });
        pending = null;
      }
      if (used || message.type !== ANS_TYPES.keepalive || !anchor || anchor.endpoint !== endpoint ||
          !anchor.message.header.equals(message.header) || now() - anchor.at > 60000) return null;
      used = true;
      pending = { at: now(), endpoint, sequence: message.sequence };
      const reply = encodeAnsPacket({ header: message.header, type: ANS_TYPES.keepaliveReply,
        sequence: message.sequence, senderClock: (anchor.message.senderClock + Math.round(now() - anchor.at)) >>> 0,
        argument: 0 }, material);
      record('ans.trial.local.reply', { message_type: ANS_TYPES.keepaliveReply, sequence: message.sequence });
      return reply;
    },
  };
}
