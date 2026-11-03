/**
 * Calendar-month accounting periods.
 *
 * A period is [from, to): `from` is the first instant of the month in the
 * configured accounting time zone, `to` is the first instant of the next month.
 * Times are returned as ISO strings in UTC. Default zone is UTC.
 */

export interface AccountingPeriod {
  /** YYYY-MM in the accounting time zone. */
  month: string;
  /** Inclusive start, ISO UTC. */
  from: string;
  /** Exclusive end, ISO UTC. */
  to: string;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function assertTimeZone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) throw new RangeError("accounting time zone must be a non-empty IANA name");
  try {
    formatterFor(timeZone);
  } catch (cause) {
    throw new RangeError(`accounting time zone is not supported: ${timeZone}`, { cause });
  }
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(epochMs: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `timeZone` from UTC in milliseconds at the given instant. */
function offsetMs(epochMs: number, timeZone: string): number {
  const wall = wallClockAt(epochMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Converts local midnight of the first day of a month in `timeZone` to a UTC instant. */
function firstInstantOfMonth(year: number, month: number, timeZone: string): number {
  const wallAsUtc = Date.UTC(year, month - 1, 1);
  const firstGuess = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  return wallAsUtc - offsetMs(firstGuess, timeZone);
}

export function monthAccountingPeriod(month: string, timeZone: string): AccountingPeriod {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new RangeError("month must be in YYYY-MM format");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    month,
    from: new Date(firstInstantOfMonth(year, monthNumber, timeZone)).toISOString(),
    to: new Date(firstInstantOfMonth(nextYear, nextMonth, timeZone)).toISOString(),
  };
}

export function currentAccountingPeriod(nowIso: string, timeZone: string): AccountingPeriod {
  const epochMs = Date.parse(nowIso);
  if (!Number.isFinite(epochMs)) throw new RangeError("current time must be a valid ISO timestamp");
  const wall = wallClockAt(epochMs, timeZone);
  return monthAccountingPeriod(`${wall.year}-${String(wall.month).padStart(2, "0")}`, timeZone);
}
