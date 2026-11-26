// The page's entry point: the top bar, polling and start-up.
import { fetchCourseGpx, fetchTrack, loadEvent } from './api.js';
import {
  $,
  cfg,
  EVENT_ID,
  LANG_KEY,
  lang,
  selectedRider,
  state,
  T,
} from './context.js';
import { LANGUAGES, localized, strings, translatePage } from './i18n.js';
import {
  centerOnRider,
  drawTrack,
  fitRoute,
  loadCourse,
  setFollow,
} from './map.js';
import { initPanel, render } from './panel.js';
import { addRider, merge, syncRiders } from './riders.js';

const OVERLAP_MS = 10 * 60 * 1000; // re-fetch a little history in case of late uploads

translatePage(T, lang);
initPanel();

// Language choices under the settings menu: reloads with ?lang= and remembers the choice.
for (const code of LANGUAGES) {
  const a = document.createElement('a');
  const url = new URL(location.href);
  url.searchParams.set('lang', code);
  a.href = url;
  a.textContent = strings(code).languageName;
  a.lang = code;
  a.hreflang = code;
  if (code === lang) {
    a.setAttribute('aria-current', 'true');
  }
  a.addEventListener('click', () => {
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      // Storage blocked: the link's ?lang= still applies.
    }
  });
  const li = document.createElement('li');
  li.append(a);
  $('lang-list').append(li);
}

// Theme choices under the settings cog on the map: light, dark or the system's (the
// default); remembered.
const THEME_KEY = 'theme';
const themeMenu = $('settings-menu');

function renderThemeMenu() {
  const theme = document.documentElement.dataset.theme ?? 'system';
  for (const btn of themeMenu.querySelectorAll('[data-theme-choice]')) {
    if (btn.dataset.themeChoice === theme) {
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('aria-current');
    }
  }
}

for (const btn of themeMenu.querySelectorAll('[data-theme-choice]')) {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeChoice;
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    try {
      if (theme === 'system') {
        localStorage.removeItem(THEME_KEY);
      } else {
        localStorage.setItem(THEME_KEY, theme);
      }
    } catch {
      // Storage blocked: for this visit only.
    }
    themeMenu.open = false;
    renderThemeMenu();
  });
}
renderThemeMenu();

// The dropdown menus: one open at a time; a click elsewhere or Escape closes them.
const menus = [...document.querySelectorAll('.menu')];
for (const menu of menus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) {
      for (const other of menus) {
        if (other !== menu) {
          other.open = false;
        }
      }
    }
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}
document.addEventListener('click', (e) => {
  for (const menu of menus) {
    if (!menu.contains(e.target)) {
      menu.open = false;
    }
  }
});

// The event's title and subtitle, from the API; the generic heading until then.
function showEventInfo(data) {
  const title = localized(data.title, lang);
  const subtitle = localized(data.subtitle, lang);
  $('title').textContent = title || T.heading;
  $('subtitle').textContent = subtitle || '';
  $('subtitle').hidden = !subtitle;
  document.title = title || T.docTitle;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', subtitle || T.description);
}

// On phones the title is a chip on the map; tapping it shows the subtitle too.
// (Screen readers have the subtitle either way.)
const titles = document.querySelector('.titles');
titles.addEventListener('click', () => {
  titles.classList.toggle('open');
});

// ---------- Polling ----------

let timer = null;

// Asks only for what's new: from the oldest of the participants' last
// positions. Someone without positions yet needs their whole window.
function sinceForPoll() {
  if (!state.riders.length || state.riders.some((r) => !r.positions.length)) {
    return null;
  }
  return (
    Math.min(...state.riders.map((r) => r.positions.at(-1).t)) - OVERLAP_MS
  );
}

async function poll() {
  clearTimeout(timer);
  if (document.hidden) {
    return;
  } // resumed by visibilitychange
  try {
    const since = sinceForPoll();
    let data = await fetchTrack(since);
    const first = !state.lastFetchOk;
    // A new participant or a moved start: the incremental answer lacks the
    // start of their window; fetch it all.
    if (syncRiders(data) && since != null) {
      data = await fetchTrack(null);
    }
    state.eventStart = Date.parse(data.rideStart);
    state.rideEnd = data.rideEnd ? Date.parse(data.rideEnd) : null;
    state.record = data.record ?? null;
    showEventInfo(data);
    state.failures = 0;
    state.lastFetchOk = Date.now();
    let changed = first;
    for (const p of data.participants) {
      const r = state.riders.find((q) => q.id === p.id);
      if (r && merge(r, p.positions)) {
        changed = true;
      }
    }
    if (changed) {
      drawTrack();
      if (state.follow) {
        centerOnRider(first);
      }
    }
  } catch (err) {
    console.warn('Track fetch failed:', err);
    state.failures += 1;
  }
  render();
  const backoff = Math.min(cfg.pollSeconds * 2 ** state.failures, 600);
  timer = setTimeout(poll, backoff * 1000);
}

document.addEventListener('visibilitychange', () => {
  if (
    !document.hidden &&
    Date.now() - state.lastFetchOk > cfg.pollSeconds * 1000
  ) {
    poll();
  }
});
window.addEventListener('online', poll);
setInterval(() => state.ready && render(), 15000);

// ---------- Start ----------

function applyEvent(ev) {
  showEventInfo(ev);
  state.record = ev.record ?? null;
  state.rideEnd = ev.end ? Date.parse(ev.end) : null;
  state.eventStart = Date.parse(ev.start);
  // Until the track says otherwise, everyone starts at the event's start.
  state.riders = (ev.participants ?? []).map((p, i) =>
    addRider({ ...p, rideStart: ev.start }, i),
  );
}

function showError(text) {
  const el = $('notice');
  el.hidden = false;
  el.className = 'notice err';
  el.textContent = text;
  // Nothing to list or follow.
  $('panel-details').hidden = true;
  // Nothing to follow; the settings stay.
  $('view-buttons').hidden = true;
  $('panel-toggle').hidden = true;
}

(async () => {
  if (!EVENT_ID) {
    return showError(T.noEvent);
  }
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
  if (state.cp) {
    $('pct-label').textContent = '';
  }
  if (state.cp?.required) {
    $('sort-standing').textContent = T.sortStanding;
  }
  // Without checkpoints to reach there's no share done or distance left.
  document.body.classList.toggle(
    'no-progress',
    !!state.cp && !state.cp.required,
  );
  if (ev) {
    applyEvent(ev);
  }
  fitRoute();
  // One participant (the only one, or from the address) is followed; the list
  // starts with the whole route.
  setFollow(!!selectedRider());
  if (ev) {
    render();
  }
  poll();
})();
