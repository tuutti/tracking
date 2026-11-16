// The side panel (a bottom sheet on phones): the list or one participant's
// details, the status badge and the notice. render() redraws all of it.
import { $, cfg, isEnded, loading, selectedRider, state, T } from './context.js';
import { renderDetail, renderRecord } from './details.js';
import { fmtAgo, fmtDuration, fmtKm, fmtTime } from './format.js';
import { renderList } from './list.js';
import { centerOnRider, drawTrack, map, renderCheckpoints, renderMarker, setFollow } from './map.js';
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
  $('panel-toggle-label').textContent = collapsed
    ? list ? T.showParticipants : T.showDetails
    : list ? T.hideParticipants : T.hideDetails;
}

$('panel-toggle').addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

// Back to everyone; on a phone with the panel collapsed, open it so the list shows.
$('back').addEventListener('click', () => {
  if (panel.classList.contains('collapsed')) setCollapsed(false);
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

export function render() {
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
