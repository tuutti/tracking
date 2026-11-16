# Ride tracker page

A live-tracking page for ultra-distance rides: a map and each rider's progress. Static files, no build step
(Leaflet from a CDN, plain ES modules). The data comes from a small read-only API, such as
[tracker-backend](https://github.com/tuutti/traccar) in front of a self-hosted Traccar.

```
site/    the page: index.html, app.js, progress.js, i18n.js, config.js, style.css
tools/   preview-image.mjs: link preview image for an event
test/    node --test test/
```

## Setup

- Settings (colours, map tiles, thresholds, language) are in `site/config.js`.
- The page shows one event: `/event/<id>`, or `?event=<id>` on a static host.
- tracker-backend serves the page with the API on the same origin, so `apiUrl` stays `''`. To host `site/`
  elsewhere, set `apiUrl` to the API's address and allow that origin in the API's CORS settings.

For a preview image (needs Chromium):

```sh
node tools/preview-image.mjs --page https://PAGE_DOMAIN --events ../backend/events <event-id>
```

This writes `<event-id>/preview.jpg` into the event's folder. Without `--events` it writes
`previews/<event-id>.jpg`, and without an id it does every event.

To work on the page, check out tracker-backend next to this repo as `backend/`, start its local stack and open
http://localhost:8000/event/multi.

## API

The page reads three GET endpoints under `apiUrl`. Any backend that serves them works.

**`/events`**: the list of events.

```json
[{
  "id": "my-ride", "start": "2026-06-06T06:00:00Z", "end": null,
  "type": "route", "title": "Coast to coast", "subtitle": null, "record": null,
  "participants": [{ "id": "alex", "name": "Alex", "color": "#e4572e" }]
}]
```

- `type` is `"route"` or `"checkpoints"`. Checkpoint events may add `cpRadiusM` and `cpRequired`.
- `title` and `subtitle` are a string or `{ "en": "...", "fi": "..." }`.
- `record` is `{ "seconds": 219960 }` or `null`.
- `color` is optional.

**`/events/<id>/track?since=<ISO time>`**: the positions, polled every minute.

```json
{
  "rideStart": "2026-06-06T06:00:00Z", "rideEnd": null,
  "participants": [{
    "id": "alex", "name": "Alex", "rideStart": "2026-06-06T06:00:00Z",
    "positions": [[1234, 1780725600000, 52.37, 4.89, 21.5, 6, 87, 0]]
  }]
}
```

- A position is `[id, timeMs, lat, lon, speedKmh, accuracyM, batteryPct, charging]`. The last two are
  optional.
- `id` must be unique per participant: the page drops duplicates by it, so returning more than asked for
  `since` is fine.
- The response also repeats the event's `type`, `title`, `subtitle` and `record`.

**`/events/<id>/route.gpx`**: the route, or for checkpoint events a course whose waypoints are the start, the
checkpoints and the finish.

## How the numbers are computed

- **Distance**: each position is snapped to the route, searching only as far ahead as the rider could have
  got, so loops and out-and-backs don't jump ahead. Positions over 300 m off the route don't count.
- **Average speed and ETA**: average speed includes stops, since that's what predicts the finish.
- **Checkpoints**: they count in order, at the first accurate enough position inside their radius. Distance
  is measured from the positions.
- **Signal gaps**: late positions are merged in. Gaps show as dashed lines, and the rider greys out after
  `staleMinutes`.
- **Current speed**: Wi-Fi and cell positions report 0, so the page shows the recent average instead,
  marked "≈".
- **Rewind**: the slider shows the ride at any moment, and ▶ plays it back.
