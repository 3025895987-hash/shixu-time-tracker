export const DAY = 86400000;
export const OFFSET = 8 * 3600000;
export const KINDS = ["work", "study"];
export const names = {work:"工作",study:"学习"};
export function dayOf(time = Date.now()) { return new Date(time + OFFSET).toISOString().slice(0, 10); }
export function midnight(day) { return Date.parse(day + "T00:00:00+08:00"); }
export function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(midnight(day)) && dayOf(midnight(day)) === day;
}
export function clockText(stamp) { return new Date(stamp + OFFSET).toISOString().slice(11,16); }
export function totals(records, day, now = Date.now(), live = false) {
  const start = midnight(day), result = {work:0,study:0};
  for (const r of records) {
    if (r.mode === "manual") {
      if (r.day === day) result[r.kind] += r.minutes * 60000;
    } else if (r.end !== null || live) {
      result[r.kind] += Math.max(0, Math.min(r.end ?? now, start+DAY) - Math.max(r.start, start));
    }
  }
  return result;
}
export function rangeDays(last, count = 7) {
  return Array.from({length:count}, (_, i) => dayOf(midnight(last) - (count-1-i)*DAY));
}
export function fail(message, status=400) { throw Object.assign(new Error(message),{status}); }
export function validateRecord(r, now) {
  if (!r || typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id ?? "") || !KINDS.includes(r.kind)) fail("记录格式有误。");
  if (r.mode === "manual" && validDay(r.day) && r.day <= dayOf(now) && Number.isInteger(r.minutes) && r.minutes > 0 && r.minutes <= 1440 && r.start === null && r.end === null) return;
  const validTime = t => Number.isSafeInteger(t) && t >= 0 && t <= now;
  if (r.mode === "timer" && validTime(r.start) && (r.end === null || validTime(r.end) && r.end >= r.start) && r.day === null && r.minutes === null) return;
  fail("请检查记录日期、时长和起止时间。");
}

