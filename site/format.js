// Times, numbers and durations in the page's language.
import { cfg, T } from './context.js';

const LOCALE = T.locale;
const tz = cfg.timeZone || undefined;
// 24-hour clock (h23: 00–23, never "24:05"), e.g. "la 22.05" / "Sat 22:05".
const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: tz,
});
export const fmtTime = (ms) => timeFmt.format(ms);
// Locale number format, e.g. fi "1 429,5", en "1,429.5".
export const fmtNum = (n, dp) =>
  n.toLocaleString(LOCALE, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtKm = (m, dp) => fmtNum(m / 1000, dp ?? (m < 100000 ? 1 : 0));

export function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d} ${T.days} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

// Record-style durations: total hours, e.g. "61 h 6 min".
export function fmtHours(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

export function fmtAgo(ms) {
  if (ms < 60000) return T.justNow;
  return T.ago(fmtDuration(ms));
}
