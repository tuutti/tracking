// The map: the route or course, the riders' tracks and markers, following the
// shown participant.
import { $, cfg, cssColor, selectedRider, state, T } from './context.js';
import { fmtTime } from './format.js';
import { select } from './panel.js';
import { buildRoute, parseCourse, parseGpx, sliceTo } from './progress.js';
import { view } from './rewind.js';

export const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
// Whole route: an icon button above the zoom buttons (Leaflet stacks
// bottom controls upwards).
const ViewButtons = L.Control.extend({
  onAdd() {
    const bar = $('view-buttons');
    L.DomEvent.disableClickPropagation(bar);
    return bar;
  },
});
new ViewButtons({ position: 'bottomright' }).addTo(map);
// Tells Leaflet when the panel changes the map's size, and keeps following.
// The map grows and shrinks at its bottom edge, so what's on it stays put
// (Leaflet would keep the centre, sliding everything by half the change).
new ResizeObserver(() => {
  map.invalidateSize({ pan: false });
  if (state.follow) {
    centerOnRider(false);
  }
}).observe($('map'));

// Height of the map's top strip that the badge and buttons cover.
function buttonsInset() {
  const buttons = document
    .querySelector('.map-buttons')
    .getBoundingClientRect();
  return Math.max(0, buttons.bottom - $('map').getBoundingClientRect().top);
}

// fitBounds padding that keeps what's fitted out from under the buttons.
const clearOfButtons = (pad) => ({
  paddingTopLeft: [pad, buttonsInset() + pad],
  paddingBottomRight: [pad, pad],
});

L.tileLayer(cfg.tileUrl, {
  maxZoom: 18,
  attribution: cfg.tileAttribution,
}).addTo(map);

const plannedLine = L.polyline([], {
  color: cssColor('--route'),
  weight: 4,
  opacity: 0.55,
}).addTo(map);
// Checkpoint events: parcours sections (above the riders' tracks) and checkpoint markers.
const courseLayer = L.featureGroup().addTo(map);
map.createPane('parcours').style.zIndex = 450;
let cpMarkers = [];
// The shown participant's progress along the route.
const coveredLine = L.polyline([], {
  color: cssColor('--brand'),
  weight: 5,
  opacity: 0.9,
}).addTo(map);
// look: 'active' (pulsing), 'idle' (ride over: no pulse) or 'stale' (grey).
const riderIcon = (r, look) =>
  L.divIcon({
    className: `rider ${look}`,
    html: `<span class="pulse" style="--c:${r.color}"></span><span class="dot" style="--c:${r.color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

// Names of checkpoints and parcours sections, on the left of them.
const CP_TIP = {
  permanent: true,
  direction: 'left',
  offset: [-12, 0],
  className: 'cp-tip',
};
// Start, checkpoints, finish and parcours sections, one colour each, repeating.
// None is a participant's colour.
const COURSE_COLORS = [
  '#1b7a3e',
  '#3a6ea5',
  '#b5179e',
  '#0096c7',
  '#9a031e',
  '#5a4fcf',
  '#2b2d42',
  '#b07d00',
  '#7b6d8d',
  '#00838f',
];

// Following the shown participant stops when the map is dragged; picking them
// again (on the list or the map) resumes it.
map.on('dragstart', () => setFollow(false));
$('btn-route').addEventListener('click', () => {
  setFollow(false);
  fitRoute();
});

export function setFollow(on) {
  state.follow = on;
}

export function fitRoute() {
  if (state.route) {
    map.fitBounds(plannedLine.getBounds(), clearOfButtons(20));
  } else if (state.cp) {
    map.fitBounds(state.cp.bounds, clearOfButtons(30));
  }
}

// Keeps the shown participant in the middle of what the buttons leave clear;
// zoomIn brings the map to at least street level. Nothing on the list.
export function centerOnRider(zoomIn) {
  const sel = selectedRider();
  const marker = sel && view(sel).marker;
  if (!marker) {
    return;
  }
  const zoom = zoomIn ? Math.max(map.getZoom(), 12) : map.getZoom();
  const at = map.project(marker, zoom).subtract([0, buttonsInset() / 2]);
  map.setView(map.unproject(at, zoom), zoom);
}

// A planned route, or for checkpoint events the checkpoints and parcours sections.
// With cpRequired false visits aren't checked and riders rank by distance ridden.
export function loadCourse(gpx, type, cpRadiusM, cpRequired) {
  if (type === 'checkpoints') {
    const cp = parseCourse(gpx, cpRadiusM ? { radiusM: cpRadiusM } : undefined);
    if (cp.checkpoints.length < 2) {
      throw new Error(
        'Course GPX needs waypoints for at least the start and the finish',
      );
    }
    cp.required = cpRequired !== false;
    cp.bounds = L.latLngBounds([
      ...cp.checkpoints.map((c) => [c.lat, c.lon]),
      ...cp.sections.flatMap((sec) => sec.pts),
    ]);
    state.cp = cp;
    // The checkpoint circles need a map with a view before they can be drawn.
    fitRoute();
    drawCourse();
  } else {
    const route = buildRoute(parseGpx(gpx));
    if (route.pts.length < 2) {
      throw new Error('Route GPX has no track or route points');
    }
    state.route = route;
    plannedLine.setLatLngs(route.pts);
  }
  state.ready = true;
}

// Parcours sections and numbered checkpoints; the start and the finish get a letter.
function drawCourse() {
  const { checkpoints, sections } = state.cp;
  // One colour per item: the waypoints first, then the parcours sections.
  const colorOf = (i) => COURSE_COLORS[i % COURSE_COLORS.length];
  // Tooltips take HTML; names come from the GPX.
  const tip = (text, color) => mapPill(text, color);

  sections.forEach((sec, k) => {
    const color = colorOf(checkpoints.length + k);
    for (const [c, weight, opacity] of [
      ['#fff', 10, 0.95],
      [color, 6, 1],
    ]) {
      const line = L.polyline(sec.pts, {
        pane: 'parcours',
        color: c,
        weight,
        opacity,
        interactive: false,
      }).addTo(courseLayer);
      if (c === color) {
        line.bindTooltip(tip(sec.name || T.parcours, color), {
          ...CP_TIP,
          offset: [-8, 0],
        });
      }
    }
  });

  const last = checkpoints.length - 1;
  cpMarkers = checkpoints.map((c, i) => {
    const color = colorOf(i);
    const label = cpLabel(i, last);
    if (state.cp.required) {
      L.circle([c.lat, c.lon], {
        radius: c.radiusM,
        color,
        weight: 1,
        opacity: 0.6,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(courseLayer);
    }
    return L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        className: 'cp cp-pin',
        html: `<span style="--c:${color}"><b>${label}</b></span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 29],
        tooltipAnchor: [0, -17],
      }),
      keyboard: false,
      zIndexOffset: -500,
    })
      .bindTooltip(tip(c.name, color), CP_TIP)
      .addTo(courseLayer);
  });
}

// A name on the map, in its colour.
export function mapPill(text, color) {
  const style = color ? ` style="--c:${color}"` : '';
  return `<span class="map-pill"${style}>${escapeHtml(text)}</span>`;
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Tooltips take HTML; names come from the GPX.
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// The start and the finish get a letter, the checkpoints between a number.
function cpLabel(i, last) {
  if (i === 0) {
    return T.startShort;
  }
  return i === last ? T.finishShort : String(i);
}

// Fades the checkpoints the shown participant hasn't reached yet (none on the list).
export function renderCheckpoints(sel, s) {
  cpMarkers.forEach((m, i) =>
    m.getElement()?.classList.toggle('ahead', !!sel && i >= s.cpReached),
  );
}

export function drawTrack() {
  const sel = selectedRider();
  const gapMs = cfg.gapMinutes * 60 * 1000;
  for (const r of state.riders) {
    const v = view(r);
    const solid = [];
    const gaps = [];
    let seg = [];
    let prev = null;
    for (const p of v.positions) {
      const ll = [p.lat, p.lon];
      if (prev && p.t - prev.t > gapMs) {
        solid.push(seg);
        gaps.push([[prev.lat, prev.lon], ll]);
        seg = [];
      }
      seg.push(ll);
      prev = p;
    }
    solid.push(seg);
    r.trackLine.setLatLngs(r.visible ? solid : []);
    r.gapLine.setLatLngs(r.visible ? gaps : []);
    // With one participant shown, the others fade into the background.
    const dim = sel && sel !== r;
    r.trackLine.setStyle({ opacity: dim ? 0.3 : 0.8 });
    r.gapLine.setStyle({ opacity: dim ? 0.25 : 0.7 });
  }
  if (sel && state.route) {
    coveredLine.setStyle({ color: sel.color });
    coveredLine.setLatLngs(sliceTo(state.route, view(sel).drawProgress));
  } else {
    coveredLine.setLatLngs([]);
  }
}

export function renderMarker(r, s, sel, anyActive) {
  if (!s.last || !r.visible) {
    // No positions in the (new) ride window yet, or hidden from the map.
    r.marker?.remove();
    r.marker = null;
    r.markerLook = null;
    return;
  }
  const ll = s.v.marker;
  // Only riders still on the way pulse; grey only while a position is overdue.
  let look = 'active';
  if (s.over) {
    look = 'idle';
  } else if (s.stale) {
    look = 'stale';
  }
  if (!r.marker) {
    r.marker = L.marker(ll, {
      icon: riderIcon(r, look),
      keyboard: false,
      title: r.name,
    })
      .on('click', () => select(r.id))
      .addTo(map);
    r.markerLook = look;
  } else {
    r.marker.setLatLng(ll);
  }
  if (r.markerLook !== look) {
    r.marker.setIcon(riderIcon(r, look));
    r.markerLook = look;
  }
  // Riders no longer on the way are faded and drawn below, except the one shown.
  const dim = anyActive && look !== 'active' && sel !== r;
  let z = dim ? 0 : 500;
  if (sel === r) {
    z = 1000;
  }
  r.marker.setZIndexOffset(z);
  r.marker.getElement()?.classList.toggle('dim', dim);
  // With several participants, names stay on the map.
  const multi = state.riders.length > 1;
  const tip = mapPill(
    multi ? r.name : `${r.name} · ${fmtTime(s.last.t)}`,
    r.color,
  );
  const tooltip = r.marker.getTooltip();
  if (!tooltip || tooltip.options.permanent !== multi) {
    r.marker.unbindTooltip();
    r.marker.bindTooltip(
      tip,
      multi
        ? {
            permanent: true,
            direction: 'right',
            offset: [8, 0],
            className: 'rider-tip',
          }
        : { className: 'rider-tip' },
    );
  } else {
    r.marker.setTooltipContent(tip);
  }
  r.marker.getTooltip()?.getElement()?.classList.toggle('dim', dim);
}
