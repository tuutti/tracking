import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, createCheckpointTracker, createOdometer, createProgressTracker, currentSpeed, interpolate, movingStats, pointAt, haversine, recentSpeed, recordPace, remainingVia, sliceTo } from '../site/progress.js';

// Zig-zag "twisty road": 200 switchbacks, each 500 m across, 50 m apart going north.
function zigzag() {
  const pts = []; let lat = 60, lon = 25;
  for (let i = 0; i <= 200; i++) { pts.push([lat + i * 0.00045, lon + (i % 2) * 0.009]); }
  return buildRoute(pts);
}
const T0 = Date.UTC(2026, 10, 1, 6);

test('sparse fixes on twisty route give along-route distance, not straight-line', () => {
  const r = zigzag();
  const tr = createProgressTracker(r, { startTime: T0 });
  let straight = 0, prev = null;
  // fix every 2 km of road, 20 km/h -> every 6 min
  for (let d = 0, t = T0; d <= r.length; d += 2000, t += 6 * 60000) {
    const [lat, lon] = pointAt(r, d);
    tr.add({ t, lat, lon, acc: 10 });
    if (prev) straight += haversine(prev, [lat, lon]);
    prev = [lat, lon];
  }
  const expected = Math.floor(r.length / 2000) * 2000;
  assert.ok(Math.abs(tr.progress - expected) < 1, `${tr.progress} vs ${expected}`);
  assert.ok(straight < tr.progress * 0.2, 'straight line cuts corners heavily');
});

test('loop course: start fix near finish does not jump to the end', () => {
  const ring = []; for (let i = 0; i <= 360; i++) ring.push([60 + 0.5 * Math.sin(rad(i)), 25 + 1 * Math.cos(rad(i))]);
  const r = buildRoute(ring);
  const tr = createProgressTracker(r, { startTime: T0 });
  const p = pointAt(r, 500);
  tr.add({ t: T0 + 60000, lat: p[0], lon: p[1], acc: 10 });
  assert.ok(tr.progress < 1000, String(tr.progress));
});

test('out-and-back: return leg advances progress, does not snap to outbound', () => {
  const pts = []; for (let i = 0; i <= 100; i++) pts.push([60 + i * 0.001, 25]);
  for (let i = 99; i >= 0; i--) pts.push([60 + i * 0.001, 25.00001]);
  const r = buildRoute(pts);
  const tr = createProgressTracker(r, { startTime: T0 });
  let t = T0;
  for (let d = 0; d <= r.length; d += 400) { t += 60000; const [lat, lon] = pointAt(r, d); tr.add({ t, lat, lon, acc: 5 }); }
  assert.ok(r.length - tr.progress < 450, `${tr.progress} / ${r.length}`);
});

test('off-route detour does not advance; rejoining after a gap does', () => {
  const r = zigzag();
  const tr = createProgressTracker(r, { startTime: T0 });
  const a = pointAt(r, 1000); tr.add({ t: T0 + 3e5, lat: a[0], lon: a[1], acc: 10 });
  const res = tr.add({ t: T0 + 6e5, lat: a[0] + 0.05, lon: a[1], acc: 10 });
  assert.equal(res.offRoute, true);
  assert.ok(Math.abs(tr.progress - 1000) < 1);
  const b = pointAt(r, 60000); tr.add({ t: T0 + 4 * 3600e3, lat: b[0], lon: b[1], acc: 10 });
  assert.ok(Math.abs(tr.progress - 60000) < 1, String(tr.progress));
});

test('GPS jitter backwards never reduces progress', () => {
  const r = zigzag();
  const tr = createProgressTracker(r, { startTime: T0 });
  const a = pointAt(r, 5000), b = pointAt(r, 4950);
  tr.add({ t: T0 + 6e5, lat: a[0], lon: a[1] }); tr.add({ t: T0 + 7e5, lat: b[0], lon: b[1] });
  assert.ok(Math.abs(tr.progress - 5000) < 1);
});

test('sliceTo ends at the requested distance', () => {
  const r = zigzag(); const s = sliceTo(r, 12345);
  let d = 0; for (let i = 1; i < s.length; i++) d += haversine(s[i - 1], s[i]);
  assert.ok(Math.abs(d - 12345) < 1, String(d));
});

test('record pace compares by share of the route', () => {
  const H = 3.6e6;
  const pace = recordPace(1400000, 61 * H);
  assert.equal(pace.timeAt(700000), 30.5 * H);
  assert.equal(pace.distanceAt(30.5 * H), 700000);
  assert.equal(pace.distanceAt(80 * H), 1400000);
  assert.equal(pace.distanceAt(-1), 0);
  // rider at 700 km after 28 h is 2.5 h ahead
  assert.equal(pace.timeAt(700000) - 28 * H, 2.5 * H);
});

test('moving vs stopped: riding, jitter at a stop, and both kinds of signal gap', () => {
  const MIN = 60000;
  const pts = [];
  let t = T0;
  let lat = 60;
  const add = (dLatM, dtMin) => { t += dtMin * MIN; lat += dLatM / 111320; pts.push({ t, lat, lon: 25 }); };
  pts.push({ t, lat, lon: 25 });
  for (let i = 0; i < 20; i++) add(600, 1.5); // 30 min at 24 km/h
  for (let i = 0; i < 10; i++) add(i % 2 ? 25 : -25, 1.5); // 15 min stopped, 25 m GPS jitter
  add(40000, 90); // 90 min dead zone, 40 km further: riding
  add(10, 180); // 3 h gap in the same place: sleep
  const s = movingStats(pts);
  assert.equal(s.movingMs, (30 + 90) * MIN);
  assert.equal(s.stoppedMs, (15 + 180) * MIN);
  assert.equal(s.stoppedSince, t - 180 * MIN, 'stopped since the last fix before the sleep gap');
  add(600, 1.5);
  assert.equal(movingStats(pts).stoppedSince, null, 'moving again');
});

test('stop at the start and an ongoing stop count until now; moving is not extended', () => {
  const MIN = 60000;
  const start = { t: T0, lat: 60, lon: 25 };
  // Standing ~20 m from the start point; the phone sent two fixes 5 min apart.
  const still = [
    { t: T0 + 2 * MIN, lat: 60.00018, lon: 25 },
    { t: T0 + 7 * MIN, lat: 60.00018, lon: 25 },
  ];
  const s = movingStats(still, { start, now: T0 + 11 * MIN });
  assert.equal(s.stoppedMs, 11 * MIN, 'start->first fix, between fixes, and last fix->now');
  assert.equal(s.movingMs, 0);
  assert.equal(s.stoppedSince, T0);
  assert.equal(movingStats(still).stoppedMs, 5 * MIN, 'without start/now only the gap between fixes');

  // Tracking started 600 m down the road after 1.5 min: riding from the start.
  const soon = [{ t: T0 + 1.5 * MIN, lat: 60.0054, lon: 25 }, { t: T0 + 3 * MIN, lat: 60.0108, lon: 25 }];
  const m = movingStats(soon, { start, now: T0 + 30 * MIN });
  assert.equal(m.movingMs, 3 * MIN);
  assert.equal(m.stoppedMs, 0, 'silence after a moving fix is not counted as either');
  assert.equal(m.stoppedSince, null);

  // First fix far from the start (wrong route, or tracking started late): time before it is unknown.
  const away = [{ t: T0 + 2 * MIN, lat: 61, lon: 25 }, { t: T0 + 7 * MIN, lat: 61, lon: 25 }];
  const a = movingStats(away, { start, now: T0 + 11 * MIN });
  assert.equal(a.movingMs, 0);
  assert.equal(a.stoppedMs, 9 * MIN, 'between fixes and last fix->now only');
});

test('recent speed uses along-route distance over the window', () => {
  const MIN = 60000;
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push({ t: T0 + i * 1.5 * MIN, along: i * 625 }); // 25 km/h for 60 min
  pts.push({ t: T0 + 61 * MIN, along: null }); // off-route fix is ignored
  assert.ok(Math.abs(recentSpeed(pts) - 25) < 1e-9, String(recentSpeed(pts)));
  assert.equal(recentSpeed(pts.slice(0, 5)), null, 'under 10 min of data');
  assert.equal(recentSpeed([]), null);
});

function rad(d) { return d * Math.PI / 180; }

test('current speed: GPS fixes use their own speed, Wi-Fi/cell fixes an along-route estimate', () => {
  const min = 60000;
  // 24 km/h along the route = 400 m per minute; the last two fixes are network fixes reporting 0.
  const ps = [0, 1, 2, 3, 4].map((i) => ({ t: T0 + i * min, along: i * 400, spd: i < 3 ? 23 : 0, acc: i < 3 ? 5 : 120 }));
  assert.deepEqual(currentSpeed(ps.slice(0, 3)), { kmh: 23, estimated: false });
  const est = currentSpeed(ps);
  assert.equal(est.estimated, true);
  assert.ok(Math.abs(est.kmh - 24) < 0.01, String(est.kmh));
  // A lone network fix after a gap: no recent data, so no speed rather than 0.
  assert.equal(currentSpeed([{ t: T0, along: 0, spd: 0, acc: 900 }]), null);
  assert.equal(currentSpeed([]), null);
});

test('interpolate glides along the route between on-route fixes, straight otherwise', () => {
  const r = buildRoute([[60, 25], [60.01, 25], [60.01, 25.02]]); // north, then east
  const a = { t: T0, lat: 60, lon: 25, offRoute: false, progress: 0 };
  const b = { t: T0 + 10 * 60000, lat: 60.01, lon: 25.02, offRoute: false, progress: r.length };
  const mid = interpolate(r, a, b, T0 + 5 * 60000);
  assert.ok(Math.abs(mid.progress - r.length / 2) < 1e-6);
  assert.deepEqual(mid.latlng, pointAt(r, r.length / 2), 'on the route, not the diagonal');
  assert.equal(interpolate(r, a, b, T0).progress, 0);
  assert.equal(interpolate(r, a, b, b.t + 1).progress, r.length, 'clamped to b');

  const off = interpolate(r, a, { ...b, offRoute: true }, T0 + 5 * 60000);
  assert.deepEqual(off.latlng.map((x) => +x.toFixed(6)), [60.005, 25.01]);
  assert.equal(off.progress, 0, 'progress waits for the next on-route fix');
});

// Checkpoints 10 km apart going north, 300 m radius.
const cps = [0, 1, 2, 3].map((i) => ({ name: `CP${i}`, lat: 60 + i * 0.09, lon: 25, radiusM: 300 }));
const at = (cp, northM = 0) => ({ lat: cp.lat + northM / 111320, lon: cp.lon });

test('checkpoints count in order, at the first accurate fix inside the radius', () => {
  const tr = createCheckpointTracker(cps, { startTime: T0 });
  assert.deepEqual(tr.arrivals, [T0], 'the start counts as reached at the start time');
  tr.add({ t: T0 + 1e6, ...at(cps[2]), acc: 10 });
  assert.equal(tr.next, 1, 'passing CP2 before CP1 does not count');
  tr.add({ t: T0 + 2e6, ...at(cps[1], 100), acc: 400 });
  assert.equal(tr.next, 1, 'a fix less accurate than the radius does not count, even inside it');
  tr.add({ t: T0 + 3e6, ...at(cps[1], 400), acc: 5 });
  assert.equal(tr.next, 1, 'outside the radius');
  tr.add({ t: T0 + 4e6, ...at(cps[1], 250), acc: 20 });
  tr.add({ t: T0 + 5e6, ...at(cps[1]), acc: 5 });
  assert.deepEqual(tr.arrivals, [T0, T0 + 4e6], 'the first qualifying fix is the arrival');
  assert.equal(tr.finished, false);
  tr.add({ t: T0 + 6e6, ...at(cps[2]), acc: 5 });
  tr.add({ t: T0 + 7e6, ...at(cps[3]), acc: 5 });
  assert.deepEqual(tr.arrivals, [T0, T0 + 4e6, T0 + 6e6, T0 + 7e6]);
  assert.equal(tr.finished, true);
});

test('one fix can reach checkpoints that lie within each other\'s radius', () => {
  const close = [cps[0], { ...cps[1] }, { ...cps[1], name: 'same place', lat: cps[1].lat + 0.001 }];
  const tr = createCheckpointTracker(close, { startTime: T0 });
  tr.add({ t: T0 + 1e6, lat: cps[1].lat + 0.0005, lon: 25, acc: 5 });
  assert.equal(tr.next, 3);
});

test('odometer: riding counts, jitter while stopped, coarse fixes and outliers do not', () => {
  const odo = createOdometer();
  let t = T0;
  // 10 km north at 30 km/h, a fix a minute (500 m apart).
  for (let i = 0; i <= 20; i++, t += 60000) odo.add({ t, lat: 60 + (i * 500) / 111320, lon: 25, acc: 8 });
  const end = 60 + 10000 / 111320;
  const ridden = haversine([60, 25], [end, 25]); // ~10 km
  assert.ok(Math.abs(odo.distance - ridden) < 1, `${odo.distance} vs ${ridden}`);
  // An hour stopped with ±8 m jitter.
  for (let i = 0; i < 60; i++, t += 60000) odo.add({ t, lat: end + ((i % 3) - 1) * 8 / 111320, lon: 25, acc: 8 });
  assert.ok(Math.abs(odo.distance - ridden) < 1, 'jitter adds nothing');
  odo.add({ t, lat: end + 3000 / 111320, lon: 25, acc: 400 });
  odo.add({ t: t + 30000, lat: end + 20000 / 111320, lon: 25, acc: 10 });
  assert.ok(Math.abs(odo.distance - ridden) < 1, 'coarse fix and a 20 km jump in 30 s ignored');
});

test('odometer accepts a new place after repeated rejected jumps, without adding the jump', () => {
  const odo = createOdometer({ resetAfter: 2 });
  odo.add({ t: T0, lat: 60, lon: 25, acc: 5 });
  odo.add({ t: T0 + 1000, lat: 61, lon: 25, acc: 5 });
  odo.add({ t: T0 + 2000, lat: 61, lon: 25, acc: 5 });
  odo.add({ t: T0 + 62000, lat: 61 + 500 / 111320, lon: 25, acc: 5 });
  assert.ok(Math.abs(odo.distance - haversine([61, 25], [61 + 500 / 111320, 25])) < 1, `${odo.distance}`);
});

test('remaining straight-line distance via the remaining checkpoints', () => {
  const leg = haversine([cps[0].lat, 25], [cps[1].lat, 25]);
  assert.ok(Math.abs(remainingVia(cps, 1, [cps[0].lat, 25]) - 3 * leg) < 1);
  assert.ok(Math.abs(remainingVia(cps, 3, [cps[2].lat, 25]) - leg) < 1);
  assert.equal(remainingVia(cps, 4, [cps[3].lat, 25]), 0);
});
