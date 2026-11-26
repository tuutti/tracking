// Everything you'd normally change lives here.

window.TRACKER_CONFIG = {
  // Default page language: 'en' or 'fi', or null for the page's own <html lang>
  // (English). The language in the settings menu (remembered per viewer) and
  // ?lang=en / ?lang=fi in the address override it.
  lang: null,

  // The title, subtitle, participants and previous record come with each event
  // from the API.

  // Where the API (/events, see the README) is served, without a trailing slash:
  // '' for the same place as the page (static files next to it), or for example
  // 'https://api.example.com', which has to allow this page's origin (CORS).
  // Everything here is public: never put a Traccar token or other secret in it.
  apiUrl: '',

  // Accent colour of the page and the planned route's colour, or null for the
  // stylesheet's. Each participant's ridden GPS track is drawn in a
  // darker shade of their colour.
  brandColor: null,
  routeColor: null,

  // Polling and signal handling.
  pollSeconds: 60,
  staleMinutes: 10, // marker greys out, "no signal" note appears
  gapMinutes: 15, // track drawn dashed across gaps longer than this
  maxAccuracyM: 250, // ignore fixes reported worse than this

  // Map tiles. OSM's standard tiles are fine for modest traffic; for a big
  // audience use a provider with a key (MapTiler, Stadia, Thunderforest...).
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Show times in this zone (IANA name), or null for each viewer's local time.
  timeZone: null,
};
