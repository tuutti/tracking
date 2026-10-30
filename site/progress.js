// Route geometry and along-route progress. No DOM or map dependencies, so it
// can be unit-tested in Node.

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

// The previous record ridden at a constant pace over this route. Compares by
// share of the route, so a record ridden on a different-length line still
// compares fairly. distanceAt(elapsed ms) -> m, timeAt(distance m) -> elapsed ms.
export function recordPace(length, recordMs) {
  return {
    distanceAt: (ms) => Math.min(length, Math.max(0, (ms / recordMs) * length)),
    timeAt: (d) => (Math.min(Math.max(d, 0), length) / length) * recordMs,
  };
}

// Splits the ride into moving and stopped time. Each interval between two
// consecutive positions counts as moving if the rider covered at least
// minKmh in a straight line; GPS jitter while standing still stays well below
// that. A signal gap is judged the same way: far away afterwards means riding
// through a dead zone, same place means a stop (e.g. sleep).
// positions: [{ t, lat, lon }] sorted by t.
// start: { t, lat, lon } of the ride start (e.g. the route's first point), so
//   the time before the first fix is judged too. Only used when the first fix
//   is within startRadiusM of it; otherwise that time is unknown and skipped
//   (e.g. tracking started away from the start).
// now: when given and the rider is stopped, the stop lasts until now: phones
//   often send nothing while stationary. Moving time is never extended, since
//   silence while moving is unknown until the next positions arrive.
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

// Speed to show for the latest fix. Only GPS fixes carry a speed: Wi-Fi and
// cell positions (accuracy worse than gpsAccuracyM) come with speed 0 even
// while riding. For those, the along-route speed over the last few minutes is
// used instead, marked as estimated.
// positions: [{ t, spd, acc, along }] sorted by t.
// -> { kmh, estimated } or null when there's nothing to go on.
export function currentSpeed(positions, { gpsAccuracyM = 30, windowMs = 5 * 60 * 1000, minMs = 2 * 60 * 1000 } = {}) {
  const last = positions.at(-1);
  if (!last) return null;
  if (last.acc <= gpsAccuracyM) return { kmh: last.spd, estimated: false };
  const kmh = recentSpeed(positions, windowMs, minMs);
  return kmh == null ? null : { kmh, estimated: true };
}

// Where the rider was at time t between consecutive fixes a and b
// (a.t <= t <= b.t), for smooth rewinding and playback. With both fixes on
// the route it glides along the route; otherwise in a straight line.
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

// Snaps positions to the planned route one at a time, in time order.
//
// Sparse fixes cut corners, so straight-line distance between them
// underestimates; snapping gives the distance along the road instead.
// The search is limited to the part of the route the rider could plausibly
// have reached since the last on-route fix, which stops a fix from snapping
// to another part of the route that passes nearby (loops, out-and-backs,
// figure-eights). Progress never goes backwards.
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

      // Where the route runs close to itself (out-and-back on the same road, a
      // crossing), prefer segments ahead of current progress, and among those
      // the nearest, with a small penalty (2 m per km) for being further ahead.
      const score = (c) => c.dist + 0.002 * Math.max(0, c.along - progress);
      const ahead = cands.filter((c) => c.dist <= tolerance && c.along >= progress - 200);
      const pick = ahead.length ? ahead.reduce((m, c) => (score(c) < score(m) ? c : m)) : best;

      progress = Math.max(progress, pick.along);
      lastOnRouteTime = pos.t;
      return { along: pick.along, offRoute: false, offBy: pick.dist };
    },
  };
}

// ---------- Free-route events: control points instead of a route ----------

// A course GPX: waypoints in file order are the start, the control points and
// the finish; each track is a parcours section (drawn only, not checked).
// A waypoint may set its own capture radius in <extensions><radius>.
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

// Distance ridden from the fixes themselves, for events without a route.
// Coarse fixes (Wi-Fi/cell, worse than maxAccM) are skipped, as are jumps
// faster than maxKmh; movement within the fixes' accuracy is jitter and
// doesn't count until the rider has really moved away. After `resetAfter`
// rejected jumps in a row the new place is taken as is (without adding the
// jump), so one bad fix can't freeze the odometer.
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
        // Still here: a jump right after this must be judged from now, not
        // from when the rider arrived.
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

// Visits to the control points, in their fixed order. The first checkpoint is
// the start, reached at startTime; the last is the finish. Only the next one
// is looked for, so riding past a later checkpoint early doesn't count. A
// visit is the first fix within the checkpoint's radius whose accuracy is no
// worse than the radius, so a coarse Wi-Fi/cell fix can't fake one.
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

// Straight-line distance still to go: from here to checkpoint `next`, then
// checkpoint to checkpoint to the finish. A lower bound of the real distance.
export function remainingVia(checkpoints, next, here) {
  if (next >= checkpoints.length) return 0;
  let d = here ? haversine(here, [checkpoints[next].lat, checkpoints[next].lon]) : 0;
  for (let i = next + 1; i < checkpoints.length; i++) {
    d += haversine([checkpoints[i - 1].lat, checkpoints[i - 1].lon], [checkpoints[i].lat, checkpoints[i].lon]);
  }
  return d;
}
