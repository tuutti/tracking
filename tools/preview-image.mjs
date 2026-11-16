#!/usr/bin/env node
// Makes the image link previews show for an event (previews/<id>.jpg, or with
// --events DIR, DIR/<id>/preview.jpg: tracker-backend's event folders):
// the page's map with the whole route and the riders' tracks (no markers),
// under the event's title. A screenshot of the real page in headless Chromium.
//
//   node tools/preview-image.mjs --page https://track.example.com my-ride-2026
//   node tools/preview-image.mjs                 # every event, from the local stack
//   node tools/preview-image.mjs --events ../backend/events my-ride-2026
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: {
    page: { type: 'string', default: 'http://localhost:8000' },
    out: { type: 'string', default: 'previews' },
    events: { type: 'string' },
    lang: { type: 'string' }, // default: the page's own (PAGE_LANG)
    chromium: { type: 'string', default: 'chromium' },
  },
});

const WIDTH = 1200; // the size Facebook, WhatsApp and Slack show best
const HEIGHT = 630;
const page = opt.page.replace(/\/$/, '');

// The page's API, on its own origin.
async function eventIds() {
  const res = await fetch(`${page}/events`).catch(() => null);
  if (res?.ok) return (await res.json()).map((e) => e.id);
  throw new Error(`No event ids given, and ${page}/events could not be read`);
}

// Just the title and the map with the tracks. --s undoes the page's scale
// (see SCALES), so the title is the same size in every image.
const PREVIEW_CSS = `
  :root { --s: calc(1 / var(--scale, 1)); }
  .top-right, .panel, .map-buttons, .rewind, .leaflet-control-zoom, #notice { display: none !important; }
  .leaflet-marker-pane .rider, .leaflet-tooltip.rider-tip { display: none !important; }
  .topbar { padding: calc(22px * var(--s)) calc(32px * var(--s)) !important; }
  .topbar h1 { font-size: calc(40px * var(--s)) !important; }
  .topbar p { font-size: calc(24px * var(--s)) !important; margin-top: calc(4px * var(--s)) !important; }
  .leaflet-control-attribution { font-size: calc(12px * var(--s)) !important; }
`;

// Leaflet zooms in whole steps, so each page scale is tried and the one where
// the route fills the most of the map is used; 1 wins ties.
const SCALES = [1, 0.85, 0.7, 0.6, 0.5];

// How much of the map the route, tracks and checkpoints fill (1 = edge to edge).
const COVERAGE = `(() => {
  const map = document.getElementById('map').getBoundingClientRect();
  const rects = [...document.querySelectorAll('.leaflet-overlay-pane path, .leaflet-marker-pane .cp')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
  if (!rects.length) return 0;
  const w = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
  const h = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top));
  return Math.max(w / map.width, h / map.height);
})()`;

// Minimal Chrome DevTools Protocol client.
async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-image-'));
  const proc = spawn(opt.chromium, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${dir}`,
    '--remote-debugging-port=0', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
  ], { stdio: 'ignore' });
  proc.on('error', (err) => {
    console.error(`Can't start ${opt.chromium} (${err.message}); give its path with --chromium`);
    process.exit(1);
  });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++seq, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  // Chromium (and its helpers) write to the profile until they have exited.
  const close = async () => {
    ws.close();
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  return { call, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the expression is true in the page (or gives up after `ms`).
async function until(call, expression, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (r.result.value) return true;
  }
  return false;
}

// Loaded: the event's title is in, the tracks are drawn and no tile is still coming.
const TILES_DONE = `document.querySelector('.leaflet-tile-loaded') && !document.querySelector('.leaflet-tile:not(.leaflet-tile-loaded)')`;

// Runs before the page's own script: the preview styles and no animations.
const PREPARE = `document.addEventListener('readystatechange', () => {
  if (document.readyState !== 'interactive') return;
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(PREVIEW_CSS)};
  document.head.append(style);
  window.L?.Map.mergeOptions({ zoomAnimation: false, fadeAnimation: false });
});`;

const evaluate = async (call, expression) => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;

// A page `1 / scale` times the image's size; the screenshot scales it down
// (deviceScaleFactor leaves gaps between the tiles).
const setScale = (call, scale) =>
  call('Emulation.setDeviceMetricsOverride', {
    width: Math.round(WIDTH / scale), height: Math.round(HEIGHT / scale), deviceScaleFactor: 1, mobile: false,
  });

// The page at a scale, with the whole route fitted; returns COVERAGE.
async function fitAt(call, scale) {
  await setScale(call, scale);
  await evaluate(call, `document.documentElement.style.setProperty('--scale', ${scale})`);
  // Once Leaflet has noticed the new size.
  await sleep(400);
  await evaluate(call, `document.getElementById('btn-route').click()`);
  await sleep(200);
  return evaluate(call, COVERAGE);
}

// Opens the event's page and waits until it has loaded.
async function open(call, id) {
  await call('Page.navigate', { url: `${page}/?event=${encodeURIComponent(id)}${opt.lang ? `&lang=${encodeURIComponent(opt.lang)}` : ''}` });
  const loaded = await until(call, `!document.querySelector('#live')?.textContent.includes('...') && document.querySelector('.leaflet-overlay-pane path')`, 20000);
  if (!loaded) throw new Error('the page did not finish loading');
  const failed = await evaluate(call, `document.querySelector('.notice.err')?.textContent ?? ''`);
  if (failed) throw new Error(failed);
}

async function shoot(call, id) {
  await setScale(call, 1);
  await open(call, id);
  let best = { scale: 1, coverage: -1 };
  for (const scale of SCALES) {
    const coverage = await fitAt(call, scale);
    if (coverage > best.coverage + 0.02) best = { scale, coverage };
  }
  // Afresh at the chosen scale, without the tries' leftover tiles.
  await setScale(call, best.scale);
  await open(call, id);
  await evaluate(call, `document.documentElement.style.setProperty('--scale', ${best.scale})`);
  await evaluate(call, `document.getElementById('btn-route').click()`);
  await sleep(600);
  await until(call, TILES_DONE, 15000);
  await sleep(300);
  const shot = await call('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 82,
    clip: { x: 0, y: 0, width: Math.round(WIDTH / best.scale), height: Math.round(HEIGHT / best.scale), scale: best.scale },
  });
  const file = opt.events ? path.join(opt.events, id, 'preview.jpg') : path.join(opt.out, `${id}.jpg`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { file, scale: best.scale };
}

const events = ids.length ? ids : await eventIds();
const { call, close } = await launch();
let failures = 0;
try {
  await call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: PREPARE });
  for (const id of events) {
    try {
      const { file, scale } = await shoot(call, id);
      console.log(`${id}: ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} kB, scale ${scale})`);
    } catch (err) {
      failures++;
      console.error(`${id}: ${err.message}`);
    }
  }
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
