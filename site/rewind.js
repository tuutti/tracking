// Rewind and playback: the page as it was at any moment since the start.
import { $, isEnded, state, T } from './context.js';
import { fmtTime } from './format.js';
import { centerOnRider, drawTrack } from './map.js';
import { render } from './panel.js';
import { interpolate } from './progress.js';
import { hasFinished } from './riders.js';

const INTERPOLATE_MAX_MS = 30 * 60 * 1000; // rewound, glide between fixes up to this far apart

// What the page shows of a participant: now, or as it was at state.rewindT.
// The stats use the fixes up to that moment; the marker glides between them.
export function view(r) {
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
      marker = [
        prev.lat + f * (next.lat - prev.lat),
        prev.lon + f * (next.lon - prev.lon),
      ];
    } else {
      ({ latlng: marker, progress: drawProgress } = interpolate(
        state.route,
        prev,
        next,
        state.rewindT,
      ));
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
    const mid = Math.floor((lo + hi) / 2);
    if (positions[mid].t <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// The slider counts minutes from the event's first start; its right end is live.
const slider = $('rewind-slider');
// How much of the track is filled (Chromium and Safari draw no progress of their own).
const fillSlider = () =>
  slider.style.setProperty(
    '--pct',
    `${(Number(slider.value) / Number(slider.max) || 0) * 100}%`,
  );

// Playback: the rewound moment moves forward at play.speed × real time, back to
// live at the end. Playing from live starts from the start.
const play = {
  on: false,
  speed: Number($('rewind-speed').value),
  lastFrame: 0,
  lastDraw: 0,
};
const PLAY_DRAW_MS = 100; // redraw at most this often while playing

slider.addEventListener('input', () => {
  fillSlider();
  const min = Number(slider.value);
  state.rewindT =
    min >= Number(slider.max) ? null : state.eventStart + min * 60000;
  if (state.rewindT == null) {
    play.on = false;
  }
  redraw();
});
$('rewind-live').addEventListener('click', () => {
  state.rewindT = null;
  play.on = false;
  redraw();
});

$('rewind-play').addEventListener('click', () => {
  play.on = !play.on;
  if (play.on) {
    state.rewindT ??= state.eventStart;
    play.lastFrame = performance.now();
    play.lastDraw = play.lastFrame;
    requestAnimationFrame(step);
  }
  redraw();
});
$('rewind-speed').addEventListener('change', (e) => {
  play.speed = Number(e.target.value);
});

function step(ts) {
  if (!play.on || state.rewindT == null) {
    return;
  }
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
  if (play.on) {
    requestAnimationFrame(step);
  }
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

// Slider input, redrawn once per frame.
let frame = 0;
function redraw() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    drawTrack();
    render();
    if (state.follow) {
      centerOnRider(false);
    }
  });
}

export function renderRewind() {
  const bar = $('rewind');
  bar.hidden =
    !state.riders.some((r) => r.positions.length) ||
    Date.now() < state.eventStart;
  if (bar.hidden) {
    return;
  }
  slider.max = String(Math.ceil((rewindEnd() - state.eventStart) / 60000));
  const live = state.rewindT == null;
  slider.value = live
    ? slider.max
    : String(Math.floor((state.rewindT - state.eventStart) / 60000));
  fillSlider();
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
