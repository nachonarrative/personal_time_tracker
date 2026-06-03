const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildDashboardData } = require("./generate-dashboard-data");

test("buildDashboardData combines fetched tasks, comparisons, and summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-dashboard-"));
  const tasks = Array.from({ length: 80 }, (_, index) => ({
    id: `task-${index + 1}`,
    stage: index === 0 ? "Review 1" : "Delivered",
    buildStatus: index === 0 ? "failing" : "passing",
  }));

  fs.writeFileSync(path.join(root, "all-stages.json"), JSON.stringify(tasks));
  fs.writeFileSync(
    path.join(root, "all-ids.json"),
    JSON.stringify(tasks.map((task) => task.id))
  );
  fs.writeFileSync(
    path.join(root, "extra-ids.json"),
    JSON.stringify(Array.from({ length: 24 }, (_, index) => `extra-${index + 1}`))
  );
  fs.writeFileSync(
    path.join(root, "missing-given-ids.json"),
    JSON.stringify(Array.from({ length: 11 }, (_, index) => `missing-${index + 1}`))
  );

  const data = buildDashboardData({ root });

  assert.equal(data.tasks.length, 80);
  assert.equal(data.ids.length, 80);
  assert.equal(data.extraIds.length, 24);
  assert.equal(data.missingGivenIds.length, 11);
  assert.equal(data.summary.total, 80);
  assert.equal(data.summary.failingCount, 1);
});



