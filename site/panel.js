// The side panel (a bottom sheet on phones): the list or one participant's
// details, the status badge and the notice. render() redraws all of it.
import {
  $,
  cfg,
  isEnded,
  loading,
  selectedRider,
  state,
  T,
} from './context.js';
import { renderDetail, renderRecord } from './details.js';
import { fmtAgo, fmtDuration, fmtKm, fmtTime } from './format.js';
import { renderList } from './list.js';
import {
  centerOnRider,
  drawTrack,
  map,
  renderCheckpoints,
  renderMarker,
  setFollow,
} from './map.js';
import { renderRewind } from './rewind.js';
import { summary } from './summary.js';

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
  const [forList, forDetails] = collapsed
    ? [T.showParticipants, T.showDetails]
    : [T.hideParticipants, T.hideDetails];
  $('panel-toggle-label').textContent = list ? forList : forDetails;
}

$('panel-toggle').addEventListener('click', () =>
  setCollapsed(!panel.classList.contains('collapsed')),
);

// Back to everyone; on a phone with the panel collapsed, open it so the list shows.
$('back').addEventListener('click', () => {
  if (panel.classList.contains('collapsed')) {
    setCollapsed(false);
  }
  select(null);
});

export function initPanel() {
  let startCollapsed = false;
  try {
    startCollapsed = localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    // Storage blocked: start expanded.
  }
  setCollapsed(startCollapsed);
}

// Shows one participant's details, or the list (id null).
export function select(id) {
  state.selected = id;
  const r = state.riders.find((q) => q.id === id);
  if (r) {
    r.visible = true;
  }
  const url = new URL(location.href);
  if (id) {
    url.searchParams.set('participant', id);
  } else {
    url.searchParams.delete('participant');
  }
  history.replaceState(null, '', url);
  setFollow(true);
  drawTrack();
  render();
  centerOnRider(true);
}

export function render() {
  const sums = new Map(state.riders.map((r) => [r, summary(r)]));
  const sel = selectedRider();
  const now = state.rewindT ?? Date.now();

  const anyActive = [...sums.values()].some(
    (s) => s.last && !s.over && !s.stale,
  );
  for (const [r, s] of sums) {
    renderMarker(r, s, sel, anyActive);
  }
  if (state.cp) {
    renderCheckpoints(sel, sel && sums.get(sel));
  }
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
    renderDetail(sel, sums.get(sel));
  } else {
    renderList(sums);
    renderRecord(null);
  }
  renderNotice(sums, sel, now);
  renderRewind();
}

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
  live.textContent = statusText(all, rewound, riding);
}

function statusText(all, rewound, riding) {
  if (rewound) {
    return T.statusRewound;
  }
  if (all.length && all.every((s) => s.finished)) {
    return T.statusFinished;
  }
  if (all.length && all.every((s) => s.over)) {
    return T.statusEnded;
  }
  if (riding) {
    return T.statusLive;
  }
  if (!all.some((s) => s.last)) {
    return T.statusWaiting;
  }
  return T.statusNoSignal;
}

function renderNotice(sums, sel, now) {
  const n = notice(sums, sel, now);
  const { text, kind = 'warn' } =
    typeof n === 'string' ? { text: n } : (n ?? {});
  const el = $('notice');
  el.hidden = !text;
  el.className = `notice ${kind}`;
  if (text) {
    el.textContent = text;
  }
}

// The notice above the stats: null, a warning's text, or { text, kind: 'err' }.
function notice(sums, sel, now) {
  if (loading()) {
    return null;
  }
  const s = sel ? sums.get(sel) : null;
  const offRoute =
    s?.last && !s.stale && s.last.offRoute && Number.isFinite(s.last.offBy)
      ? T.offRoute(fmtKm(s.last.offBy, 1))
      : null;
  // Rewound: only what was true at that moment, without live advice.
  if (state.rewindT != null) {
    return offRoute;
  }
  if (state.failures > 0 && now - state.lastFetchOk > cfg.pollSeconds * 2000) {
    return {
      kind: 'err',
      text: state.lastFetchOk
        ? T.serverDown(fmtAgo(now - state.lastFetchOk))
        : T.serverDownNoData,
    };
  }
  const start = sel ? sel.rideStart : state.eventStart;
  if (now < start) {
    return T.startsAt(fmtTime(start), fmtDuration(start - now));
  }
  if (!s) {
    const anyPosition = [...sums.values()].some((q) => q.last);
    return state.riders.length && !anyPosition && !isEnded(now)
      ? T.waitingFirst
      : null;
  }
  if (s.over) {
    return null;
  }
  if (!s.last) {
    return T.waitingFirst;
  }
  if (s.stale) {
    return T.noSignal(fmtDuration(s.age));
  }
  return offRoute;
}
