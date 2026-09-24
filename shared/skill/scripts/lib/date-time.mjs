export const calendarDateExample = "YYYY-MM-DD (for example 2024-02-29)";
export const dateTimeExample = "RFC 3339 date-time with Z or an offset (for example 2026-09-18T09:00:00+09:00)";

export function isCalendarDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function isRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match || !isCalendarDate(`${match[1]}-${match[2]}-${match[3]}`)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[7].toUpperCase() !== "Z") {
    const offsetHour = Number(match[7].slice(1, 3));
    const offsetMinute = Number(match[7].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

// Compare whole UTC seconds, then the complete decimal fraction. Date.parse
// alone truncates sub-millisecond evidence and can lose ordering information.
// Invalid values are rejected by validation; NaN prevents a fabricated order.
export function compareInstants(left, right) {
  if (!isRfc3339DateTime(left) || !isRfc3339DateTime(right)) return Number.NaN;
  const parts = (value) => {
    const fraction = /\.(\d+)(?=[Zz+-])/u.exec(value)?.[1] ?? "";
    return { second: Date.parse(value.replace(/\.\d+(?=[Zz+-])/u, "")), fraction };
  };
  const a = parts(left);
  const b = parts(right);
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(length, "0");
  const bf = b.fraction.padEnd(length, "0");
  return af === bf ? 0 : af < bf ? -1 : 1;
}
