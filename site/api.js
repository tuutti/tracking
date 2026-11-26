// The API: the event list, the event's route and its track.
import { cfg, EVENT_ID, EVENT_URL } from './context.js';

// Part of the track URL; raise it to bypass cached answers.
const TRACK_FORMAT = '3';

export async function fetchCourseGpx() {
  const res = await fetch(`${EVENT_URL}/route.gpx`);
  if (!res.ok) {
    throw new Error(`Route GPX: HTTP ${res.status}`);
  }
  return res.text();
}

export async function fetchTrack(since) {
  const url = new URL(`${EVENT_URL}/track`, location.href);
  url.searchParams.set('v', TRACK_FORMAT);
  if (since) {
    url.searchParams.set('since', new Date(since).toISOString());
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data.participants)) {
    throw new Error('Track in an unexpected format (no participants)');
  }
  return data;
}

// The event from /events, to fill in the page before the first track. Null on failure.
export async function loadEvent() {
  try {
    const res = await fetch(`${cfg.apiUrl}/events`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()).find((e) => e.id === EVENT_ID) ?? null;
  } catch (err) {
    console.warn('Event list fetch failed:', err);
    return null;
  }
}
