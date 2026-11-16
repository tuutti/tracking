// Route geometry and along-route progress.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Track points if present, otherwise route points. Returns [[lat, lon], ...].
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
  return nodes
    .map((n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))])
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

// Route with cumulative distance (m) at each vertex.
export function buildRoute(latlngs) {
  const pts = [];
  const cum = [];
  let total = 0;
  for (const p of latlngs) {
    if (pts.length) {
      const step = haversine(pts[pts.length - 1], p);
      if (step < 0.5) continue;
      total += step;
    }
    pts.push(p);
    cum.push(total);
  }
  return { pts, cum, length: total };
}

// Largest vertex index i with cum[i] <= d.
function indexAt(cum, d) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Point on the route at distance d (m) along it.
export function pointAt(route, d) {
  const { pts, cum } = route;
  if (d <= 0) return pts[0];
  if (d >= route.length) return pts[pts.length - 1];
  const i = indexAt(cum, d);
  const t = (d - cum[i]) / (cum[i + 1] - cum[i]);
  return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
}

// The previous record at a constant pace, by share of the route.
// distanceAt(elapsed ms) -> m, timeAt(distance m) -> elapsed ms.
export function recordPace(length, recordMs) {
  return {
    distanceAt: (ms) => Math.min(length, Math.max(0, (ms / recordMs) * length)),
    timeAt: (d) => (Math.min(Math.max(d, 0), length) / length) * recordMs,
  };
}

// Splits the ride into moving and stopped time: an interval between two
// positions is moving if the rider covered at least minKmh in a straight line.
// positions: [{ t, lat, lon }] sorted by t.
// start: { t, lat, lon } of the ride start; the time before the first fix
//   counts only when that fix is within startRadiusM of it.
// now: while stopped, the stop lasts until now.
// -> { movingMs, stoppedMs, stoppedSince (ms timestamp, or null while moving) }
export function movingStats(positions, { minKmh = 3, start = null, now = null, startRadiusM = 1000 } = {}) {
  let movingMs = 0;
  let stoppedMs = 0;
  let stoppedSince = null;
  const first = positions[0];
  const useStart =
    start && first && start.t < first.t && haversine([start.lat, start.lon], [first.lat, first.lon]) <= startRadiusM;
  const pts = useStart ? [start, ...positions] : positions;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const kmh = (haversine([a.lat, a.lon], [b.lat, b.lon]) / 1000) / (dt / 3.6e6);
    if (kmh >= minKmh) {
      movingMs += dt;
      stoppedSince = null;
    } else {
      stoppedMs += dt;
      stoppedSince ??= a.t;
    }
  }
  const lastT = pts.at(-1)?.t;
  if (stoppedSince != null && now != null && now > lastT) stoppedMs += now - lastT;
  return { movingMs, stoppedMs, stoppedSince };
}

// Along-route speed (km/h) over roughly the last windowMs before the latest
// on-route position, or null with less than minMs of data in the window.
// positions: [{ t, along (m) | null }] sorted by t.
export function recentSpeed(positions, windowMs = 30 * 60 * 1000, minMs = 10 * 60 * 1000) {
  const onRoute = positions.filter((p) => p.along != null);
  const last = onRoute.at(-1);
  if (!last) return null;
  const first = onRoute.find((p) => p.t >= last.t - windowMs);
  const dt = last.t - first.t;
  if (dt < minMs) return null;
  return Math.max(0, (last.along - first.along) / 1000) / (dt / 3.6e6);
}

// Speed at the latest fix. Fixes worse than gpsAccuracyM (Wi-Fi, cell) report 0,
// so for those the recent along-route speed is used, marked as estimated.
// positions: [{ t, spd, acc, along }] sorted by t.
// -> { kmh, estimated } or null when there's nothing to go on.
export function currentSpeed(positions, { gpsAccuracyM = 30, windowMs = 5 * 60 * 1000, minMs = 2 * 60 * 1000 } = {}) {
  const last = positions.at(-1);
  if (!last) return null;
  if (last.acc <= gpsAccuracyM) return { kmh: last.spd, estimated: false };
  const kmh = recentSpeed(positions, windowMs, minMs);
  return kmh == null ? null : { kmh, estimated: true };
}

// Where the rider was at time t between fixes a and b: along the route when
// both are on it, otherwise in a straight line.
// a, b: { t, lat, lon, offRoute, progress } -> { latlng, progress }
export function interpolate(route, a, b, t) {
  const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  if (!a.offRoute && !b.offRoute) {
    const d = a.progress + f * (b.progress - a.progress);
    return { latlng: pointAt(route, d), progress: d };
  }
  return { latlng: [a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon)], progress: a.progress };
}

// Route vertices from the start up to distance d, ending exactly at d.
export function sliceTo(route, d) {
  if (d <= 0) return [];
  const i = indexAt(route.cum, Math.min(d, route.length));
  return [...route.pts.slice(0, i + 1), pointAt(route, d)];
}

function projectOnSegment(route, i, p) {
  const a = route.pts[i];
  const b = route.pts[i + 1];
  const k = Math.cos(rad((a[0] + b[0]) / 2));
  const bx = rad(b[1] - a[1]) * k * R;
  const by = rad(b[0] - a[0]) * R;
  const px = rad(p[1] - a[1]) * k * R;
  const py = rad(p[0] - a[0]) * R;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return {
    dist: Math.hypot(px - t * bx, py - t * by),
    along: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]),
  };
}

// Projections onto every segment overlapping the distance window [lo, hi].
function candidates(route, p, lo, hi) {
  const out = [];
  const last = Math.min(route.pts.length - 2, indexAt(route.cum, hi));
  for (let i = indexAt(route.cum, lo); i <= last; i++) out.push(projectOnSegment(route, i, p));
  return out;
}

// Snaps positions to the planned route in time order. A fix is only searched
// for in the part of the route reachable since the last on-route fix.
// Progress never goes backwards.
export function createProgressTracker(route, opts) {
  const o = {
    startTime: 0, // ms; ride start, the first fix is searched from here
    maxSpeedKmh: 80, // fastest plausible average between two fixes
    slackM: 2000, // extra forward search distance
    backtrackM: 3000, // how far behind current progress a fix may snap
    offRouteM: 300, // beyond this (plus GPS accuracy) a fix counts as off-route
    ...opts,
  };
  let progress = 0;
  let lastOnRouteTime = o.startTime;

  return {
    get progress() {
      return progress;
    },
    // pos: { t (ms), lat, lon, acc (m) } -> { along (m) | null, offRoute, offBy (m) }
    add(pos) {
      const dt = Math.max(0, (pos.t - lastOnRouteTime) / 1000);
      const hi = progress + o.slackM + (dt * o.maxSpeedKmh) / 3.6;
      const lo = Math.max(0, progress - o.backtrackM);
      const cands = candidates(route, [pos.lat, pos.lon], lo, hi);
      if (!cands.length) return { along: null, offRoute: true, offBy: Infinity };

      const best = cands.reduce((m, c) => (c.dist < m.dist ? c : m));
      const tolerance = o.offRouteM + Math.min(pos.acc || 0, 500);
      if (best.dist > tolerance) return { along: null, offRoute: true, offBy: best.dist };

      // Prefer segments ahead of current progress, the nearest first, with a
      // penalty of 2 m per km for being further ahead.
      const score = (c) => c.dist + 0.002 * Math.max(0, c.along - progress);
      const ahead = cands.filter((c) => c.dist <= tolerance && c.along >= progress - 200);
      const pick = ahead.length ? ahead.reduce((m, c) => (score(c) < score(m) ? c : m)) : best;

      progress = Math.max(progress, pick.along);
      lastOnRouteTime = pos.t;
      return { along: pick.along, offRoute: false, offBy: pick.dist };
    },
  };
}

// ---------- Checkpoint events ----------

// A course GPX: waypoints in file order are the start, the checkpoints and
// the finish, each track a parcours section. <extensions><radius> sets a
// waypoint's own radius.
// -> { checkpoints: [{ name, lat, lon, radiusM }], sections: [{ name, pts: [[lat, lon]] }] }
export function parseCourse(text, { radiusM = 300 } = {}) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const childText = (n, tag) => n.getElementsByTagName(tag)[0]?.textContent.trim() || '';
  const checkpoints = [...doc.getElementsByTagName('wpt')]
    .map((n, i) => ({
      name: childText(n, 'name') || String(i),
      lat: parseFloat(n.getAttribute('lat')),
      lon: parseFloat(n.getAttribute('lon')),
      radiusM: parseFloat(childText(n, 'radius')) || radiusM,
    }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const sections = [...doc.getElementsByTagName('trk')]
    .map((n) => ({
      name: childText(n, 'name'),
      pts: [...n.getElementsByTagName('trkpt')]
        .map((p) => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
    }))
    .filter((s) => s.pts.length > 1);
  return { checkpoints, sections };
}

// Distance ridden from the fixes, for events without a route. Skips fixes
// worse than maxAccM, jumps faster than maxKmh and movement within the fixes'
// accuracy. After `resetAfter` rejected jumps in a row the new place is taken
// without adding the jump.
// add({ t, lat, lon, acc }) -> distance so far (m)
export function createOdometer({ maxAccM = 50, maxKmh = 80, minMoveM = 10, resetAfter = 3 } = {}) {
  let distance = 0;
  let anchor = null;
  let rejected = 0;
  return {
    get distance() {
      return distance;
    },
    add(pos) {
      if (!(pos.acc <= maxAccM)) return distance;
      if (!anchor) {
        anchor = pos;
        return distance;
      }
      const d = haversine([anchor.lat, anchor.lon], [pos.lat, pos.lon]);
      if (d < Math.max(minMoveM, anchor.acc || 0, pos.acc || 0)) {
        // Still here: judge the next jump from now.
        anchor = { ...anchor, t: pos.t };
        return distance;
      }
      const dt = pos.t - anchor.t;
      if (dt <= 0 || d / 1000 / (dt / 3.6e6) > maxKmh) {
        if (++rejected >= resetAfter) {
          anchor = pos;
          rejected = 0;
        }
        return distance;
      }
      distance += d;
      anchor = pos;
      rejected = 0;
      return distance;
    },
  };
}

// Visits to the checkpoints, in order. The first is the start, reached at
// startTime; the last is the finish. A visit is the first fix inside the
// radius whose accuracy is no worse than the radius.
// add({ t, lat, lon, acc }); arrivals: [ms per checkpoint reached]
export function createCheckpointTracker(checkpoints, { startTime }) {
  const arrivals = checkpoints.length ? [startTime] : [];
  return {
    arrivals,
    get next() {
      return arrivals.length;
    },
    get finished() {
      return checkpoints.length > 1 && arrivals.length === checkpoints.length;
    },
    add(pos) {
      // One fix can reach several checkpoints that lie close together.
      while (arrivals.length < checkpoints.length) {
        const cp = checkpoints[arrivals.length];
        if (!(pos.acc <= cp.radiusM) || haversine([cp.lat, cp.lon], [pos.lat, pos.lon]) > cp.radiusM) break;
        arrivals.push(pos.t);
      }
    },
  };
}

// Straight-line distance from here via checkpoint `next` and the rest to the finish.
export function remainingVia(checkpoints, next, here) {
  if (next >= checkpoints.length) return 0;
  let d = here ? haversine(here, [checkpoints[next].lat, checkpoints[next].lon]) : 0;
  for (let i = next + 1; i < checkpoints.length; i++) {
    d += haversine([checkpoints[i - 1].lat, checkpoints[i - 1].lon], [checkpoints[i].lat, checkpoints[i].lon]);
  }
  return d;
}
