// The participant list: order, search and showing riders on the map.
import { $, loading, state, T } from './context.js';
import { fmtAgo, fmtKm, fmtTime } from './format.js';
import { drawTrack } from './map.js';
import { render, select } from './panel.js';
import { shareText, standing } from './summary.js';

// List order, 'distance' (furthest first) or 'name'; remembered per viewer.
const SORT_KEY = 'participantSort';
let sortBy = 'distance';
try {
  if (localStorage.getItem(SORT_KEY) === 'name') {
    sortBy = 'name';
  }
} catch {
  // Storage blocked: by distance.
}
const nameOrder = new Intl.Collator(T.locale);

function setSort(by) {
  sortBy = by;
  for (const btn of document.querySelectorAll('#sort-menu [data-sort]')) {
    if (btn.dataset.sort === by) {
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('aria-current');
    }
  }
  try {
    localStorage.setItem(SORT_KEY, by);
  } catch {
    // Storage blocked: don't remember.
  }
}

for (const btn of document.querySelectorAll('#sort-menu [data-sort]')) {
  btn.addEventListener('click', () => {
    setSort(btn.dataset.sort);
    $('sort-menu').open = false;
    render();
  });
}
setSort(sortBy);

// Shows or hides riders on the map; the list keeps them all.
function setVisible(riders, on) {
  for (const r of riders) {
    r.visible = on;
  }
  drawTrack();
  render();
}

// Names compared without case or accents, e.g. "ahlstrom" finds "Åhlström".
const fold = (text) =>
  text
    .toLocaleLowerCase(T.locale)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

// The participants the search matches (everyone without a search).
function matching() {
  const q = fold($('search').value.trim());
  return state.riders.filter((r) => !q || fold(r.name).includes(q));
}

$('search').addEventListener('input', () => render());

// Shows or hides everyone the search matches.
$('toggle-all').addEventListener('change', (e) =>
  setVisible(matching(), e.target.checked),
);

// Everyone with the distance ridden, furthest first or by name.
export function renderList(sums) {
  // The chosen order's name ("Standing" in checkpoint events, set after start-up).
  $('sort-current').textContent = document.querySelector(
    '#sort-menu [aria-current]',
  ).textContent;
  const list = $('participants');
  const order = [...sums.entries()].sort(([ra, a], [rb, b]) =>
    sortBy === 'name'
      ? nameOrder.compare(ra.name, rb.name)
      : standing(a, b) || nameOrder.compare(ra.name, rb.name),
  );
  for (const [r, s] of order) {
    if (!r.row) {
      const li = document.createElement('li');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'vis';
      check.addEventListener('change', () => setVisible([r], check.checked));
      r.check = check;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'participant';
      btn.innerHTML =
        '<span class="p-main"><span class="p-name"></span>' +
        '<span class="p-note muted"></span><span class="p-bar"><span></span></span></span>' +
        '<span class="p-dist"><strong></strong><small> km</small></span>';
      btn.addEventListener('click', () => select(r.id));
      li.append(check, btn);
      r.row = btn;
    }
    const { row } = r;
    row.style.setProperty('--c', r.color);
    r.check.style.setProperty('--c', r.color);
    r.check.checked = r.visible;
    r.check.setAttribute('aria-label', T.showOnMap(r.name));
    row.parentElement.classList.toggle('off', !r.visible);
    row.querySelector('.p-name').textContent = r.name;
    row.querySelector('.p-dist strong').textContent = s.last
      ? fmtKm(s.done)
      : '–';
    row.querySelector('.p-bar span').style.width = `${s.share * 100}%`;
    row.querySelector('.p-note').textContent = participantNote(s);
  }
  const shown = matching();
  for (const r of state.riders) {
    r.row.parentElement.hidden = !shown.includes(r);
  }
  $('no-matches').hidden = shown.length > 0;
  const visible = shown.filter((r) => r.visible).length;
  $('toggle-all').disabled = !shown.length;
  $('toggle-all').checked = visible > 0 && visible === shown.length;
  $('toggle-all').indeterminate = visible > 0 && visible < shown.length;
  // Reorder only when the order changed.
  const rows = order.map(([r]) => r.row.parentElement);
  if (rows.some((li, i) => list.children[i] !== li)) {
    list.replaceChildren(...rows);
  }
}

function participantNote(s) {
  if (loading()) {
    return '';
  }
  const pct = shareText(s);
  const note = (...parts) => parts.filter(Boolean).join(' · ');
  if (s.finished && s.ref) {
    return note(pct, T.finishedAt(fmtTime(s.ref.t)));
  }
  if (!s.last) {
    return T.noPositions;
  }
  if (s.ended) {
    return note(pct, T.statusEnded);
  }
  if (!s.v.live) {
    return pct ?? '';
  }
  if (s.stale) {
    return note(pct, `${T.statusNoSignal} ${fmtAgo(s.age)}`);
  }
  return note(pct, fmtAgo(s.age));
}
