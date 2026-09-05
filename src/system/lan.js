'use strict';

// The transport for playdates: one UDP multicast socket, and nothing else.
//
// Multicast rather than a server because the feature does not need one and a
// server is a thing that could be logged. There is no relay, no account, no
// pairing code and no address book - two copies of the app on one network hear
// each other because they are listening to the same group, and that is the whole
// of the mechanism.
//
// Two properties do the security work, and both are set below rather than
// documented:
//
//   setMulticastTTL(1)      routers do not forward these packets. They reach the
//                           local segment and stop. This is not a firewall rule
//                           anyone has to remember - a TTL of 1 is decremented
//                           to zero by the first hop and dropped.
//   setMulticastLoopback    left on, so two copies on one machine can meet, and
//                           our own id is filtered in onMessage.
//
// What may be in a packet is core/playdate.js, which is a fixed allowlist with
// no free-text field. This file never inspects or constructs a message; it moves
// strings, and refuses ones that are too long before they reach the parser.

const dgram = require('dgram');
const os = require('os');

// Administratively scoped IPv4 multicast (239.0.0.0/8) - the range reserved for
// exactly this, private to an organisation and never routed to the internet.
const GROUP = '239.255.42.99';
const PORT = 41234;

// A ceiling on how fast one address may talk to us, so a peer cannot make this
// process parse JSON as fast as it can send.
//
// It is per source address rather than per pet id, because the id is the
// sender's claim and the address is the network's - but that also means two
// copies of the app on one machine share the budget, and a beacon landing on
// the same tick as somebody pressing "Play together" would drop one of them.
// A tenth of a second is short enough that a real collision is rare and still a
// hard limit of ten messages a second from any one host, which for 130-byte
// payloads is nothing.
const MIN_GAP_MS = 100;

// How many distinct ids we will track at once. Nothing stops somebody making up
// a new id per packet, so the throttle table needs a ceiling or it is a memory
// leak with a network interface.
const MAX_SEEN = 32;

/**
 * Join the group and start listening.
 *
 * Every failure is reported and swallowed. A machine with multicast disabled, a
 * firewall that refuses the bind, a network with no interface up - none of them
 * are allowed to be the reason the desktop pet does not start.
 *
 * @param {object} opts
 * @param {(text: string, from: string) => void} opts.onMessage  one raw payload
 * @param {(err: Error) => void} [opts.onError]
 * @param {number} [opts.maxBytes]  refuse anything longer, before parsing
 * @returns {{send: Function, close: Function, ready: () => boolean}}
 */
function open({ onMessage, onError = () => {}, maxBytes = 512 } = {}) {
  let sock = null;
  let joined = false;
  // id -> last accepted, for the throttle above.
  const seen = new Map();

  const fail = (err) => {
    onError(err instanceof Error ? err : new Error(String(err)));
  };

  try {
    // reuseAddr so a second copy on the same machine can bind the same port,
    // which is how this gets tested at all without two computers.
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch (err) {
    fail(err);
    return { send: () => false, close: () => {}, ready: () => false };
  }

  sock.on('error', (err) => {
    fail(err);
    try { sock.close(); } catch { /* already gone */ }
    joined = false;
  });

  sock.on('message', (buf, rinfo) => {
    // Length first, before anything looks at the contents. The cap is the
    // protocol's, passed in rather than duplicated here.
    if (!buf || buf.length > maxBytes) return;
    const now = Date.now();
    // Throttled per source address, because the id inside is the sender's claim
    // and the address is the network's. Ids are checked again upstairs.
    const from = rinfo && rinfo.address ? String(rinfo.address) : '?';
    const last = seen.get(from) || 0;
    if (now - last < MIN_GAP_MS) return;
    if (seen.size >= MAX_SEEN && !seen.has(from)) return;
    seen.set(from, now);
    try {
      onMessage(buf.toString('utf8'), from);
    } catch (err) {
      fail(err);
    }
  });

  sock.on('listening', () => {
    try {
      // The line that pins this to the local segment. Everything else in this
      // feature is a nicety; this is the guarantee.
      sock.setMulticastTTL(1);
      sock.setMulticastLoopback(true);
    } catch (err) {
      return fail(err);
    }
    // Join on the default interface, and then on every real IPv4 one as well.
    //
    // A Windows laptop routinely has five: Wi-Fi, Ethernet, a VPN, a Hyper-V
    // switch and WSL. Joining only the default one means the pets meet or do not
    // depending on which of those the machine happened to prefer, which is a
    // support question nobody can answer. Each join is attempted on its own and
    // a failure is ignored, because a down or unsupported interface is normal.
    const tried = [null, ...Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address)];
    for (const iface of tried) {
      try {
        if (iface) sock.addMembership(GROUP, iface);
        else sock.addMembership(GROUP);
        joined = true;
      } catch { /* this interface will not carry it; another one may */ }
    }
    // ponytail: sending still goes out of whatever interface the OS picks, so a
    // machine whose default route is a VPN can hear the pets on the LAN without
    // being heard back. setMulticastInterface per send would fix it, at the cost
    // of a send loop and a socket option on the hot path; worth doing only if
    // somebody reports it.
    if (!joined) fail(new Error('no interface would join the group'));
  });

  try {
    sock.bind(PORT);
  } catch (err) {
    fail(err);
  }

  return {
    ready: () => joined,
    send(text) {
      if (!joined || typeof text !== 'string') return false;
      try {
        sock.send(text, PORT, GROUP);
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },
    close() {
      joined = false;
      seen.clear();
      try { sock.dropMembership(GROUP); } catch { /* never joined */ }
      try { sock.close(); } catch { /* already closed */ }
    },
  };
}

module.exports = { open, GROUP, PORT, MIN_GAP_MS, MAX_SEEN };
