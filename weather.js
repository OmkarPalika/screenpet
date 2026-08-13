'use strict';

// The one thing in this app that talks to a server, and the only reason it is
// here is that you switched it on.
//
// What leaves this machine when you ask about the weather: the name of a town,
// which you typed into Settings yourself. That is the entire request. No
// account, no API key, no cookie, no device identifier, nothing from the screen,
// nothing from the camera or the microphone, and no location lookup - the app
// never asks Windows or anyone else where you are, because the town is something
// you told it and can lie about.
//
// Off by default. With the setting off, this file is never called and the pet
// gives the same refusal it always gave.
//
// ponytail: Open-Meteo because it needs no key and no account, which means no
// identity attached to the request. A keyed service would tie every forecast to
// a registration, which is worse than the forecast is useful.

// Hardcoded. Not configurable, not read from settings, not overridable by
// anything the model or a skill produces - a setting that could point this at an
// arbitrary host would be a way to exfiltrate through a weather feature.
const GEO_HOST = 'https://geocoding-api.open-meteo.com';
const API_HOST = 'https://api.open-meteo.com';

const TIMEOUT_MS = 8000;

// WMO weather codes, in the words a pet would use. Anything unlisted falls back
// rather than being guessed at.
const CODES = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'freezing fog',
  51: 'drizzling', 53: 'drizzling', 55: 'drizzling hard',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'raining a bit', 63: 'raining', 65: 'pouring',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'snowing a bit', 73: 'snowing', 75: 'snowing hard', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers',
  95: 'thundery', 96: 'thundery with hail', 99: 'thundery with hail',
};

/** A town name, or null. Letters, spaces and the punctuation real place names use. */
function cleanCity(text) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/[^\p{L}\p{M}\s'.,-]/gu, ' ').replace(/\s+/g, ' ').trim();
  // Rejected rather than truncated: half a town name is a different town.
  return flat.length >= 2 && flat.length <= 60 ? flat : null;
}

function describe({ place, tempC, code, isDay }) {
  const sky = CODES[code] || 'doing something I have no word for';
  const round = Math.round(tempC);
  const feel = round <= 0 ? ' brr!' : round >= 32 ? ' phew!' : '';
  return `${place}: ${round}°C and ${sky}${isDay ? '' : ', and dark out'}.${feel}`;
}

async function get(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`the weather service said ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a town, then its current weather. Two requests, both carrying nothing
 * but the town name and the coordinates that came back for it.
 *
 * @param {string} city  what you typed in Settings
 * @param {{fetch?: Function}} opts
 * @returns {Promise<string>} one sentence for the bubble
 */
async function forecast(city, opts = {}) {
  const name = cleanCity(city);
  if (!name) throw new Error('tell me which town you are in, in settings!');

  const fetchImpl = opts.fetch || globalThis.fetch;

  const geo = await get(
    `${GEO_HOST}/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
    fetchImpl
  );
  const hit = geo && Array.isArray(geo.results) && geo.results[0];
  if (!hit || !Number.isFinite(hit.latitude)) throw new Error(`I cannot find ${name} on the map!`);

  // Coordinates are rounded to two places - about a kilometre. A forecast does
  // not need better than that, and the request should not carry better than it
  // needs.
  const lat = hit.latitude.toFixed(2);
  const lon = hit.longitude.toFixed(2);
  const now = await get(`${API_HOST}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`, fetchImpl);

  const c = now && now.current;
  if (!c || !Number.isFinite(c.temperature_2m)) throw new Error('the weather came back empty!');

  return describe({
    place: hit.name,
    tempC: c.temperature_2m,
    code: c.weather_code,
    isDay: c.is_day !== 0,
  });
}

module.exports = { forecast, cleanCity, describe, CODES, GEO_HOST, API_HOST };
