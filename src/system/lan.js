'use strict';

// The transport for playdates: one UDP socket, and nothing else.
//
// Multicast rather than a server because the feature does not need one and a
// server is a thing that could be logged. There is no relay, no account and no
// pairing code - two copies of the app on one network hear each other because
// they are listening to the same group, and on one network that is the whole of
// the mechanism.
//
// Two properties do the security work there, and both are set below rather than
// documented:
//
//   setMulticastTTL(1)      routers do not forward these packets. They reach the
//                           local segment and stop. This is not a firewall rule
//                           anyone has to remember - a TTL of 1 is decremented
//                           to zero by the first hop and dropped.
//   setMulticastLoopback    left on, so two copies on one machine can meet, and
//                           our own id is filtered in onMessage.
//
// A friend in another city cannot be found by any of that, so there is a second
// path: a list of addresses the user typed, each sent to directly. It is off
// until the list has something in it, it is the only thing in this file that can
// produce a packet a router will carry, and the hop limit for those packets is
// raised only while it is non-empty. An empty list leaves every socket option
// exactly where the paragraph above puts them.
//
// The same list decides what may be read. See core/peers.js for both rules and
// for what an address in it actually costs you, which is not nothing.
//
// What may be in a packet is core/playdate.js, which is a fixed allowlist with
// no free-text field. This file never inspects or constructs a message; it moves
// strings, and refuses ones that are too long before they reach the parser.

const dgram = require('dgram');
const os = require('os');

const peerRules = require('../core/peers');

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

// How long this machine's own list of networks is trusted for.
//
// It is consulted on every inbound packet - that is what decides whether the
// sender is a neighbour - and it has to be consulted before the throttle below,
// or a stranger could fill the throttle table and lock the local network out of
// the feature. Which means it sits on the one path a flood reaches, so asking
// the operating system each time turns an unwanted packet into a syscall and
// hands an attacker a multiplier they did not have.
//
// Ten seconds: long enough that a flood costs one lookup rather than thousands,
// short enough that a VPN or a cable coming up is noticed while you are still
// looking at the screen.
const IFACE_TTL_MS = 10000;

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
 * @param {string[]} [opts.peers]  addresses off this network to send to, and the
 *   only addresses off it we will read. Empty by default and empty is the whole
 *   of the original behaviour.
 * @returns {{send: Function, close: Function, ready: () => boolean}}
 */
function open({ onMessage, onError = () => {}, maxBytes = 512, peers = [] } = {}) {
  let sock = null;
  // Two separate facts that used to be one, which was a bug.
  //
  // `joined` is whether any interface accepted the multicast group. `live` is
  // whether the socket is bound and usable at all. Sending was gated on the
  // first, so on a network that blocks multicast - guest Wi-Fi, plenty of
  // corporate ones - a named address would have been refused as well, even
  // though nothing about reaching it needs a group membership. That is the
  // exact network somebody reaches for the address list on.
  let joined = false;
  let live = false;
  // Validated once, here, rather than trusted from settings. Everything below
  // compares against this list and never against what was passed in.
  const far = peerRules.list(peers);
  // id -> last accepted, for the throttle above.
  const seen = new Map();
  // payload -> last accepted, for the duplicate check in onMessage.
  const echoes = new Map();
  // far address -> { port, at }: which port that friend's packets actually came
  // out of. Kept in memory only and never written anywhere - see the note on
  // backPort in core/peers.js for why it exists and what it cannot do.
  const backTo = new Map();
  // This machine's own networks, cached for IFACE_TTL_MS. See the note there.
  let ifaces = [];
  let ifacesAt = 0;
  const myNetworks = (now) => {
    if (now - ifacesAt >= IFACE_TTL_MS) {
      ifaces = Object.values(os.networkInterfaces()).flat();
      ifacesAt = now;
    }
    return ifaces;
  };

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
    live = false;
  });

  sock.on('message', (buf, rinfo) => {
    // Length first, before anything looks at the contents. The cap is the
    // protocol's, passed in rather than duplicated here.
    if (!buf || buf.length > maxBytes) return;
    const now = Date.now();
    // Throttled per source address, because the id inside is the sender's claim
    // and the address is the network's. Ids are checked again upstairs.
    const from = rinfo && rinfo.address ? String(rinfo.address) : '?';
    // Before the throttle, because a stranger must not be able to occupy a slot
    // in a table that has a ceiling on it. The socket is bound to 0.0.0.0 and so
    // receives unicast as well as the group; without this line any host that
    // could reach the port would have its message parsed.
    if (!peerRules.allows(from, far, myNetworks(now))) return;
    const last = seen.get(from) || 0;
    if (now - last < MIN_GAP_MS) return;
    if (seen.size >= MAX_SEEN && !seen.has(from)) return;
    seen.set(from, now);

    // The same message arriving twice by two routes.
    //
    // A friend named by address who is also on this network is reached both
    // ways, and the two copies come from two different source addresses - so the
    // throttle above, which is keyed on the address, lets both through and the
    // pet does the activity twice. That is one message, not two, and testing
    // against a machine on your own network before trying a distant one is the
    // first thing anybody will do.
    //
    // Keyed on the payload for that reason, and windowed rather than remembered:
    // two copies of one packet land milliseconds apart, while a real repeat is
    // a beacon three seconds later or a button press held off for two.
    // Where this friend is actually reachable.
    //
    // A machine behind a router is not on the port we send to; it is on whatever
    // port the router rewrote its outgoing packet to, and only while that
    // mapping lasts. Noting it means one end forwarding a port is enough for
    // both directions, where before both ends had to.
    //
    // Only for addresses in the list - a neighbour on this network is reached
    // through the group and has no mapping to learn - and only after `allows`
    // above, so nothing unlisted can put an entry here.
    if (far.includes(from)) {
      const port = peerRules.cleanPort(rinfo && rinfo.port);
      if (port !== null) backTo.set(from, { port, at: now });
    }

    const text = buf.toString('utf8');
    if (now - (echoes.get(text) || 0) < MIN_GAP_MS) return;
    if (echoes.size >= MAX_SEEN) echoes.clear();
    echoes.set(text, now);

    try {
      onMessage(text, from);
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
      // Unicast is a separate knob from the line above, which is what makes the
      // far-friend path possible without touching the guarantee the LAN path
      // rests on: group packets still die at the first router whatever this says.
      //
      // Set to 1 as well when nobody has been named. It changes no behaviour -
      // with an empty list there is no unicast send to have a hop limit - and it
      // means the "cannot leave this segment" property is true of every packet
      // this socket can emit, rather than of most of them.
      sock.setTTL(far.length ? 64 : 1);
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
    // Usable from here whatever the group did. A machine that could not join is
    // one that will not meet the pet in the next room; it can still reach the
    // one you named.
    live = true;
    if (!joined && !far.length) fail(new Error('no interface would join the group'));
  });

  try {
    sock.bind(PORT);
  } catch (err) {
    fail(err);
  }

  return {
    ready: () => live,
    send(text) {
      if (!live || typeof text !== 'string') return false;
      let sent = false;
      // Only when the group was actually joined. Sending to a group nobody
      // joined is a packet onto a network that already refused to carry it.
      if (joined) {
        try {
          sock.send(text, PORT, GROUP);
          sent = true;
        } catch (err) {
          fail(err);
        }
      }
      // One send each rather than anything cleverer. Eight is the ceiling on the
      // list and a beacon is one small packet every three seconds, so the whole
      // cost of the naive version is eight packets where there was one.
      //
      // A failure here is per-address and does not stop the rest: a friend whose
      // machine is off is the ordinary case, not an error.
      const now = Date.now();
      for (const addr of far) {
        try {
          sock.send(text, peerRules.backPort(backTo.get(addr), now, PORT), addr);
          sent = true;
        } catch (err) {
          fail(err);
        }
      }
      return sent;
    },
    close() {
      joined = false;
      live = false;
      seen.clear();
      echoes.clear();
      backTo.clear();
      try { sock.dropMembership(GROUP); } catch { /* never joined */ }
      try { sock.close(); } catch { /* already closed */ }
    },
  };
}

module.exports = { open, GROUP, PORT, MIN_GAP_MS, MAX_SEEN };
