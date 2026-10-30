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
2. The page shows the event named by `?event=<id>` in its URL, and nothing without one. The title, subtitle,
   participants, route and previous record are set per event on the server (tracker-backend's
   `events/README.md`); an event without a record hides the comparison.
3. tracker-backend serves the page at its `PAGE_DOMAIN` with `/events` on the same origin, so `apiUrl` stays
   `''`. It also writes the event's title and subtitle into the HTML there, so link previews in chat apps
   show them. `site/` can also be hosted anywhere static: set `apiUrl` to `https://TRACCAR_DOMAIN` and add
   that origin to the server's `ALLOWED_ORIGINS`; such a copy previews with the generic title.
4. For a preview image, run `node tools/preview-image.mjs --page https://PAGE_DOMAIN <event-id>` (needs
   Chromium; without ids it does every event, by default from the local stack at http://localhost:8000). It
   writes `previews/<event-id>.jpg` (`--out DIR`); put it in the server's `PREVIEWS_PATH`. It's the page's
   map with the whole route and the tracks so far, under the event's title; run it again after the ride, or
   during it, to update it. Chat apps cache previews, so a link shared earlier may keep the old image for a while.

To work on the page, check out tracker-backend next to this repo (as `backend/`, with this one as
`frontend/`), run its local stack (its README, "Trying it out"), and open http://localhost:8000/?event=example. Edits show up on reload.

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
