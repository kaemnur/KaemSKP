import { strict as assert } from "node:assert";
import { getNextAutoPostAt } from "../src/main/scheduler/nextAutoPost";

const cases = [
  {
    name: "Senin 07:59 -> Senin 08:00",
    now: "2026-07-13T00:59:00.000Z",
    expected: "2026-07-13T01:00:00.000Z"
  },
  {
    name: "Senin 08:01 -> Selasa 08:00",
    now: "2026-07-13T01:01:00.000Z",
    expected: "2026-07-14T01:00:00.000Z"
  },
  {
    name: "Jumat 08:01 -> Senin 08:00",
    now: "2026-07-17T01:01:00.000Z",
    expected: "2026-07-20T01:00:00.000Z"
  },
  {
    name: "Senin libur -> Selasa 08:00",
    now: "2026-07-20T00:30:00.000Z",
    holidays: [{ date: "2026-07-20" }],
    expected: "2026-07-21T01:00:00.000Z"
  },
  {
    name: "Sabtu dilewati -> Senin 08:00",
    now: "2026-07-18T02:00:00.000Z",
    expected: "2026-07-20T01:00:00.000Z"
  },
  {
    name: "Libur berurutan dilewati -> Rabu 08:00",
    now: "2026-07-20T00:30:00.000Z",
    holidays: [{ date: "2026-07-20" }, { date: "2026-07-21" }],
    expected: "2026-07-22T01:00:00.000Z"
  }
];

for (const item of cases) {
  const result = getNextAutoPostAt(new Date(item.now), {}, item.holidays ?? []);
  assert.equal(result.nextAutoPostAt, item.expected, item.name);
  console.log(`ok - ${item.name}`);
}
