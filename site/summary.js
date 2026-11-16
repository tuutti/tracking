// Where each participant stands at the shown moment, and who's ahead.
import { cfg, FINISH_TOLERANCE_M, isEnded, state } from './context.js';
import { remainingVia } from './progress.js';
import { view } from './rewind.js';

export function summary(r) {
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

// Who's ahead: along the route (or with checkpoints that needn't be visited),
// the furthest; in checkpoint events, the most checkpoints, then who reached
// the latest of them first, then the furthest ridden.
export function standing(a, b) {
  if (!state.cp?.required) return b.done - a.done;
  return b.cpReached - a.cpReached || (a.arrivals.at(-1) ?? 0) - (b.arrivals.at(-1) ?? 0) || b.done - a.done;
}

// "CP 2/5": checkpoints reached after the start, of those after the start.
export const cpCount = (s) => `CP ${Math.max(0, s.cpReached - 1)}/${state.cp.checkpoints.length - 1}`;
