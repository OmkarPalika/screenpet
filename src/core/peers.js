'use strict';

// Who, off this network, the pet is allowed to talk to - and who is allowed to
// talk back. Pure address handling: no sockets, no Electron, so the rules that
// decide what leaves this machine can be tested without either.
//
// The LAN feature needs none of this. Two pets on one network find each other
// through a multicast group with a hop limit of one, and that hop limit is a
// guarantee in the packets rather than a promise in a document - the first
// router decrements it to zero and drops it. It cannot leave, so there is
// nothing to decide.
//
// A pet in another city is a different question, and it is worth being exact
// about which promise it costs. The contents are unaffected: what crosses is
// core/playdate.js either way, a fixed allowlist with no free-text field, and no
// transport can widen it. What changes is that the packet is now addressed
// somewhere a router will carry it, and so:
//
//   - the far end learns your IP address, which is roughly your city and your
//     internet provider
//   - the far end learns when your machine is on and when you are at it, because
//     a beacon every three seconds is exactly that log
//
// Neither is on the wire. Both are real. So the rule is that this list is the
// only thing that can produce a routable packet, it is empty until somebody
// types an address into it, and the same list is the only thing that lets a
// packet from off the network be parsed at all.
//
// That last half closes a hole that predates the feature: the socket binds
// 0.0.0.0, which receives unicast as well as the group, so before this file any
// host that could reach the port got its message parsed. Now an address has to
// be either on one of this machine's own networks or in the list.

// How many far friends. Eight, to match the ceiling on how many pets may be on
// screen at once - a list longer than the thing it feeds is a setting that
// silently does nothing.
const MAX_LIST = 8;

// How long a port we learned from an arriving packet is trusted.
//
// A friend behind a router is not reachable on the port we send to; they are
// reachable on whichever port their router rewrote it to, and only for as long
// as that router keeps the mapping. Beacons every three seconds hold one open,
// so this only has to outlast an ordinary gap - ten missed beacons - and then
// fall back rather than keep aiming at a hole that has closed.
const PORT_TTL_MS = 30000;

const QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * A dotted quad, as four numbers, or null.
 *
 * IPv4 only, because the socket is udp4 - this is not a preference to be
 * revisited, it is the same decision made once. Tailscale and ZeroTier both hand
 * out an IPv4 address, so the common case is covered.
 *
 * Leading zeros are refused rather than trimmed. "0177.0.0.1" is 127.0.0.1 to
 * any parser that reads a leading zero as octal and something else entirely to
 * one that does not, and an address that means two things depending on who is
 * reading it has no business being in an allowlist.
 */
function parse(v) {
  if (typeof v !== 'string') return null;
  const m = QUAD.exec(v.trim());
  if (!m) return null;
  const text = m.slice(1);
  if (text.some((s) => s.length > 1 && s[0] === '0')) return null;
  const parts = text.map(Number);
  return parts.some((n) => n > 255) ? null : parts;
}

/**
 * One address, normalised, or null if it is not one we will send to.
 *
 * The single bound at 224 does more work than it looks like: it refuses the
 * whole multicast range, the reserved range above it, and 255.255.255.255. A
 * broadcast or group address in this list would turn "send to my friend" into
 * "send to everyone", which is the one mistake in this file that would be worth
 * anything to an attacker - and it would be made by a user typing the wrong
 * thing, not by an attacker, which is why it is caught here rather than warned
 * about in the interface.
 */
function cleanAddr(v) {
  const p = parse(v);
  if (!p) return null;
  if (p[0] === 0) return null; // 0.0.0.0/8 - "this network", not a destination
  if (p[0] >= 224) return null; // multicast, reserved, and the broadcast address
  return p.join('.');
}

/** The saved list, validated. Anything unrecognised is dropped, not repaired. */
function list(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (out.length >= MAX_LIST) break;
    const a = cleanAddr(v);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

const toInt = (p) => (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);

/**
 * Is this address on one of the networks this machine is actually on?
 *
 * The mask comes from the interface rather than from a guess, so "my network"
 * means whatever the machine already believes it means - including the loopback
 * interface, which is how two copies of the app on one desk hear each other.
 *
 * @param {string} addr
 * @param {Array<{address?: string, netmask?: string}>} ifaces  os.networkInterfaces(), flattened
 */
function sameNetwork(addr, ifaces) {
  const a = parse(addr);
  if (!a || !Array.isArray(ifaces)) return false;
  const want = toInt(a);
  for (const n of ifaces) {
    const base = parse(n && n.address);
    const mask = parse(n && n.netmask);
    if (!base || !mask) continue;
    const m = toInt(mask);
    if ((toInt(base) & m) === (want & m)) return true;
  }
  return false;
}

/**
 * May we read what this address sent us?
 *
 * Two ways in and no third: a network this machine is on, or an address in the
 * list. Everything else is dropped before the parser sees it, which means the
 * far half of this feature is symmetrical - the people you can talk to are
 * exactly the people who can talk to you.
 */
function allows(from, peerList, ifaces) {
  const a = cleanAddr(from);
  if (!a) return false;
  if (Array.isArray(peerList) && peerList.includes(a)) return true;
  return sameNetwork(a, ifaces);
}

/** A port number as it may appear in a datagram, or null. */
function cleanPort(v) {
  return Number.isInteger(v) && v > 0 && v <= 65535 ? v : null;
}

/**
 * Which port to send this friend's next message to.
 *
 * The one we last heard them on, while that is recent enough to still be open,
 * and the well-known one otherwise. This is what lets a friend behind a router
 * be reached at all without both ends forwarding a port: their packet to us
 * opens a mapping, we notice which port it came out of, and we aim at that.
 *
 * It cannot redirect anything anywhere. The port is stored against the address
 * it arrived from and only ever used for that same address, so the most a peer
 * can do with it is change which port on their own machine we talk to.
 *
 * @param {{port: number, at: number}|undefined} entry  what we last heard
 * @param {number} now
 * @param {number} fallback  the well-known port
 */
function backPort(entry, now, fallback) {
  if (!entry || typeof entry !== 'object') return fallback;
  const port = cleanPort(entry.port);
  if (port === null || !Number.isFinite(entry.at)) return fallback;
  return now - entry.at < PORT_TTL_MS ? port : fallback;
}

module.exports = {
  list, cleanAddr, sameNetwork, allows, cleanPort, backPort, MAX_LIST, PORT_TTL_MS,
};
