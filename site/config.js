// Everything you'd normally change lives here.

window.TRACKER_CONFIG = {
  // Default page language: 'en' or 'fi', or null for the server's PAGE_LANG
  // (tracker-backend's .env; English without it). The EN | FI switch (remembered per viewer)
  // and ?lang=en / ?lang=fi in the URL override it.
  lang: null,

  // The title, subtitle, participants and previous record are set per event (events.json).

  // Where /events is served, without a trailing slash. Never put a Traccar token here.
  // '' = same origin as the page (tracker-backend serves it there). For a copy of the
  // page hosted elsewhere: 'https://<TRACCAR_DOMAIN>', with that origin in ALLOWED_ORIGINS.
  apiUrl: '',

  // Brand colour (also the first participant's, unless the event gives one), planned route.
  // Each participant's ridden GPS track is drawn in a darker shade of their colour.
  brandColor: '#e4572e',
  routeColor: '#3a6ea5',

  // Polling and signal handling.
  pollSeconds: 60,
  staleMinutes: 10, // marker greys out, "no signal" note appears
  gapMinutes: 15, // track drawn dashed across gaps longer than this
  maxAccuracyM: 250, // ignore fixes reported worse than this

  // Map tiles. OSM's standard tiles are fine for modest traffic; for a big
  // audience use a provider with a key (MapTiler, Stadia, Thunderforest...).
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Show times in this zone (IANA name), or null for each viewer's local time.
  timeZone: null,
};
