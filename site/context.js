// What the modules share: the settings, the language, the event and the page state.
import { pickLanguage, strings } from './i18n.js';

export const cfg = window.TRACKER_CONFIG;

// Colours from config.js override the stylesheet's; the map reads them from there.
const root = document.documentElement;
if (cfg.brandColor) {
  root.style.setProperty('--brand', cfg.brandColor);
}
if (cfg.routeColor) {
  root.style.setProperty('--route', cfg.routeColor);
}
export const cssColor = (name) =>
  getComputedStyle(root).getPropertyValue(name).trim();
export const params = new URLSearchParams(location.search);
export const LANG_KEY = 'lang';
let rememberedLang = null;
try {
  rememberedLang = localStorage.getItem(LANG_KEY);
} catch {
  // Storage blocked: config.js or ?lang= decides.
}
// Without a language in config.js, the one the server wrote into <html lang> (PAGE_LANG).
export const lang = pickLanguage(
  cfg.lang ?? document.documentElement.lang,
  params.get('lang'),
  rememberedLang,
);
export const T = strings(lang);
// The event to show: /event/<id> (tracker-backend), or ?event=<id> on a static host.
export const EVENT_ID =
  decodeURIComponent(
    location.pathname.match(/\/event\/([^/]+)\/?$/)?.[1] ?? '',
  ) || params.get('event');
export const EVENT_URL = `${cfg.apiUrl}/events/${encodeURIComponent(EVENT_ID)}`;
export const FINISH_TOLERANCE_M = 300;

export const $ = (id) => document.getElementById(id);

export const state = {
  ready: false, // the route or course has loaded
  route: null, // planned route ('route' events)
  cp: null, // { checkpoints, sections, required } for 'checkpoints' events: start, control points, finish
  eventStart: null, // ms: the earliest participant's start; the timeline begins here
  rideEnd: null, // ms, once the event has an end on the server
  record: null, // { seconds, label } from the event, or null for none
  riders: [], // in event order, see addRider()
  selected: params.get('participant'), // participant id shown in detail, or null for the list
  lastFetchOk: 0,
  failures: 0,
  follow: true,
  rewindT: null, // ms: the moment shown with the rewind slider, or null for live
};

// The participant whose details are shown: the chosen one, or the only one.
export function selectedRider() {
  if (state.riders.length === 1) {
    return state.riders[0];
  }
  return state.riders.find((r) => r.id === state.selected) ?? null;
}

// The event is over without reaching the finish (abandoned, or a test).
export const isEnded = (now) => state.rideEnd != null && now >= state.rideEnd;

// Before the first track answer (or failure), nothing is known about positions.
export const loading = () => !state.lastFetchOk && !state.failures;
