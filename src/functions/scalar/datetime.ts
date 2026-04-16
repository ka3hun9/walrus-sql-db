import type { SqlScalarFunction, SqlScalarFunctionPrimitive } from "../types.js";
import type { EvalContext, EvalContextPrimitive } from "../types.js";
import type { SqlPrimitive } from "../../types.js";
import type { SqlTypedValue } from "../../types.js";
import { fromJs } from "../../types.js";
import { nullTyped } from "../types.js";

// ============================================================================
// Date/Time helpers
// ============================================================================

function toNumber(v: SqlPrimitive): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseJulianDay(year: number, month: number, day: number, hour: number = 0, minute: number = 0, second: number = 0): number {
  // Based on the SQLite julian day algorithm
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  let jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const frac = (hour * 3600 + minute * 60 + second) / 86400.0;
  return jdn + frac - 0.5;
}

function julianDayToDate(jd: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const z = Math.floor(jd + 0.5);
  const a = Math.floor((4 * z + 3) / 146097);
  const b = z + 32044 - Math.floor(146097 * a / 4);
  const c = Math.floor((4 * b + 3) / 1461);
  const d = b - Math.floor(1461 * c / 4);
  const e = Math.floor((5 * d + 2) / 153);
  const day = d - Math.floor((153 * e + 2) / 5) + 1;
  const month = e + 3 - 12 * Math.floor(e / 10);
  const year = 100 * a + c - 4800 + Math.floor(e / 10);
  const frac = jd + 0.5 - z;
  const totalSecs = frac * 86400;
  const hour = Math.floor(totalSecs / 3600) % 24;
  const minute = Math.floor(totalSecs / 60) % 60;
  const second = Math.floor(totalSecs % 60);
  return { year, month, day, hour, minute, second };
}

function parseDateTimeString(s: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  // Try various formats: YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, etc.
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?))?$/);
  if (isoMatch) {
    return {
      year: parseInt(isoMatch[1]!),
      month: parseInt(isoMatch[2]!),
      day: parseInt(isoMatch[3]!),
      hour: isoMatch[4] ? parseInt(isoMatch[4]!) : 0,
      minute: isoMatch[5] ? parseInt(isoMatch[5]!) : 0,
      second: isoMatch[6] ? parseFloat(isoMatch[6]!) : 0,
    };
  }
  // Try YYYY/MM/DD
  const slashMatch = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    return {
      year: parseInt(slashMatch[1]!),
      month: parseInt(slashMatch[2]!),
      day: parseInt(slashMatch[3]!),
      hour: 0, minute: 0, second: 0,
    };
  }
  // Try "now"
  if (s.toLowerCase() === "now") {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
    };
  }
  return null;
}

function applyModifiers(date: { year: number; month: number; day: number; hour: number; minute: number; second: number }, modifiers: string[]): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let d = { ...date };
  for (const mod of modifiers) {
    const modTrim = mod.trim().toLowerCase();
    if (modTrim === "start of day") {
      d.hour = 0; d.minute = 0; d.second = 0;
    } else if (modTrim === "start of month") {
      d.day = 1; d.hour = 0; d.minute = 0; d.second = 0;
    } else if (modTrim === "start of year") {
      d.month = 1; d.day = 1; d.hour = 0; d.minute = 0; d.second = 0;
    } else if (modTrim === "start of week") {
      // Sunday as start of week
      const jd = parseJulianDay(d.year, d.month, d.day);
      const dow = Math.floor((jd + 1.5) % 7);
      const diff = dow; // days to subtract to get to Sunday
      const newJd = jd - diff;
      const nd = julianDayToDate(newJd);
      d = { ...nd };
    } else if (/^\+\d+ day[s]?$/.test(modTrim)) {
      const days = parseInt(modTrim.replace(/\D/g, ""));
      const jd = parseJulianDay(d.year, d.month, d.day, d.hour, d.minute, d.second);
      d = julianDayToDate(jd + days);
    } else if (/^-\d+ day[s]?$/.test(modTrim)) {
      const days = parseInt(modTrim.replace(/\D/g, ""));
      const jd = parseJulianDay(d.year, d.month, d.day, d.hour, d.minute, d.second);
      d = julianDayToDate(jd - days);
    } else if (/^\+\d+ month[s]?$/.test(modTrim)) {
      let months = parseInt(modTrim.replace(/\D/g, ""));
      let newMonth = d.month + months;
      let yearAdd = Math.floor((newMonth - 1) / 12);
      newMonth = ((newMonth - 1) % 12) + 1;
      d.month = newMonth;
      d.year += yearAdd;
    } else if (/^-\d+ month[s]?$/.test(modTrim)) {
      let months = parseInt(modTrim.replace(/\D/g, ""));
      let newMonth = d.month - months;
      let yearSub = Math.floor(newMonth / 12);
      newMonth = newMonth <= 0 ? 12 + (newMonth % 12 || 0) : newMonth % 12 || 12;
      d.year += yearSub - (newMonth <= 0 ? 1 : 0);
      if (newMonth <= 0) newMonth = 12;
      d.month = newMonth;
    } else if (/^\+\d+ year[s]?$/.test(modTrim)) {
      d.year += parseInt(modTrim.replace(/\D/g, ""));
    } else if (/^-\d+ year[s]?$/.test(modTrim)) {
      d.year -= parseInt(modTrim.replace(/\D/g, ""));
    } else if (/^\d+ day[s]?$/.test(modTrim)) {
      const days = parseInt(modTrim.replace(/\D/g, ""));
      const jd = parseJulianDay(d.year, d.month, d.day, d.hour, d.minute, d.second);
      d = julianDayToDate(jd + days);
    }
  }
  return d;
}

function strftimeFormat(format: string, date: { year: number; month: number; day: number; hour: number; minute: number; second: number }): string {
  const pad = (n: number, len: number = 2) => String(n).padStart(len, "0");
  return format
    .replace(/%Y/g, String(date.year).padStart(4, "0"))
    .replace(/%m/g, pad(date.month))
    .replace(/%d/g, pad(date.day))
    .replace(/%H/g, pad(date.hour))
    .replace(/%M/g, pad(date.minute))
    .replace(/%S/g, pad(Math.floor(date.second)))
    .replace(/%f/g, pad(Math.floor((date.second % 1) * 1000000), 6))
    .replace(/%j/g, pad(Math.floor((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(date.year, 0, 1)) / 86400000 + 1), 3))
    .replace(/%w/g, String(new Date(date.year, date.month - 1, date.day).getDay()))
    .replace(/%W/g, String(Math.floor((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(date.year, 0, 1)) / 604800000)))
    .replace(/%Y/g, String(date.year))
    .replace(/%%/g, "%");
}

// ============================================================================
// Typed (AST path) implementations
// ============================================================================

export const DATE: SqlScalarFunction = {
  name: "DATE",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
    const first = args[0]?.value;
    if (typeof first === "number") {
      // Julian day number
      date = julianDayToDate(first);
    } else if (typeof first === "string") {
      const parsed = parseDateTimeString(first);
      if (parsed) {
        const modifiers = args.slice(1).map(a => String(a.value ?? ""));
        date = applyModifiers(parsed, modifiers);
      }
    }
    if (!date) return nullTyped("datetime.date");
    return fromJs(`${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` as SqlPrimitive, undefined, {}, "datetime.date");
  },
};

export const TIME: SqlScalarFunction = {
  name: "TIME",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
    const first = args[0]?.value;
    if (typeof first === "number") {
      date = julianDayToDate(first);
    } else if (typeof first === "string") {
      const parsed = parseDateTimeString(first);
      if (parsed) {
        const modifiers = args.slice(1).map(a => String(a.value ?? ""));
        date = applyModifiers(parsed, modifiers);
      }
    }
    if (!date) return nullTyped("datetime.time");
    return fromJs(`${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}:${String(Math.floor(date.second)).padStart(2, "0")}` as SqlPrimitive, undefined, {}, "datetime.time");
  },
};

export const DATETIME: SqlScalarFunction = {
  name: "DATETIME",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
    const first = args[0]?.value;
    if (typeof first === "number") {
      date = julianDayToDate(first);
    } else if (typeof first === "string") {
      const parsed = parseDateTimeString(first);
      if (parsed) {
        const modifiers = args.slice(1).map(a => String(a.value ?? ""));
        date = applyModifiers(parsed, modifiers);
      }
    }
    if (!date) return nullTyped("datetime.datetime");
    return fromJs(`${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")} ${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}:${String(Math.floor(date.second)).padStart(2, "0")}` as SqlPrimitive, undefined, {}, "datetime.datetime");
  },
};

export const JULIANDAY: SqlScalarFunction = {
  name: "JULIANDAY",
  minArgs: 1,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
    const first = args[0]?.value;
    if (typeof first === "string") {
      const parsed = parseDateTimeString(first);
      if (parsed) {
        const modifiers = args.slice(1).map(a => String(a.value ?? ""));
        date = applyModifiers(parsed, modifiers);
      }
    }
    if (!date) return nullTyped("datetime.julianday");
    const jd = parseJulianDay(date.year, date.month, date.day, date.hour, date.minute, date.second);
    return fromJs(jd as SqlPrimitive, undefined, {}, "datetime.julianday");
  },
};

export const STRFTIME: SqlScalarFunction = {
  name: "STRFTIME",
  minArgs: 2,
  maxArgs: -1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const fmt = toStr(args[0]?.value ?? null);
    if (fmt === null) return nullTyped("datetime.strftime");
    let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
    const second = args[1]?.value;
    if (typeof second === "number") {
      date = julianDayToDate(second);
    } else if (typeof second === "string") {
      const parsed = parseDateTimeString(second);
      if (parsed) {
        const modifiers = args.slice(2).map(a => String(a.value ?? ""));
        date = applyModifiers(parsed, modifiers);
      }
    }
    if (!date) return nullTyped("datetime.strftime");
    return fromJs(strftimeFormat(fmt, date) as SqlPrimitive, undefined, {}, "datetime.strftime");
  },
};

export const NOW: SqlScalarFunction = {
  name: "NOW",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    const now = new Date();
    const jd = parseJulianDay(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
    return fromJs(jd as SqlPrimitive, undefined, {}, "datetime.now");
  },
};

export const CURRENT_TIMESTAMP: SqlScalarFunction = {
  name: "CURRENT_TIMESTAMP",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    const now = new Date();
    const jd = parseJulianDay(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
    return fromJs(jd as SqlPrimitive, undefined, {}, "datetime.current_timestamp");
  },
};

export const CURRENT_DATE: SqlScalarFunction = {
  name: "CURRENT_DATE",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    const now = new Date();
    const jd = parseJulianDay(now.getFullYear(), now.getMonth() + 1, now.getDate(), 0, 0, 0);
    return fromJs(jd as SqlPrimitive, undefined, {}, "datetime.current_date");
  },
};

export const CURRENT_TIME: SqlScalarFunction = {
  name: "CURRENT_TIME",
  minArgs: 0,
  maxArgs: 0,
  evaluate(): SqlTypedValue {
    const now = new Date();
    const jd = parseJulianDay(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
    return fromJs(jd as SqlPrimitive, undefined, {}, "datetime.current_time");
  },
};

export const YEAR: SqlScalarFunction = {
  name: "YEAR",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.year as SqlPrimitive, undefined, {}, "datetime.year");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.year as SqlPrimitive, undefined, {}, "datetime.year");
    }
    return nullTyped("datetime.year");
  },
};

export const MONTH: SqlScalarFunction = {
  name: "MONTH",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.month as SqlPrimitive, undefined, {}, "datetime.month");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.month as SqlPrimitive, undefined, {}, "datetime.month");
    }
    return nullTyped("datetime.month");
  },
};

export const DAY: SqlScalarFunction = {
  name: "DAY",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.day as SqlPrimitive, undefined, {}, "datetime.day");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.day as SqlPrimitive, undefined, {}, "datetime.day");
    }
    return nullTyped("datetime.day");
  },
};

export const HOUR: SqlScalarFunction = {
  name: "HOUR",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.hour as SqlPrimitive, undefined, {}, "datetime.hour");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.hour as SqlPrimitive, undefined, {}, "datetime.hour");
    }
    return nullTyped("datetime.hour");
  },
};

export const MINUTE: SqlScalarFunction = {
  name: "MINUTE",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.minute as SqlPrimitive, undefined, {}, "datetime.minute");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.minute as SqlPrimitive, undefined, {}, "datetime.minute");
    }
    return nullTyped("datetime.minute");
  },
};

export const SECOND: SqlScalarFunction = {
  name: "SECOND",
  minArgs: 1,
  maxArgs: 1,
  evaluate(args: SqlTypedValue[], _ctx: EvalContext): SqlTypedValue {
    const v = args[0]?.value;
    if (typeof v === "string") {
      const parsed = parseDateTimeString(v);
      if (parsed) return fromJs(parsed.second as SqlPrimitive, undefined, {}, "datetime.second");
    } else if (typeof v === "number") {
      const d = julianDayToDate(v);
      return fromJs(d.second as SqlPrimitive, undefined, {}, "datetime.second");
    }
    return nullTyped("datetime.second");
  },
};

// ============================================================================
// Primitive (string-replay) implementations
// ============================================================================

function toStr(v: SqlPrimitive): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function datePrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
  const first = args[0];
  if (typeof first === "number") {
    date = julianDayToDate(first);
  } else if (typeof first === "string") {
    const parsed = parseDateTimeString(first);
    if (parsed) {
      const modifiers = args.slice(1).map(a => String(a ?? ""));
      date = applyModifiers(parsed, modifiers);
    }
  }
  if (!date) return null;
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function juliandayPrim(args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  let date: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
  const first = args[0];
  if (typeof first === "string") {
    const parsed = parseDateTimeString(first);
    if (parsed) {
      const modifiers = args.slice(1).map(a => String(a ?? ""));
      date = applyModifiers(parsed, modifiers);
    }
  }
  if (!date) return null;
  return parseJulianDay(date.year, date.month, date.day, date.hour, date.minute, date.second);
}

function nowPrim(_args: SqlPrimitive[], _ctx: EvalContextPrimitive): SqlPrimitive | null {
  const now = new Date();
  return parseJulianDay(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
}

export const DATETIME_PRIMITIVE_FUNCTIONS: Record<string, SqlScalarFunctionPrimitive> = {
  DATE: { name: "DATE", minArgs: 1, maxArgs: -1, evaluate: datePrim },
  TIME: { name: "TIME", minArgs: 1, maxArgs: -1, evaluate: datePrim },
  DATETIME: { name: "DATETIME", minArgs: 1, maxArgs: -1, evaluate: datePrim },
  JULIANDAY: { name: "JULIANDAY", minArgs: 1, maxArgs: -1, evaluate: juliandayPrim },
  NOW: { name: "NOW", minArgs: 0, maxArgs: 0, evaluate: nowPrim },
  STRFTIME: { name: "STRFTIME", minArgs: 2, maxArgs: -1, evaluate: (args, ctx) => {
    const fmt = toStr(args[0]);
    if (!fmt) return null;
    const second = args[1];
    if (typeof second === "number") {
      const d = julianDayToDate(second);
      return strftimeFormat(fmt, d);
    } else if (typeof second === "string") {
      const parsed = parseDateTimeString(second);
      if (!parsed) return null;
      const modifiers = args.slice(2).map(a => String(a ?? ""));
      const d = applyModifiers(parsed, modifiers);
      return strftimeFormat(fmt, d);
    }
    return null;
  }},
};
