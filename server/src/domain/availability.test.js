import assert from "node:assert/strict";
import test from "node:test";
import { sliceSlotStarts, subtractIntervals } from "./availability.js";
import { addDaysYmd, isoWeekday, nowUtcIso, zonedLocalToUtcIso } from "./time.js";

test("Moscow 10:00 is 07:00Z", () => {
  assert.equal(zonedLocalToUtcIso("2026-08-26", "10:00", "Europe/Moscow"), "2026-08-26T07:00:00Z");
  assert.equal(zonedLocalToUtcIso("2026-08-26", "18:00", "Europe/Moscow"), "2026-08-26T15:00:00Z");
});

test("ISO weekday treats YYYY-MM-DD as a civil date", () => {
  assert.equal(isoWeekday("2026-08-26"), 3);
  assert.equal(isoWeekday("2026-08-30"), 7);
  assert.equal(addDaysYmd("2026-08-30", 1), "2026-08-31");
});

test("nowUtcIso drops milliseconds", () => {
  assert.match(nowUtcIso(new Date("2026-08-26T07:00:00.123Z")), /^2026-08-26T07:00:00Z$/);
});

test("subtractIntervals cuts a busy block out of a window", () => {
  const start = Date.parse("2026-08-26T07:00:00Z");
  const end = Date.parse("2026-08-26T15:00:00Z");
  const busyStart = Date.parse("2026-08-26T10:00:00Z");
  const busyEnd = Date.parse("2026-08-26T11:30:00Z");
  const free = subtractIntervals([{ start, end }], [{ start: busyStart, end: busyEnd }]);
  assert.deepEqual(free, [
    { start, end: busyStart },
    { start: busyEnd, end },
  ]);
});

test("adjacent busy intervals do not overlap [start, end)", () => {
  const start = Date.parse("2026-08-26T07:00:00Z");
  const mid = Date.parse("2026-08-26T08:30:00Z");
  const end = Date.parse("2026-08-26T10:00:00Z");
  const free = subtractIntervals([{ start, end }], [{ start, end: mid }]);
  assert.deepEqual(free, [{ start: mid, end }]);
});

test("sliceSlotStarts keeps visits that finish at the window end", () => {
  const start = Date.parse("2026-08-26T07:00:00Z");
  const end = Date.parse("2026-08-26T15:00:00Z");
  const duration = 90 * 60 * 1000;
  const step = 30 * 60 * 1000;
  const slots = sliceSlotStarts([{ start, end }], duration, step);
  assert.equal(nowUtcIso(new Date(slots[0].start)), "2026-08-26T07:00:00Z");
  assert.equal(nowUtcIso(new Date(slots.at(-1).start)), "2026-08-26T13:30:00Z");
  assert.equal(nowUtcIso(new Date(slots.at(-1).end)), "2026-08-26T15:00:00Z");
});
