// One participant's details: progress, stats, checkpoints and the record.
import { $, cfg, lang, loading, state, T } from './context.js';
import { fmtAgo, fmtDuration, fmtHours, fmtKm, fmtNum, fmtTime } from './format.js';
import { localized } from './i18n.js';
import { map } from './map.js';
import { currentSpeed, movingStats, pointAt, recentSpeed, recordPace } from './progress.js';
import { cpCount } from './summary.js';

// Where the previous record would be now, at its average pace.
let recordMarker = null;

export function renderDetail(r, s) {
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
export function renderRecord(r, { now, ghostAt, ref, done, remaining, avgKmh, finished, ended } = {}) {
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
