# Ride tracker page

A public live-tracking page for ultra-distance rides: a map and the riders' progress, from a read-only
`/events` API (tracker-backend) in front of a self-hosted Traccar. Static files, no build
step: Leaflet from a CDN and plain ES modules.

```
site/      the page (host it anywhere): index.html, app.js, progress.js, i18n.js, config.js, style.css
tools/     preview-image.mjs: the image link previews show for an event
test/      node --test test/
```

## Setup

1. Edit `site/config.js` if you like: colours, thresholds, map tiles. The default language is the server's
   `PAGE_LANG` (English without it); viewers can switch between English and Finnish.
2. The page shows the event at `/event/<id>` (tracker-backend routes it to the page), or `?event=<id>` on a
   static host, and nothing without one. The title, subtitle,
   participants, route and previous record are set per event on the server (tracker-backend's
   `events/README.md`); an event without a record hides the comparison.
3. tracker-backend serves the page at its `PAGE_DOMAIN` with `/events` on the same origin, so `apiUrl` stays
   `''`. It also writes the event's title and subtitle into the HTML there, so link previews in chat apps
   show them. `site/` can also be hosted anywhere static: set `apiUrl` to `https://TRACCAR_DOMAIN` and add
   that origin to the server's `ALLOWED_ORIGINS`; such a copy previews with the generic title.
4. For a preview image, run `node tools/preview-image.mjs --page https://PAGE_DOMAIN <event-id>` (needs
   Chromium; without ids it does every event, by default from the local stack at http://localhost:8000). It
   writes `previews/<event-id>.jpg` (`--out DIR`), or with `--events ../backend/events` straight into the
   event's folder on tracker-backend as `<event-id>/preview.jpg`. It's the page's
   map with the whole route and the tracks so far, under the event's title; run it again after the ride, or
   during it, to update it. Chat apps cache previews, so a link shared earlier may keep the old image for a while.

To work on the page, check out tracker-backend next to this repo (as `backend/`, with this one as
`frontend/`), run its local stack (its README, "Trying it out"), and open http://localhost:8000/event/multi. Edits show up on reload.

## Using another backend

The page needs only three GET endpoints at `apiUrl` (`site/config.js`, no trailing slash). tracker-backend is
one implementation; anything that serves the data below works, Traccar or not. If the page is on another
origin than the API, the API must send CORS headers for it.

### `GET {apiUrl}/events`

All events; the page picks the one whose `id` is in its URL and fills itself in before the first track arrives.
Optional: if it fails, the track response brings the same.

```json
[{
  "id": "my-ride",
  "start": "2026-06-06T06:00:00Z",
  "end": null,
  "type": "route",
  "title": "Coast to coast",
  "subtitle": null,
  "record": null,
  "participants": [{ "id": "alex", "name": "Alex", "color": "#e4572e" }]
}]
```

- `end`: `null` while the ride is open.
- `type`: `"route"` (default) or `"checkpoints"`; checkpoint events may add `cpRadiusM` (m) and `cpRequired`
  (`false`: checkpoints are only shown, visits aren't checked).
- `title`, `subtitle`: a string or `{ "en": "...", "fi": "..." }`.
- `record`: `{ "seconds": 219960, "label": ... }` or `null` (hides the comparison).
- `color`: optional; without it the page picks one from its palette.

### `GET {apiUrl}/events/<id>/track[?since=ISO-8601]`

Polled every `pollSeconds`. The page also adds `v=<format>`, which the API may ignore.

```json
{
  "rideStart": "2026-06-06T06:00:00Z",
  "rideEnd": null,
  "type": "route",
  "title": "Coast to coast", "subtitle": null, "record": null,
  "participants": [{
    "id": "alex", "name": "Alex", "color": "#e4572e",
    "rideStart": "2026-06-06T06:00:00Z",
    "positions": [[1234, 1780725600000, 52.37, 4.89, 21.5, 6, 87, 0]]
  }]
}
```

- `rideStart`, `rideEnd`: the event's start (the earliest participant's) and end, or `null`.
- A position is `[id, timeMs, lat, lon, speedKmh, accuracyM, batteryPct | null, charging 0 | 1]`; the last two
  may be left out. `id` must be unique and stable per participant: the page drops duplicates by it.
  `speedKmh` is `0` when the device gave no speed.
- `since`: the page asks from about 10 min before the oldest participant's latest fix. Returning more is fine
  (duplicates are dropped, out-of-order fixes are handled); ignoring `since` works too, just heavier.
- A participant's `rideStart` is when their clock starts. If it changes, the page reloads their whole track.
- A participant with `"error": "..."` keeps what the page already has. An HTTP error makes the page back off
  (up to 10 min) and keep the last data on screen.

### `GET {apiUrl}/events/<id>/route.gpx`

What the map draws:

- `route` events: the planned route as a `<trk>` or `<rte>`; distance, % and ETA are measured along it.
- `checkpoints` events: `<wpt>` in file order are the start, the checkpoints and the finish, each with a
  `<name>` and optionally `<extensions><radius>500</radius></extensions>` (m); each `<trk>` is a parcours
  section, only drawn.

Everything else (distance, progress, speeds, moving and stopped time, ETA, checkpoint visits, rewind) is
computed in the browser, so the API only serves raw positions. What tracker-backend adds on top, and a plain
static host doesn't: `<html lang>` from its `PAGE_LANG` (set `lang` in `config.js` instead), the event's
title and `og:` tags in the HTML for link previews, and the preview images at `/events/<id>/preview.jpg`.

## How the numbers are computed

- **Distance**: each fix is snapped to the planned route and progress is the
  furthest snapped distance along it. Straight lines between sparse fixes would
  cut corners. A fix only searches the part of the route reachable since the
  last on-route fix (80 km/h + 2 km), so loops, out-and-backs and crossings
  don't jump ahead. Fixes over 300 m (+ GPS accuracy) from the route count as
  off-route and don't move progress. Progress never decreases.
- **Average speed**: distance ÷ (last on-route fix − start), *including stops*,
  because that's what predicts the finish of an ultra.
- **ETA**: last on-route fix + remaining ÷ average speed.
- **Checkpoint events** (no route, only checkpoints; see tracker-backend's `events/README.md`): checkpoints
  count in order, at the first position inside their radius that is accurate enough; distance is measured
  from the positions, and the distance left is a straight line via the remaining checkpoints.
- **Signal gaps**: Traccar Client buffers positions while offline and uploads
  them later. The page re-fetches 10 min of overlap, recomputes if positions arrive
  out of order, draws gaps longer than `gapMinutes` as dashed lines, and shows a
  "no signal" note after `staleMinutes`. Fetch errors back off up to 10 min, and
  the last data stays on screen. Polling pauses while the tab is hidden.
- **Rewind**: the slider under the map shows the ride as it was at any moment since the start: track,
  rider, and every stat computed as of that time. The right end is live; new positions keep arriving
  while rewound. ▶ plays the ride forward at 1–900× (from the start, if pressed while live) and returns
  to live at the end.
  Rewound, the marker and the covered route glide between fixes (along the route when both are on it,
  up to 30 min apart); the stats change only at real fixes.
- **Current speed**: only GPS fixes carry a speed; Wi-Fi/cell positions (accuracy worse than 30 m) report 0
  even while riding. For those, the page shows the along-route speed over the last 5 min, marked "≈",
  or "–" without enough data.
