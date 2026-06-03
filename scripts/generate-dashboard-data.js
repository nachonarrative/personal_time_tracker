const fs = require("fs");
const path = require("path");

const { summarizeTasks } = require("../dashboard-core");

const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard");

function readJson(root, filename, fallback) {
  const filePath = path.join(root, filename);

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildDashboardData(options = {}) {
  const root = options.root || ROOT;
  const tasks = readJson(root, "all-stages.json", []);
  const ids = readJson(root, "all-ids.json", tasks.map((task) => task.id));
  const extraIds = readJson(root, "extra-ids.json", []);
  const missingGivenIds = readJson(root, "missing-given-ids.json", []);
  const summary = summarizeTasks(tasks, missingGivenIds, extraIds);

  return {
    generatedAt: new Date().toISOString(),
    ids,
    tasks,
    extraIds,
    missingGivenIds,
    summary,
  };
}

function writeDashboardData() {
  const data = buildDashboardData();

  fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DASHBOARD_DIR, "data.js"),
    `window.TASK_DASHBOARD_DATA = ${JSON.stringify(data, null, 2)};\n`
  );

  return data;
}

if (require.main === module) {
  const data = writeDashboardData();
  console.log(
    `Wrote dashboard/data.js with ${data.tasks.length} tasks and ${data.extraIds.length} extra IDs.`
  );
}

module.exports = {
  buildDashboardData,
  writeDashboardData,
};



