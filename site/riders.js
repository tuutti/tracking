// The participants: their positions, progress and track lines.
import { cfg, FINISH_TOLERANCE_M, state } from './context.js';
import { map } from './map.js';
import { createCheckpointTracker, createOdometer, createProgressTracker } from './progress.js';

// Participants without a colour of their own, in event order. No blues (the route).
const PALETTE = [cfg.brandColor, '#2a9d8f', '#8e44ad', '#d4a017', '#d62f7f', '#5c7c2c', '#6d4c41', '#e07b00'];

// One participant: its track, progress and map layers.
export function addRider(p, index) {
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
export function hasFinished(r) {
  return state.cp ? !!r.cpTracker?.finished : state.route.length - r.progress <= FINISH_TOLERANCE_M;
}

// A participant's start changed on the server: forget their track.
function restartRider(r, rideStart) {
  r.rideStart = rideStart;
  r.positions = [];
  r.ids.clear();
  resetTracker(r);
}

export function merge(r, positions) {
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
export function syncRiders(data) {
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
