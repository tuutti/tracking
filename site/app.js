import { LANGUAGES, localized, pickLanguage, strings, translatePage } from './i18n.js';
import {
  buildRoute,
  createCheckpointTracker,
  createOdometer,
  createProgressTracker,
  currentSpeed,
  interpolate,
  movingStats,
  parseCourse,
  parseGpx,
  pointAt,
  recentSpeed,
  recordPace,
  remainingVia,
  sliceTo,
} from './progress.js';

const cfg = window.TRACKER_CONFIG;
const params = new URLSearchParams(location.search);
const LANG_KEY = 'lang';
let rememberedLang = null;
try {
  rememberedLang = localStorage.getItem(LANG_KEY);
} catch {
  // Storage blocked: config.js or ?lang= decides.
}
// Without a language in config.js, the one the server wrote into <html lang> (PAGE_LANG).
const lang = pickLanguage(cfg.lang ?? document.documentElement.lang, params.get('lang'), rememberedLang);
const T = strings(lang);
// The event to show: /event/<id> (tracker-backend), or ?event=<id> on a static host.
const EVENT_ID = decodeURIComponent(location.pathname.match(/\/event\/([^/]+)\/?$/)?.[1] ?? '') || params.get('event');
const EVENT_URL = `${cfg.apiUrl}/events/${encodeURIComponent(EVENT_ID)}`;
const FINISH_TOLERANCE_M = 300;
const OVERLAP_MS = 10 * 60 * 1000; // re-fetch a little history in case of late uploads
const INTERPOLATE_MAX_MS = 30 * 60 * 1000; // rewound, glide between fixes up to this far apart
// Part of the track URL; raise it to bypass cached answers.
const TRACK_FORMAT = '3';
// Participants without a colour of their own, in event order. No blues (the route).
const PALETTE = [cfg.brandColor, '#2a9d8f', '#8e44ad', '#d4a017', '#d62f7f', '#5c7c2c', '#6d4c41', '#e07b00'];

const $ = (id) => document.getElementById(id);

const state = {
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
function selectedRider() {
  if (state.riders.length === 1) return state.riders[0];
  return state.riders.find((r) => r.id === state.selected) ?? null;
}

// ---------- Map ----------

document.documentElement.style.setProperty('--brand', cfg.brandColor);
document.documentElement.style.setProperty('--route', cfg.routeColor);
translatePage(T, lang);

// FI | EN in the top bar: reloads with ?lang= and remembers the choice.
for (const code of LANGUAGES) {
  const a = document.createElement('a');
  const url = new URL(location.href);
  url.searchParams.set('lang', code);
  a.href = url;
  a.textContent = code.toUpperCase();
  a.lang = code;
  a.hreflang = code;
  if (code === lang) a.setAttribute('aria-current', 'true');
  a.addEventListener('click', () => {
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      // Storage blocked: the link's ?lang= still applies.
    }
  });
  $('lang-switch').append(a);
}
$('lang-switch').setAttribute('aria-label', T.language);

// The event's title and subtitle, from the API; the generic heading until then.
function showEventInfo(data) {
  const title = localized(data.title, lang);
  const subtitle = localized(data.subtitle, lang);
  $('title').textContent = title || T.heading;
  $('subtitle').textContent = subtitle || '';
  $('subtitle').hidden = !subtitle;
  document.title = title || T.docTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', subtitle || T.description);
}

const map = L.map('map', { zoomControl: false, attributionControl: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);
// Tells Leaflet when the panel changes the map's size.
new ResizeObserver(() => map.invalidateSize()).observe($('map'));

L.tileLayer(cfg.tileUrl, { maxZoom: 18, attribution: cfg.tileAttribution }).addTo(map);

const plannedLine = L.polyline([], { color: cfg.routeColor, weight: 4, opacity: 0.55 }).addTo(map);
// Checkpoint events: parcours sections (above the riders' tracks) and checkpoint markers.
const courseLayer = L.featureGroup().addTo(map);
map.createPane('parcours').style.zIndex = 450;
let cpMarkers = [];
// The shown participant's progress along the route.
const coveredLine = L.polyline([], { color: cfg.brandColor, weight: 5, opacity: 0.9 }).addTo(map);
// look: 'active' (pulsing), 'idle' (ride over: no pulse) or 'stale' (grey).
const riderIcon = (r, look) =>
  L.divIcon({
    className: `rider ${look}`,
    html: `<span class="pulse" style="--c:${r.color}"></span><span class="dot" style="--c:${r.color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
// Where the previous record would be now, at its average pace.
let recordMarker = null;

map.on('dragstart', () => setFollow(false));
$('btn-rider').addEventListener('click', () => {
  setFollow(true);
  centerOnRider(true);
});
$('btn-route').addEventListener('click', () => {
  setFollow(false);
  fitRoute();
});

// Collapsible details on narrow screens, remembered per viewer.
const PANEL_KEY = 'panelCollapsed';
const panel = document.querySelector('.panel');

function setCollapsed(collapsed) {
  panel.classList.toggle('collapsed', collapsed);
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  renderToggleLabel();
  map.invalidateSize();
  try {
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage blocked: don't remember.
  }
}

// "Show details" for a participant, "Show participants" for the list.
function renderToggleLabel() {
  const collapsed = panel.classList.contains('collapsed');
  const list = !selectedRider();
  $('panel-toggle-label').textContent = collapsed
    ? list ? T.showParticipants : T.showDetails
    : list ? T.hideParticipants : T.hideDetails;
}

$('panel-toggle').addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
let startCollapsed = false;
try {
  startCollapsed = localStorage.getItem(PANEL_KEY) === '1';
} catch {
  // Storage blocked: start expanded.
}
setCollapsed(startCollapsed);

function setFollow(on) {
  state.follow = on;
  $('btn-rider').setAttribute('aria-pressed', String(on));
}

function fitRoute() {
  if (state.route) map.fitBounds(plannedLine.getBounds(), { padding: [20, 20] });
  else if (state.cp) map.fitBounds(state.cp.bounds, { padding: [30, 30] });
}

// Follows the shown participant, or keeps everyone in view on the list.
function centerOnRider(zoomIn) {
  const sel = selectedRider();
  if (sel) {
    const { marker } = view(sel);
    if (marker) map.setView(marker, zoomIn ? Math.max(map.getZoom(), 12) : map.getZoom());
    return;
  }
  const points = state.riders.filter((r) => r.visible).map((r) => view(r).marker).filter(Boolean);
  if (!points.length) return;
  const bounds = L.latLngBounds(points);
  // Only move when someone has left the view.
  if (!zoomIn && map.getBounds().pad(-0.1).contains(bounds)) return;
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
}

// Shows one participant's details, or the list (id null).
function select(id) {
  state.selected = id;
  const r = state.riders.find((q) => q.id === id);
  if (r) r.visible = true;
  const url = new URL(location.href);
  if (id) url.searchParams.set('participant', id);
  else url.searchParams.delete('participant');
  history.replaceState(null, '', url);
  setFollow(true);
  drawTrack();
  render();
  centerOnRider(true);
}

// Back to everyone; on a phone with the panel collapsed, open it so the list shows.
$('back').addEventListener('click', () => {
  if (panel.classList.contains('collapsed')) setCollapsed(false);
  select(null);
});

// ---------- Data ----------

async function fetchCourseGpx() {
  const res = await fetch(`${EVENT_URL}/route.gpx`);
  if (!res.ok) throw new Error(`Route GPX: HTTP ${res.status}`);
  return res.text();
}

// A planned route, or for checkpoint events the checkpoints and parcours sections.
// With cpRequired false visits aren't checked and riders rank by distance ridden.
function loadCourse(gpx, type, cpRadiusM, cpRequired) {
  if (type === 'checkpoints') {
    const cp = parseCourse(gpx, cpRadiusM ? { radiusM: cpRadiusM } : undefined);
    if (cp.checkpoints.length < 2) throw new Error('Course GPX needs waypoints for at least the start and the finish');
    cp.required = cpRequired !== false;
    cp.bounds = L.latLngBounds([...cp.checkpoints.map((c) => [c.lat, c.lon]), ...cp.sections.flatMap((sec) => sec.pts)]);
    state.cp = cp;
    // The checkpoint circles need a map with a view before they can be drawn.
    fitRoute();
    drawCourse();
  } else {
    const route = buildRoute(parseGpx(gpx));
    if (route.pts.length < 2) throw new Error('Route GPX has no track or route points');
    state.route = route;
    plannedLine.setLatLngs(route.pts);
  }
  state.ready = true;
}

// Parcours sections and numbered checkpoints; the start and the finish get a letter.
function drawCourse() {
  const { checkpoints, sections } = state.cp;
  // One colour per item: the waypoints first, then the parcours sections.
  const colorOf = (i) => COURSE_COLORS[i % COURSE_COLORS.length];
  // Tooltips take HTML; names come from the GPX.
  const tip = (text, color) => `<span style="color:${color}">${escapeHtml(text)}</span>`;

  sections.forEach((sec, k) => {
    const color = colorOf(checkpoints.length + k);
    for (const [c, weight, opacity] of [['#fff', 10, 0.95], [color, 6, 1]]) {
      const line = L.polyline(sec.pts, { pane: 'parcours', color: c, weight, opacity, interactive: false }).addTo(courseLayer);
      if (c === color) line.bindTooltip(tip(sec.name || T.parcours, color), { ...CP_TIP, offset: [-8, 0] });
    }
  });

  const last = checkpoints.length - 1;
  cpMarkers = checkpoints.map((c, i) => {
    const color = colorOf(i);
    const label = i === 0 ? T.startShort : i === last ? T.finishShort : String(i);
    if (state.cp.required) {
      L.circle([c.lat, c.lon], { radius: c.radiusM, color, weight: 1, opacity: 0.6, fillOpacity: 0.08, interactive: false })
        .addTo(courseLayer);
    }
    return L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        className: 'cp cp-pin',
        html: `<span style="--c:${color}"><b>${label}</b></span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 29],
        tooltipAnchor: [0, -17],
      }),
      keyboard: false,
      zIndexOffset: -500,
    })
      .bindTooltip(tip(c.name, color), CP_TIP)
      .addTo(courseLayer);
  });
}

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Names of checkpoints and parcours sections, on the left of them.
const CP_TIP = { permanent: true, direction: 'left', offset: [-12, 0], className: 'cp-tip' };
// Start, checkpoints, finish and parcours sections, one colour each, repeating.
// None is a participant's colour.
const COURSE_COLORS = [
  '#1b7a3e', '#3a6ea5', '#b5179e', '#0096c7', '#9a031e', '#5a4fcf',
  '#2b2d42', '#b07d00', '#7b6d8d', '#00838f',
];

// Fills the checkpoints the shown participant has reached (none on the list).
function renderCheckpoints(sel, s) {
  const reached = sel ? s.cpReached : 0;
  cpMarkers.forEach((m, i) => m.getElement()?.classList.toggle('reached', i < reached));
}

async function fetchTrack(since) {
  const url = new URL(`${EVENT_URL}/track`, location.href);
  url.searchParams.set('v', TRACK_FORMAT);
  if (since) url.searchParams.set('since', new Date(since).toISOString());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.participants)) throw new Error('Track in an unexpected format (no participants)');
  return data;
}

// One participant: its track, progress and map layers.
function addRider(p, index) {
  const color = p.color || PALETTE[index % PALETTE.length];
  const r = {
    id: p.id,
    name: p.name || p.id,
    color,
    rideStart: Date.parse(p.rideStart),
    positions: [], // sorted by t: { id, t, lat, lon, spd, acc, along, offRoute, offBy, progress }
    ids: new Set(),
    tracker: null, // along the route ('route' events)
    cpTracker: null, // checkpoint visits ('checkpoints' events)
    odometer: null, // distance from the fixes ('checkpoints' events)
    progress: 0, // m: along the route, or ridden
    lastOnRoute: null, // last position that snapped to the route
    trackLine: L.polyline([], { color: darker(color), weight: 2, opacity: 0.8 }).addTo(map),
    gapLine: L.polyline([], { color: darker(color), weight: 2, opacity: 0.7, dashArray: '4 8' }).addTo(map),
    marker: null,
    markerLook: null,
    visible: true, // shown on the map (the list's checkbox)
    row: null, // its button in the participant list
    check: null, // its checkbox in the participant list
  };
  resetTracker(r);
  return r;
}

function removeRider(r) {
  r.trackLine.remove();
  r.gapLine.remove();
  r.marker?.remove();
  r.row?.parentElement.remove();
}

// The ridden track: a darker shade of the participant's colour.
function darker(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * 0.65);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}

function resetTracker(r) {
  if (state.cp) {
    r.cpTracker = state.cp.required ? createCheckpointTracker(state.cp.checkpoints, { startTime: r.rideStart }) : null;
    r.odometer = createOdometer();
  } else {
    r.tracker = createProgressTracker(state.route, { startTime: r.rideStart });
  }
  r.progress = 0;
  r.lastOnRoute = null;
}

function snap(r, p) {
  if (state.cp) {
    if (r.cpTracker) {
      r.cpTracker.add(p);
      p.cps = r.cpTracker.next; // checkpoints reached by now, for rewinding
    }
    r.progress = r.odometer.add(p);
    // `along` (the distance ridden) feeds the speed estimates.
    Object.assign(p, { along: r.progress, offRoute: false, offBy: 0 });
  } else {
    Object.assign(p, r.tracker.add(p));
  }
  if (!p.offRoute) r.lastOnRoute = p;
  r.progress = state.cp ? r.progress : r.tracker.progress;
  p.progress = r.progress; // for rewinding
}

// Whether a participant has reached the finish (by their latest position).
function hasFinished(r) {
  return state.cp ? !!r.cpTracker?.finished : state.route.length - r.progress <= FINISH_TOLERANCE_M;
}

// A participant's start changed on the server: forget their track.
function restartRider(r, rideStart) {
  r.rideStart = rideStart;
  r.positions = [];
  r.ids.clear();
  resetTracker(r);
}

function merge(r, positions) {
  const lastT = r.positions.at(-1)?.t ?? -Infinity;
  const fresh = positions
    .map(([id, t, lat, lon, spd, acc, batt = null, charging = 0]) => ({ id, t, lat, lon, spd, acc, batt, charging }))
    .filter((p) => !r.ids.has(p.id) && !(p.acc > cfg.maxAccuracyM));
  if (!fresh.length) return false;

  fresh.forEach((p) => r.ids.add(p.id));
  r.positions.push(...fresh);
  if (fresh.some((p) => p.t < lastT)) {
    // Something arrived out of order (late upload): recompute from scratch.
    r.positions.sort((a, b) => a.t - b.t);
    resetTracker(r);
    r.positions.forEach((p) => snap(r, p));
  } else {
    fresh.sort((a, b) => a.t - b.t).forEach((p) => snap(r, p));
  }
  return true;
}

// Brings the participants in line with the server's list. True if one was
// added or restarted, so the incremental answer lacks part of their track.
function syncRiders(data) {
  let incomplete = false;
  const next = data.participants.map((p, i) => {
    const r = state.riders.find((q) => q.id === p.id);
    if (!r) {
      incomplete = true;
      return addRider(p, i);
    }
    r.name = p.name || p.id;
    // A participant the server couldn't fetch this time keeps what it has.
    if (p.error) return r;
    const rideStart = Date.parse(p.rideStart);
    if (Number.isFinite(rideStart) && rideStart !== r.rideStart) {
      restartRider(r, rideStart);
      incomplete = true;
    }
    return r;
  });
  state.riders.filter((r) => !next.includes(r)).forEach(removeRider);
  state.riders = next;
  return incomplete;
}

// ---------- Rewind ----------

// What the page shows of a participant: now, or as it was at state.rewindT.
// The stats use the fixes up to that moment; the marker glides between them.
function view(r) {
  if (state.rewindT == null) {
    const last = r.positions.at(-1);
    return {
      live: true,
      now: Date.now(),
      positions: r.positions,
      progress: r.progress,
      lastOnRoute: r.lastOnRoute,
      marker: last ? [last.lat, last.lon] : null,
      drawProgress: r.progress,
    };
  }
  const n = countUpTo(r.positions, state.rewindT);
  const positions = r.positions.slice(0, n);
  const prev = positions.at(-1);
  const next = r.positions[n];
  const progress = prev?.progress ?? 0;
  let marker = prev ? [prev.lat, prev.lon] : null;
  let drawProgress = progress;
  if (prev && next && next.t - prev.t <= INTERPOLATE_MAX_MS) {
    if (state.cp) {
      // No route to follow: a straight line between the fixes.
      const f = (state.rewindT - prev.t) / (next.t - prev.t);
      marker = [prev.lat + f * (next.lat - prev.lat), prev.lon + f * (next.lon - prev.lon)];
    } else {
      ({ latlng: marker, progress: drawProgress } = interpolate(state.route, prev, next, state.rewindT));
    }
  }
  return {
    live: false,
    now: state.rewindT,
    positions,
    progress,
    lastOnRoute: positions.findLast((p) => !p.offRoute) ?? null,
    marker,
    drawProgress,
  };
}

// Number of positions at or before t.
function countUpTo(positions, t) {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The slider counts minutes from the event's first start; its right end is live.
const slider = $('rewind-slider');
slider.addEventListener('input', () => {
  const min = Number(slider.value);
  state.rewindT = min >= Number(slider.max) ? null : state.eventStart + min * 60000;
  if (state.rewindT == null) play.on = false;
  redraw();
});
$('rewind-live').addEventListener('click', () => {
  state.rewindT = null;
  play.on = false;
  redraw();
});

// Playback: the rewound moment moves forward at play.speed × real time, back to
// live at the end. Playing from live starts from the start.
const play = { on: false, speed: Number($('rewind-speed').value), lastFrame: 0, lastDraw: 0 };
const PLAY_DRAW_MS = 100; // redraw at most this often while playing

$('rewind-play').addEventListener('click', () => {
  play.on = !play.on;
  if (play.on) {
    state.rewindT ??= state.eventStart;
    play.lastFrame = play.lastDraw = performance.now();
    requestAnimationFrame(step);
  }
  redraw();
});
$('rewind-speed').addEventListener('change', (e) => {
  play.speed = Number(e.target.value);
});

function step(ts) {
  if (!play.on || state.rewindT == null) return;
  // Capped for a background tab.
  state.rewindT += Math.min(ts - play.lastFrame, 250) * play.speed;
  play.lastFrame = ts;
  if (state.rewindT >= rewindEnd()) {
    state.rewindT = null;
    play.on = false;
  }
  if (!play.on || ts - play.lastDraw >= PLAY_DRAW_MS) {
    play.lastDraw = ts;
    redraw();
  }
  if (play.on) requestAnimationFrame(step);
}

// The slider's right end: now while anyone is riding; once everyone has
// finished, or the event has ended, the last position.
function rewindEnd() {
  const now = Date.now();
  const ends = state.riders
    .filter((r) => r.positions.length)
    .map((r) => {
      const last = r.positions.at(-1);
      return hasFinished(r) || isEnded(now) ? last.t : Math.max(now, last.t);
    });
  return ends.length ? Math.max(...ends) : now;
}

// The event is over without reaching the finish (abandoned, or a test).
const isEnded = (now) => state.rideEnd != null && now >= state.rideEnd;

// Slider input, redrawn once per frame.
let frame = 0;
function redraw() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    drawTrack();
    render();
    if (state.follow) centerOnRider(false);
  });
}

function renderRewind() {
  const bar = $('rewind');
  bar.hidden = !state.riders.some((r) => r.positions.length) || Date.now() < state.eventStart;
  if (bar.hidden) return;
  slider.max = String(Math.ceil((rewindEnd() - state.eventStart) / 60000));
  const live = state.rewindT == null;
  slider.value = live ? slider.max : String(Math.floor((state.rewindT - state.eventStart) / 60000));
  const playBtn = $('rewind-play');
  playBtn.classList.toggle('playing', play.on);
  playBtn.setAttribute('aria-label', play.on ? T.pause : T.play);
  playBtn.title = play.on ? T.pause : T.play;
  const label = live ? T.rewindLive : fmtTime(state.rewindT);
  $('rewind-time').textContent = label;
  slider.setAttribute('aria-valuetext', label);
  $('rewind-live').hidden = live;
  bar.classList.toggle('rewound', !live);
}

// ---------- Rendering ----------

function drawTrack() {
  const sel = selectedRider();
  const gapMs = cfg.gapMinutes * 60 * 1000;
  for (const r of state.riders) {
    const v = view(r);
    const solid = [];
    const gaps = [];
    let seg = [];
    let prev = null;
    for (const p of v.positions) {
      const ll = [p.lat, p.lon];
      if (prev && p.t - prev.t > gapMs) {
        solid.push(seg);
        gaps.push([[prev.lat, prev.lon], ll]);
        seg = [];
      }
      seg.push(ll);
      prev = p;
    }
    solid.push(seg);
    r.trackLine.setLatLngs(r.visible ? solid : []);
    r.gapLine.setLatLngs(r.visible ? gaps : []);
    // With one participant shown, the others fade into the background.
    const dim = sel && sel !== r;
    r.trackLine.setStyle({ opacity: dim ? 0.3 : 0.8 });
    r.gapLine.setStyle({ opacity: dim ? 0.25 : 0.7 });
  }
  if (sel && state.route) {
    coveredLine.setStyle({ color: sel.color });
    coveredLine.setLatLngs(sliceTo(state.route, view(sel).drawProgress));
  } else {
    coveredLine.setLatLngs([]);
  }
}

// Where a participant stands at the shown moment.
function summary(r) {
  const v = view(r);
  const now = v.now;
  const last = v.positions.at(-1);
  const age = last ? now - last.t : null;
  const common = { v, now, last, age, stale: age != null && age > cfg.staleMinutes * 60 * 1000 };
  const s = state.cp ? checkpointSummary(r, v, last) : routeSummary(v);
  const ended = !s.finished && isEnded(now);
  const movingMs = s.ref ? s.ref.t - r.rideStart : 0;
  return {
    ...common,
    ...s,
    ended,
    over: s.finished || ended,
    avgKmh: movingMs > 0 ? s.done / 1000 / (movingMs / 3.6e6) : null,
  };
}

// Along the planned route: done of total, ref = the last fix on the route.
function routeSummary(v) {
  const total = state.route.length;
  const done = Math.min(v.progress, total);
  const finished = total - done <= FINISH_TOLERANCE_M;
  return { total, done, share: done / total, finished, ref: v.lastOnRoute, remaining: finished ? 0 : total - done };
}

// Checkpoint events: the distance ridden, checkpoints reached (the start
// counts once begun) and their arrival times; ref = the finish, or the last fix.
function checkpointSummary(r, v, last) {
  // Points that needn't be visited: only the distance ridden.
  if (!state.cp.required) {
    return { total: null, done: v.progress, share: 0, cpReached: 0, arrivals: [], finished: false, ref: last ?? null, remaining: null };
  }
  const cps = state.cp.checkpoints;
  const n = cps.length;
  const begun = v.now >= r.rideStart;
  const cpReached = !begun ? 0 : v.live ? r.cpTracker.next : Math.max(1, last?.cps ?? 1);
  const arrivals = r.cpTracker.arrivals.slice(0, cpReached);
  const finished = cpReached === n;
  const here = last ? [last.lat, last.lon] : [cps[0].lat, cps[0].lon];
  return {
    total: null,
    done: v.progress,
    share: Math.max(0, cpReached - 1) / (n - 1),
    cpReached,
    arrivals,
    finished,
    ref: finished ? { t: arrivals[n - 1] } : last ?? null,
    remaining: finished ? 0 : remainingVia(cps, Math.max(1, cpReached), here),
  };
}

function render() {
  const sums = new Map(state.riders.map((r) => [r, summary(r)]));
  const sel = selectedRider();
  const now = state.rewindT ?? Date.now();

  const anyActive = [...sums.values()].some((s) => s.last && !s.over && !s.stale);
  for (const [r, s] of sums) renderMarker(r, s, sel, anyActive);
  if (state.cp) renderCheckpoints(sel, sel && sums.get(sel));
  renderStatus(sums, sel);

  const single = state.riders.length === 1;
  $('list-view').hidden = !!sel;
  $('detail-head').hidden = !sel;
  $('back').hidden = single;
  $('progress').hidden = !sel;
  $('stats').hidden = !sel;
  $('btn-rider').textContent = sel ? T.followRider : T.followAll;
  renderToggleLabel();
  if (sel) {
    $('rider-name').textContent = sel.name;
    $('rider-name').style.setProperty('--c', sel.color);
    renderDetail(sel, sums.get(sel));
  } else {
    renderList(sums);
    renderRecord(null);
  }
  renderNotice(sums, sel, now);
  renderRewind();
}

function renderMarker(r, s, sel, anyActive) {
  if (!s.last || !r.visible) {
    // No positions in the (new) ride window yet, or hidden from the map.
    r.marker?.remove();
    r.marker = null;
    r.markerLook = null;
    return;
  }
  const ll = s.v.marker;
  // Only riders still on the way pulse; grey only while a position is overdue.
  const look = s.over ? 'idle' : s.stale ? 'stale' : 'active';
  if (!r.marker) {
    r.marker = L.marker(ll, { icon: riderIcon(r, look), keyboard: false, title: r.name })
      .on('click', () => select(r.id))
      .addTo(map);
    r.markerLook = look;
  } else {
    r.marker.setLatLng(ll);
  }
  if (r.markerLook !== look) {
    r.marker.setIcon(riderIcon(r, look));
    r.markerLook = look;
  }
  // Riders no longer on the way are faded and drawn below, except the one shown.
  const dim = anyActive && look !== 'active' && sel !== r;
  r.marker.setZIndexOffset(sel === r ? 1000 : dim ? 0 : 500);
  r.marker.getElement()?.classList.toggle('dim', dim);
  // With several participants, names stay on the map.
  const multi = state.riders.length > 1;
  const tip = multi ? r.name : `${r.name} · ${fmtTime(s.last.t)}`;
  const tooltip = r.marker.getTooltip();
  if (!tooltip || tooltip.options.permanent !== multi) {
    r.marker.unbindTooltip();
    r.marker.bindTooltip(tip, multi ? { permanent: true, direction: 'right', offset: [8, 0], className: 'rider-tip' } : {});
  } else {
    r.marker.setTooltipContent(tip);
  }
  r.marker.getTooltip()?.getElement()?.classList.toggle('dim', dim);
}

// Before the first track answer (or failure), nothing is known about positions.
const loading = () => !state.lastFetchOk && !state.failures;

// The badge in the top bar: the shown participant's state, or everyone's.
function renderStatus(sums, sel) {
  const live = $('live');
  if (loading()) {
    live.textContent = T.loading;
    return;
  }
  const all = sel ? [sums.get(sel)] : [...sums.values()];
  const rewound = state.rewindT != null;
  const riding = all.some((s) => s.last && !s.stale && !s.over);
  live.classList.toggle('on', !rewound && riding && state.failures === 0);
  if (rewound) live.textContent = T.statusRewound;
  else if (all.length && all.every((s) => s.finished)) live.textContent = T.statusFinished;
  else if (all.length && all.every((s) => s.over)) live.textContent = T.statusEnded;
  else if (riding) live.textContent = T.statusLive;
  else if (!all.some((s) => s.last)) live.textContent = T.statusWaiting;
  else live.textContent = T.statusNoSignal;
}

// List order, 'distance' (furthest first) or 'name'; remembered per viewer.
const SORT_KEY = 'participantSort';
let sortBy = 'distance';
try {
  if (localStorage.getItem(SORT_KEY) === 'name') sortBy = 'name';
} catch {
  // Storage blocked: by distance.
}
const nameOrder = new Intl.Collator(T.locale);

function setSort(by) {
  sortBy = by;
  for (const btn of document.querySelectorAll('.sort button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.sort === by));
  }
  try {
    localStorage.setItem(SORT_KEY, by);
  } catch {
    // Storage blocked: don't remember.
  }
}

for (const btn of document.querySelectorAll('.sort button')) {
  btn.addEventListener('click', () => {
    setSort(btn.dataset.sort);
    render();
  });
}
setSort(sortBy);

// Shows or hides riders on the map; the list keeps them all.
function setVisible(riders, on) {
  for (const r of riders) r.visible = on;
  drawTrack();
  render();
}

// Names compared without case or accents, e.g. "ahlstrom" finds "Åhlström".
const fold = (text) => text.toLocaleLowerCase(T.locale).normalize('NFD').replace(/\p{Diacritic}/gu, '');

// The participants the search matches (everyone without a search).
function matching() {
  const q = fold($('search').value.trim());
  return state.riders.filter((r) => !q || fold(r.name).includes(q));
}

$('search').addEventListener('input', () => render());

// Shows or hides everyone the search matches.
$('toggle-all').addEventListener('change', (e) => setVisible(matching(), e.target.checked));

// Everyone with the distance ridden, furthest first or by name.
function renderList(sums) {
  const list = $('participants');
  const order = [...sums.entries()].sort(([ra, a], [rb, b]) =>
    sortBy === 'name' ? nameOrder.compare(ra.name, rb.name) : standing(a, b) || nameOrder.compare(ra.name, rb.name));
  for (const [r, s] of order) {
    if (!r.row) {
      const li = document.createElement('li');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'vis';
      check.addEventListener('change', () => setVisible([r], check.checked));
      r.check = check;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'participant';
      btn.innerHTML =
        '<span class="swatch"></span><span class="p-main"><span class="p-name"></span>' +
        '<span class="p-note muted"></span><span class="p-bar"><span></span></span></span>' +
        '<span class="p-dist"><strong></strong><small> km</small></span>';
      btn.addEventListener('click', () => select(r.id));
      li.append(check, btn);
      r.row = btn;
    }
    const row = r.row;
    row.style.setProperty('--c', r.color);
    r.check.style.setProperty('--c', r.color);
    r.check.checked = r.visible;
    r.check.setAttribute('aria-label', T.showOnMap(r.name));
    row.parentElement.classList.toggle('off', !r.visible);
    row.querySelector('.p-name').textContent = r.name;
    row.querySelector('.p-dist strong').textContent = s.last ? fmtKm(s.done) : '–';
    row.querySelector('.p-bar span').style.width = `${s.share * 100}%`;
    row.querySelector('.p-note').textContent = participantNote(s);
  }
  const shown = matching();
  for (const r of state.riders) r.row.parentElement.hidden = !shown.includes(r);
  $('no-matches').hidden = shown.length > 0;
  const visible = shown.filter((r) => r.visible).length;
  $('toggle-all').disabled = !shown.length;
  $('toggle-all').checked = visible > 0 && visible === shown.length;
  $('toggle-all').indeterminate = visible > 0 && visible < shown.length;
  // Reorder only when the order changed.
  const rows = order.map(([r]) => r.row.parentElement);
  if (rows.some((li, i) => list.children[i] !== li)) list.replaceChildren(...rows);
}

// Who's ahead: along the route (or with checkpoints that needn't be visited),
// the furthest; in checkpoint events, the most checkpoints, then who reached
// the latest of them first, then the furthest ridden.
function standing(a, b) {
  if (!state.cp?.required) return b.done - a.done;
  return b.cpReached - a.cpReached || (a.arrivals.at(-1) ?? 0) - (b.arrivals.at(-1) ?? 0) || b.done - a.done;
}

function participantNote(s) {
  if (loading()) return '';
  // No share to show when the checkpoints needn't be visited.
  const pct = !state.cp ? `${fmtNum(s.share * 100, 1)} %` : state.cp.required ? cpCount(s) : null;
  const note = (...parts) => parts.filter(Boolean).join(' · ');
  if (s.finished && s.ref) return note(pct, T.finishedAt(fmtTime(s.ref.t)));
  if (!s.last) return T.noPositions;
  if (s.ended) return note(pct, T.statusEnded);
  if (!s.v.live) return pct ?? '';
  if (s.stale) return note(pct, `${T.statusNoSignal} ${fmtAgo(s.age)}`);
  return note(pct, fmtAgo(s.age));
}

// "CP 2/5": checkpoints reached after the start, of those after the start.
const cpCount = (s) => `CP ${Math.max(0, s.cpReached - 1)}/${state.cp.checkpoints.length - 1}`;

function renderDetail(r, s) {
  const { v, now, last, done, finished, ended, ref, avgKmh, remaining, age, stale } = s;

  const pct = s.share * 100;
  $('pct').textContent = !state.cp ? `${fmtNum(pct, 1)} %` : state.cp.required ? cpCount(s) : '';
  $('bar-fill').style.width = `${pct}%`;
  $('bar-fill').style.background = r.color;
  $('bar').setAttribute('aria-valuenow', pct.toFixed(1));
  $('dist').textContent = fmtKm(done);
  // Without a route the distance left is a straight-line lower bound.
  $('remain').textContent = remaining == null ? '–' : state.cp && !finished ? `≈ ${fmtKm(remaining)}` : fmtKm(remaining);
  $('remain-note').textContent = state.cp && !finished ? T.straightLine : '';
  $('avg').textContent = avgKmh != null && done > 1000 ? fmtNum(avgKmh, 1) : '–';

  // An ended event without positions (or none loaded yet) has no ride to time.
  const elapsedEnd = finished && ref ? ref.t : ended ? last?.t ?? null : now;
  $('elapsed').textContent = elapsedEnd != null && now > r.rideStart ? fmtDuration(elapsedEnd - r.rideStart) : '–';

  $('eta-row').hidden = !!state.cp;
  $('cp-row').hidden = !state.cp?.required;
  if (state.cp?.required) {
    renderCheckpointTable(r, s);
  } else if (state.cp) {
    // Nothing to estimate without a route or checkpoints to reach.
  } else if (finished) {
    $('eta').textContent = T.finishedAt(fmtTime(ref.t));
  } else if (avgKmh && done > 5000 && !ended) {
    const eta = ref.t + (remaining / 1000 / avgKmh) * 3.6e6;
    $('eta').textContent = T.etaValue(fmtTime(eta), fmtDuration(eta - now));
  } else {
    $('eta').textContent = '–';
  }

  $('updated').textContent = !v.live
    ? T.showingAt(fmtTime(now))
    : last ? T.lastPosition(fmtAgo(age)) : loading() ? '' : T.noPositions;

  renderMotion(r, { v, now, last, stale, finished: s.over });
  renderBattery(v);
  // The record compares along a route, so not in checkpoint events.
  if (elapsedEnd == null || state.cp) renderRecord(null);
  else renderRecord(r, { now, ghostAt: elapsedEnd, ref, done, remaining, avgKmh, finished, ended });
}

// Each checkpoint after the start: when reached, the time from the previous
// one (the segment) and from the start; ones still ahead are dimmed.
function renderCheckpointTable(r, s) {
  const rows = state.cp.checkpoints.slice(1).map((c, k) => {
    const i = k + 1;
    const t = s.arrivals[i];
    const tr = document.createElement('tr');
    if (t == null) tr.className = 'ahead';
    const cells = [
      c.name,
      t != null ? fmtTime(t) : '–',
      t != null ? fmtHours(t - s.arrivals[i - 1]) : '–',
      t != null ? fmtHours(t - r.rideStart) : '–',
    ];
    for (const [j, text] of cells.entries()) {
      const td = document.createElement(j ? 'td' : 'th');
      if (!j) td.scope = 'row';
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  });
  $('cp-table').replaceChildren(...rows);
}

// Speed at the last position, recent along-route speed or how long the rider
// has been stopped, and total moving / stopped time.
function renderMotion(r, { v, now, last, stale, finished }) {
  const [startLat, startLon] = state.cp
    ? [state.cp.checkpoints[0].lat, state.cp.checkpoints[0].lon]
    : state.route.pts[0];
  const motion = movingStats(v.positions, {
    start: { t: r.rideStart, lat: startLat, lon: startLon },
    now: finished ? null : now,
  });
  $('moving').textContent = v.positions.length > 1 ? fmtHours(motion.movingMs) : '–';
  $('stopped').textContent = v.positions.length > 1 ? fmtHours(motion.stoppedMs) : '–';

  // Without a recent position there's no current speed to show.
  if (!last || stale || finished) {
    $('speed').textContent = '–';
    $('speed-note').textContent = '';
    return;
  }
  const speed = currentSpeed(v.positions);
  $('speed').textContent = speed ? `${speed.estimated ? '≈ ' : ''}${fmtNum(speed.kmh, 0)}` : '–';
  if (motion.stoppedSince != null) {
    $('speed-note').textContent = T.stoppedFor(fmtDuration(now - motion.stoppedSince));
  } else {
    const recent = recentSpeed(v.positions);
    $('speed-note').textContent = recent != null ? T.recentAvg(fmtNum(recent, 1)) : '';
  }
}

// Phone battery from the latest position that reported it.
function renderBattery(v) {
  const p = v.positions.findLast((q) => q.batt != null);
  const el = $('battery');
  el.textContent = p ? fmtNum(p.batt, 0) : '–';
  el.parentElement.classList.toggle('low', !!p && p.batt < 20 && !p.charging);
  $('battery-note').textContent = p?.charging ? T.charging : '';
}

// The shown participant against the previous record; null r hides it.
function renderRecord(r, { now, ghostAt, ref, done, remaining, avgKmh, finished, ended } = {}) {
  const rec = state.record;
  const row = $('record-row');
  row.hidden = !rec || !r || now < r.rideStart;
  if (row.hidden) {
    recordMarker?.remove();
    recordMarker = null;
    return;
  }

  const recordMs = rec.seconds * 1000;
  const pace = recordPace(state.route.length, recordMs);
  $('record-label').textContent = localized(rec.label, lang) || T.record;
  $('record-time').textContent = `(${fmtHours(recordMs)})`;

  // Where the record was when the rider was last seen, once the ride is over.
  const ghost = pointAt(state.route, pace.distanceAt(ghostAt - r.rideStart));
  if (!recordMarker) {
    recordMarker = L.circleMarker(ghost, {
      radius: 7,
      color: cfg.routeColor,
      weight: 3,
      fillColor: '#fff',
      fillOpacity: 1,
      dashArray: '3 3',
    })
      .bindTooltip(T.recordPace, { permanent: true, direction: 'right', offset: [8, 0], className: 'record-tip' })
      .addTo(map);
  } else {
    recordMarker.setLatLng(ghost);
  }

  // At the last on-route fix: the record's time to the same share, minus the rider's.
  const el = $('record');
  const proj = $('record-projection');
  if (!ref || done < 1000) {
    el.textContent = '–';
    el.className = '';
    proj.textContent = '';
    return;
  }
  const riderMs = ref.t - r.rideStart;
  const aheadMs = pace.timeAt(done) - riderMs;
  const ahead = aheadMs >= 0;
  el.className = ahead ? 'ahead' : 'behind';
  if (finished) {
    el.textContent = (ahead ? T.faster : T.slower)(fmtHours(Math.abs(aheadMs)));
    proj.textContent = T.finalTime(fmtHours(riderMs));
  } else {
    el.textContent = (ahead ? T.ahead : T.behind)(fmtHours(Math.abs(aheadMs)));
    proj.textContent =
      avgKmh && done > 5000 && !ended
        ? T.projectedTime(fmtHours(riderMs + (remaining / 1000 / avgKmh) * 3.6e6))
        : '';
  }
}

function renderNotice(sums, sel, now) {
  const s = sel ? sums.get(sel) : null;
  const anyPosition = [...sums.values()].some((q) => q.last);
  let text = null;
  let kind = 'warn';
  if (loading()) {
    text = null;
  } else if (state.rewindT != null) {
    // Rewound: only what was true at that moment, without live advice.
    if (s?.last && !s.stale && s.last.offRoute && Number.isFinite(s.last.offBy)) text = T.offRoute(fmtKm(s.last.offBy, 1));
  } else if (state.failures > 0 && now - state.lastFetchOk > cfg.pollSeconds * 2000) {
    kind = 'err';
    text = state.lastFetchOk
      ? T.serverDown(fmtAgo(now - state.lastFetchOk))
      : T.serverDownNoData;
  } else if (now < (sel ? sel.rideStart : state.eventStart)) {
    const start = sel ? sel.rideStart : state.eventStart;
    text = T.startsAt(fmtTime(start), fmtDuration(start - now));
  } else if (!s) {
    if (state.riders.length && !anyPosition && !isEnded(now)) text = T.waitingFirst;
  } else if (s.over) {
    text = null;
  } else if (!s.last) {
    text = T.waitingFirst;
  } else if (s.stale) {
    text = T.noSignal(fmtDuration(s.age));
  } else if (s.last.offRoute && Number.isFinite(s.last.offBy)) {
    text = T.offRoute(fmtKm(s.last.offBy, 1));
  }
  const el = $('notice');
  el.hidden = !text;
  el.className = `notice ${kind}`;
  if (text) el.textContent = text;
}

// ---------- Formatting ----------

const LOCALE = T.locale;
const tz = cfg.timeZone || undefined;
// 24-hour clock (h23: 00–23, never "24:05"), e.g. "la 22.05" / "Sat 22:05".
const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: tz,
});
const fmtTime = (ms) => timeFmt.format(ms);
// Locale number format, e.g. fi "1 429,5", en "1,429.5".
const fmtNum = (n, dp) =>
  n.toLocaleString(LOCALE, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtKm = (m, dp) => fmtNum(m / 1000, dp ?? (m < 100000 ? 1 : 0));

function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d} ${T.days} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

// Record-style durations: total hours, e.g. "61 h 6 min".
function fmtHours(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

function fmtAgo(ms) {
  if (ms < 60000) return T.justNow;
  return T.ago(fmtDuration(ms));
}

// ---------- Polling ----------

let timer = null;

// Asks only for what's new: from the oldest of the participants' last
// positions. Someone without positions yet needs their whole window.
function sinceForPoll() {
  if (!state.riders.length || state.riders.some((r) => !r.positions.length)) return null;
  return Math.min(...state.riders.map((r) => r.positions.at(-1).t)) - OVERLAP_MS;
}

async function poll() {
  clearTimeout(timer);
  if (document.hidden) return; // resumed by visibilitychange
  try {
    const since = sinceForPoll();
    let data = await fetchTrack(since);
    const first = !state.lastFetchOk;
    // A new participant or a moved start: the incremental answer lacks the
    // start of their window; fetch it all.
    if (syncRiders(data) && since != null) data = await fetchTrack(null);
    state.eventStart = Date.parse(data.rideStart);
    state.rideEnd = data.rideEnd ? Date.parse(data.rideEnd) : null;
    state.record = data.record ?? null;
    showEventInfo(data);
    state.failures = 0;
    state.lastFetchOk = Date.now();
    let changed = first;
    for (const p of data.participants) {
      const r = state.riders.find((q) => q.id === p.id);
      if (r && merge(r, p.positions)) changed = true;
    }
    if (changed) {
      drawTrack();
      if (state.follow) centerOnRider(first);
    }
  } catch (err) {
    console.warn('Track fetch failed:', err);
    state.failures++;
  }
  render();
  const backoff = Math.min(cfg.pollSeconds * 2 ** state.failures, 600);
  timer = setTimeout(poll, backoff * 1000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastFetchOk > cfg.pollSeconds * 1000) poll();
});
window.addEventListener('online', poll);
setInterval(() => state.ready && render(), 15000);

// ---------- Start ----------

// The event from /events, to fill in the page before the first track. Null on failure.
async function loadEvent() {
  try {
    const res = await fetch(`${cfg.apiUrl}/events`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).find((e) => e.id === EVENT_ID) ?? null;
  } catch (err) {
    console.warn('Event list fetch failed:', err);
    return null;
  }
}

function applyEvent(ev) {
  showEventInfo(ev);
  state.record = ev.record ?? null;
  state.rideEnd = ev.end ? Date.parse(ev.end) : null;
  state.eventStart = Date.parse(ev.start);
  // Until the track says otherwise, everyone starts at the event's start.
  state.riders = (ev.participants ?? []).map((p, i) => addRider({ ...p, rideStart: ev.start }, i));
}

function showError(text) {
  const el = $('notice');
  el.hidden = false;
  el.className = 'notice err';
  el.textContent = text;
  $('live').textContent = '';
  // Nothing to list or follow.
  $('panel-details').hidden = true;
  document.querySelector('.map-buttons').hidden = true;
  $('panel-toggle').hidden = true;
}

(async () => {
  if (!EVENT_ID) return showError(T.noEvent);
  let ev;
  try {
    let gpx;
    [gpx, ev] = await Promise.all([fetchCourseGpx(), loadEvent()]);
    // The event (or else the first track answer) says how to read the GPX.
    const info = ev ?? (await fetchTrack(null).catch(() => ({})));
    loadCourse(gpx, info.type ?? 'route', info.cpRadiusM, info.cpRequired);
  } catch (err) {
    console.error(err);
    return showError(T.routeError(err.message));
  }
  if (state.cp) $('pct-label').textContent = '';
  if (state.cp?.required) $('sort-standing').textContent = T.sortStanding;
  // Without checkpoints to reach there's no share done or distance left.
  document.body.classList.toggle('no-progress', !!state.cp && !state.cp.required);
  if (ev) applyEvent(ev);
  fitRoute();
  setFollow(true);
  if (ev) render();
  poll();
})();
