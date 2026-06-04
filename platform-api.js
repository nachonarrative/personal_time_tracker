const {
  PAGE_SIZE,
  buildMyTasksUrl,
  createCookieHeader,
  extractTasks,
  fetchTasksPage,
  getProjectId,
} = require("./main");
const { summarizeTasks } = require("./dashboard-core");

const PLATFORM_ORIGIN =
  process.env.TRAINER_PLATFORM_ORIGIN || "https://ai.joinhandshake.com";
const WORKER_ROUTE = ["fel", "low"].join("");
const WORKER_ID_FIELD = `${WORKER_ROUTE}Id`;
const workerProcedure = (name) => `${WORKER_ROUTE}.${name}`;
const DEFAULT_REFERER = `${PLATFORM_ORIGIN}/${WORKER_ROUTE}/projects`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildTrpcUrl(procedure, input) {
  const url = new URL(`/api/trpc/${procedure}`, PLATFORM_ORIGIN);

  url.searchParams.set("batch", "1");

  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ "0": { json: input } }));
  }

  return url.toString();
}

function buildTrpcBody(input) {
  return JSON.stringify({ "0": { json: input } });
}

function extractTrpcJson(payload, procedure) {
  const entry = payload?.[0];

  if (entry?.error) {
    throw new Error(
      entry.error?.json?.message || `${procedure} returned an error.`
    );
  }

  return entry?.result?.data?.json;
}

function getCookieValue(storageState, name, targetUrl) {
  const url = new URL(targetUrl);
  const cookie = (storageState.cookies || []).find((item) => {
    const domain = (item.domain || "").startsWith(".")
      ? item.domain.slice(1)
      : item.domain || "";
    const path = item.path || "/";

    return (
      item.name === name &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) &&
      url.pathname.startsWith(path)
    );
  });

  return cookie?.value || "";
}

function buildTrpcHeaders(storageState, url, options = {}) {
  const cookieHeader = createCookieHeader(storageState, url);

  if (!cookieHeader) {
    throw new Error("platform session is not connected.");
  }

  const csrfToken =
    getCookieValue(storageState, "XSRF-TOKEN", url) ||
    getCookieValue(storageState, "csrf-token", url) ||
    getCookieValue(storageState, "_csrf_token", url);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: cookieHeader,
    Referer: options.referer || DEFAULT_REFERER,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
  };

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
    headers["X-XSRF-TOKEN"] = csrfToken;
  }

  return headers;
}

async function fetchTrpc(procedure, input, storageState, options = {}) {
  const url = buildTrpcUrl(procedure, input);

  const response = await (options.fetch || fetch)(url, {
    headers: buildTrpcHeaders(storageState, url, options),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("trainer platform login expired. Connect again.");
  }

  if (!response.ok) {
    throw new Error(`${procedure} failed with status ${response.status}.`);
  }

  return extractTrpcJson(await response.json(), procedure);
}

async function fetchTrpcMutation(procedure, input, storageState, options = {}) {
  const url = buildTrpcUrl(procedure);
  const response = await (options.fetch || fetch)(url, {
    method: "POST",
    headers: {
      ...buildTrpcHeaders(storageState, url, options),
      "Content-Type": "application/json",
    },
    body: buildTrpcBody(input),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("trainer platform login expired. Connect again.");
  }

  if (!response.ok) {
    throw new Error(`${procedure} failed with status ${response.status}.`);
  }

  return extractTrpcJson(await response.json(), procedure);
}

function parseCurrencyToCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  const amount = Number.parseFloat(String(value || "").replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function normalizeProjectInput(value) {
  const input = String(value || "").trim();

  if (!input) {
    throw new Error("Enter a training project URL or project ID.");
  }

  if (UUID_PATTERN.test(input)) {
    return {
      projectId: input,
      projectUrl: `${PLATFORM_ORIGIN}/${WORKER_ROUTE}/projects/past/${input}`,
    };
  }

  const projectId = getProjectId(input);

  return {
    projectId,
    projectUrl: input,
  };
}

function normalizeProjectList(activeProjects = [], pastProjects = []) {
  const projects = [];
  const seen = new Set();

  for (const [source, list] of [
    ["current", activeProjects],
    ["past", pastProjects],
  ]) {
    for (const project of list) {
      if (!project?.id || seen.has(project.id)) {
        continue;
      }

      seen.add(project.id);
      projects.push({
        id: project.id,
        name: project.name || "Untitled project",
        status: project.status || "unknown",
        source,
      });
    }
  }

  return projects;
}

function pickFirst(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function pickFirstIsoLike(values) {
  for (const value of values) {
    if (typeof value === "string" && value.length >= 8) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.toISOString();
  }
  return null;
}

function normalizeTask(task, project = {}) {
  const data = task.data || {};
  const stage = task.$related?.pipelineStage || task.pipelineStage || {};

  const updatedAt = pickFirstIsoLike([
    task.statusUpdatedAt,
    task.status_updated_at,
    task.lastStatusChangeAt,
    task.lastActionAt,
    task.last_action_at,
    task.updatedAt,
    task.updated_at,
    task.modifiedAt,
    task.lastModifiedAt,
    stage.enteredAt,
    stage.updated_at,
    data.status_updated_at,
    data.updated_at,
  ]);

  return {
    id: task.id,
    projectId: project.id || task.annotationProjectId || "",
    projectName: project.name || "",
    stage:
      task.$related?.pipelineStage?.name ||
      task.pipelineStage?.name ||
      "No stage found",
    status: pickFirst([task.status, task.taskStatus, task.reviewStatus, task.state]),
    buildStatus: task.buildStatus ?? null,
    title: data.task_title || task.title || "",
    updatedAt,
  };
}

function normalizePayment(payment = {}) {
  return {
    id: payment.id || "",
    projectId: payment.projectId || payment.projectAssignment?.projectId || null,
    projectName: payment.projectName || "",
    amount: payment.amount || "",
    amountCentsUsd:
      typeof payment.amountCentsUsd === "number"
        ? payment.amountCentsUsd
        : parseCurrencyToCents(payment.amount),
    date: payment.date || null,
    status: payment.status || "unknown",
    rate: payment.rate || null,
    description: payment.description || null,
    payableActivityIds: Array.isArray(payment.payableActivityIds)
      ? payment.payableActivityIds.filter(Boolean)
      : [],
    createdAt: payment.createdAt || null,
  };
}

function normalizePayActivity(activity = {}) {
  return {
    id: activity.id || "",
    projectId: activity.projectId || null,
    projectName: activity.projectName || "",
    sourceType: activity.sourceType || "",
    earningType: activity.earningType || "task",
    taskId: activity.taskId || null,
    amountCentsUsd:
      typeof activity.amountCentsUsd === "number" ? activity.amountCentsUsd : 0,
    hours: typeof activity.hours === "number" ? activity.hours : null,
    hourlyRateCentsUsd:
      typeof activity.hourlyRateCentsUsd === "number"
        ? activity.hourlyRateCentsUsd
        : null,
    totalTasks: typeof activity.totalTasks === "number" ? activity.totalTasks : 0,
  };
}

function normalizeCurrentWeekPayActivity(activity = {}) {
  const timeEarnedSeconds =
    typeof activity.timeEarnedSeconds === "number" &&
    Number.isFinite(activity.timeEarnedSeconds)
      ? activity.timeEarnedSeconds
      : 0;

  return {
    id: activity.id || "",
    taskId: activity.taskId || null,
    projectId: activity.projectId || null,
    projectName: activity.projectName || "",
    timeEarnedSeconds,
    hours: timeEarnedSeconds / 3600,
  };
}

function collectPayActivityIds(payments = [], earningsData = {}) {
  return [
    ...new Set(
      [
        ...payments.flatMap((payment) =>
          Array.isArray(payment.payableActivityIds)
            ? payment.payableActivityIds.filter(Boolean)
            : []
        ),
        ...(earningsData.payableActivityIds || []),
        ...(earningsData.data || []).map((earning) => earning.payableActivityId),
      ].filter(Boolean)
    ),
  ];
}

function summarizePayActivities(activities = []) {
  const byProject = new Map();

  for (const activity of activities) {
    const key = activity.projectId || `earningType:${activity.earningType}`;
    const entry =
      byProject.get(key) ||
      {
        projectId: activity.projectId,
        projectName: activity.projectName || activity.earningType || "Unassigned",
        tasks: 0,
        hours: 0,
        earnedCents: 0,
      };

    entry.tasks += activity.totalTasks || 0;
    entry.hours += activity.hours || 0;
    entry.earnedCents += activity.amountCentsUsd || 0;
    byProject.set(key, entry);
  }

  return {
    totalActivities: activities.length,
    totalTasks: activities.reduce((total, activity) => total + activity.totalTasks, 0),
    totalHours: activities.reduce((total, activity) => total + (activity.hours || 0), 0),
    totalEarnedCents: activities.reduce(
      (total, activity) => total + (activity.amountCentsUsd || 0),
      0
    ),
    byProject: [...byProject.values()],
  };
}

function summarizeCurrentWeekActivities(activities = []) {
  const taskIds = new Set();
  let totalSeconds = 0;

  for (const activity of activities) {
    if (activity.taskId) taskIds.add(activity.taskId);
    totalSeconds += activity.timeEarnedSeconds || 0;
  }

  return {
    tasksThisWeek: taskIds.size,
    loggedHoursThisWeek: totalSeconds / 3600,
  };
}

function getPreviousWeekRange(referenceDate = new Date()) {
  const { start, end } = getCurrentWeekRange(referenceDate);

  start.setUTCDate(start.getUTCDate() - 7);
  end.setUTCDate(end.getUTCDate() - 7);

  return { start, end };
}

function getCurrentWeekRange(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return { start, end };
}

function summarizePayoutWindow(
  earningsData = {},
  payActivities = [],
  { start, end }
) {
  const activitiesById = new Map(payActivities.map((activity) => [activity.id, activity]));
  const rows = (earningsData.data || []).filter((earning) => {
    const createdAt = new Date(earning.createdAt);

    return (
      earning.payoutId === null &&
      earning.voidedAt === null &&
      !Number.isNaN(createdAt.getTime()) &&
      createdAt >= start &&
      createdAt < end
    );
  });
  const byDay = new Map();
  const breakdown = new Map();

  for (const earning of rows) {
    const day = earning.createdAt.slice(0, 10);
    const activity = activitiesById.get(earning.payableActivityId) || {};
    const projectName = activity.projectName || "Unassigned";
    const projectId = activity.projectId || null;
    const rateCents = activity.hourlyRateCentsUsd ?? null;
    const earningType = activity.earningType || earning.earningType || null;
    const sourceType = activity.sourceType || null;
    const key = [
      day,
      projectId || projectName,
      rateCents ?? "none",
      earningType || "none",
      sourceType || "none",
    ].join("|");
    const entry =
      breakdown.get(key) ||
      {
        date: day,
        projectId,
        projectName,
        hours: 0,
        hourlyRateCentsUsd: rateCents,
        amountCentsUsd: 0,
        earningType,
        sourceType,
        rowCount: 0,
      };

    entry.hours += activity.hours || 0;
    entry.amountCentsUsd += earning.amountCentsUsd || 0;
    entry.rowCount += 1;
    breakdown.set(key, entry);
    byDay.set(day, (byDay.get(day) || 0) + (earning.amountCentsUsd || 0));
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    rowCount: rows.length,
    totalCents: rows.reduce((total, earning) => total + (earning.amountCentsUsd || 0), 0),
    incentive: [...breakdown.values()].reduce(
      (total, entry) => {
        if (
          entry.earningType === "incentive" &&
          entry.sourceType === "incentive_milestone_achievement"
        ) {
          total.rowCount += entry.rowCount;
          total.totalCents += entry.amountCentsUsd;
        }
        return total;
      },
      { rowCount: 0, totalCents: 0 }
    ),
    hoursTotal: [...breakdown.values()].reduce(
      (total, entry) => {
        if (
          !(
            entry.earningType === "incentive" &&
            entry.sourceType === "incentive_milestone_achievement"
          )
        ) {
          total.rowCount += entry.rowCount;
          total.totalCents += entry.amountCentsUsd;
          total.hours += entry.hours || 0;
        }
        return total;
      },
      { rowCount: 0, totalCents: 0, hours: 0 }
    ),
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, amountCentsUsd]) => ({ day, amountCentsUsd })),
    breakdown: [...breakdown.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.projectName.localeCompare(b.projectName) ||
        (a.hourlyRateCentsUsd || 0) - (b.hourlyRateCentsUsd || 0)
    ),
  };
}

function summarizeExpectedPayout(
  earningsData = {},
  referenceDate = new Date(),
  payActivities = []
) {
  return summarizePayoutWindow(earningsData, payActivities, getPreviousWeekRange(referenceDate));
}

function summarizeCurrentWeekPayout(
  earningsData = {},
  referenceDate = new Date(),
  payActivities = []
) {
  return summarizePayoutWindow(earningsData, payActivities, getCurrentWeekRange(referenceDate));
}

function pickLatestProcessingPayment(payments = []) {
  return payments.find((payment) =>
    ["approved", "processing", "pending"].includes(String(payment.status).toLowerCase())
  ) || null;
}

async function fetchPayActivitiesByIds(payActivityIds, storageState, options = {}) {
  const chunkSize = options.payActivityChunkSize || 100;
  const activities = [];

  for (let index = 0; index < payActivityIds.length; index += chunkSize) {
    const chunk = payActivityIds.slice(index, index + chunkSize);
    const result = await fetchTrpcMutation(
      workerProcedure("getPayActivitiesByIds"),
      { payActivityIds: chunk },
      storageState,
      options
    );

    activities.push(...(Array.isArray(result) ? result : []));
  }

  return activities.map(normalizePayActivity);
}

async function fetchProfile(storageState, options = {}) {
  const data = await fetchTrpc("profile.getSelf", undefined, storageState, options);

  return data.profile;
}

async function fetchProjects(storageState, options = {}) {
  const profile = await fetchProfile(storageState, options);
  const [currentData, pastData] = await Promise.all([
    fetchTrpc(
      "annotationProject.listByProfileId",
      { profileId: profile.id },
      storageState,
      options
    ),
    fetchTrpc(
      "annotationProject.listPastProjectsByProfileId",
      { profileId: profile.id },
      storageState,
      options
    ),
  ]);

  return {
    profile: {
      id: profile.id,
      name: profile.name || profile.fullName || "trainer",
    },
    projects: normalizeProjectList(
      currentData.annotationProjects || [],
      pastData.projects || []
    ),
  };
}

async function fetchAllTasksForProject(
  projectInput,
  storageState,
  options = {}
) {
  const { projectId, projectUrl } = normalizeProjectInput(projectInput);
  const pageSize = options.pageSize || PAGE_SIZE;
  const fetchPage = options.fetchPage || fetchTasksPage;
  const tasks = [];

  for (let offset = 0; ; offset += pageSize) {
    let payload;

    try {
      payload = await fetchPage(projectUrl, storageState, pageSize, offset);
    } catch (err) {
      if (offset === 0 || !err.message.includes("status 500")) {
        throw err;
      }

      const nextPayload = await fetchPage(
        projectUrl,
        storageState,
        pageSize,
        offset + pageSize
      );

      if (extractTasks(nextPayload).length === 0) {
        break;
      }

      throw err;
    }

    const pageTasks = extractTasks(payload);

    tasks.push(...pageTasks);

    if (pageTasks.length < pageSize) {
      break;
    }
  }

  return {
    projectId,
    projectUrl,
    tasks,
  };
}

function buildDashboardPayload({ project, tasks }) {
  const normalizedTasks = tasks.map((task) => normalizeTask(task, project));

  return {
    generatedAt: new Date().toISOString(),
    project,
    ids: normalizedTasks.map((task) => task.id),
    tasks: normalizedTasks,
    summary: summarizeTasks(normalizedTasks),
  };
}

async function fetchDashboardForProject(projectInput, storageState, options = {}) {
  const { projectId, tasks } = await fetchAllTasksForProject(
    projectInput,
    storageState,
    options
  );
  const project =
    options.project || {
      id: projectId,
      name: `Project ${projectId.slice(0, 8)}`,
    };

  if (process.env.DEBUG_TASKS === "1" && tasks[0]) {
    console.log("[DEBUG_TASKS] first raw task keys:", Object.keys(tasks[0]));
    console.log("[DEBUG_TASKS] first raw task json:");
    console.log(JSON.stringify(tasks[0], null, 2));
  }

  return buildDashboardPayload({ project, tasks });
}

async function fetchDashboardForAllProjects(storageState, options = {}) {
  const { profile, projects } = await fetchProjects(storageState, options);
  const taskGroups = [];
  const errors = [];

  for (const project of projects) {
    try {
      const result = await fetchAllTasksForProject(project.id, storageState, options);
      taskGroups.push({ project, tasks: result.tasks });
    } catch (err) {
      errors.push({ project, message: err.message });
    }
  }

  const tasks = taskGroups.flatMap(({ project, tasks: projectTasks }) =>
    projectTasks.map((task) => normalizeTask(task, project))
  );
  const uniqueTasks = [];
  const seen = new Set();

  for (const task of tasks) {
    const key = `${task.projectId}:${task.id}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueTasks.push(task);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    profile,
    projects,
    errors,
    ids: uniqueTasks.map((task) => task.id),
    tasks: uniqueTasks,
    summary: summarizeTasks(uniqueTasks),
  };
}

async function fetchPaymentsDashboard(storageState, options = {}) {
  const profile = options.profile || (await fetchProfile(storageState, options));
  const profileId = profile.id;
  const pageSize = options.pageSize || 500;
  const [profilePaymentsData, contractPayoutsData, earningsData] = await Promise.all([
    fetchTrpc(
      workerProcedure("listProfilePayments"),
      { [WORKER_ID_FIELD]: profileId, page: 1, pageSize },
      storageState,
      options
    ),
    fetchTrpc(
      workerProcedure("listContractPayouts"),
      { profileId, page: 1, pageSize },
      storageState,
      options
    ),
    fetchTrpc(workerProcedure("getEarnings"), { [WORKER_ID_FIELD]: profileId }, storageState, options),
  ]);
  let currentWeekData = [];
  let currentWeekError = null;

  try {
    currentWeekData = await fetchTrpc(
      workerProcedure("listCurrentWeekPayActivities"),
      { [WORKER_ID_FIELD]: profileId },
      storageState,
      options
    );
  } catch (err) {
    currentWeekError = err.message;
  }

  const payments = (profilePaymentsData?.payouts || []).map(normalizePayment);
  const contractPayouts = (contractPayoutsData?.payouts || []).map(normalizePayment);
  const currentWeekActivities = (
    Array.isArray(currentWeekData) ? currentWeekData : currentWeekData?.activities || []
  ).map(normalizeCurrentWeekPayActivity);
  const payActivityIds = collectPayActivityIds(payments, earningsData);
  const payActivities =
    payActivityIds.length > 0
      ? await fetchPayActivitiesByIds(payActivityIds, storageState, options)
      : [];

  return {
    generatedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name || profile.fullName || "trainer",
    },
    earnings: earningsData,
    payments,
    contractPayouts,
    payActivities,
    currentWeekActivities,
    summary: {
      ...summarizePayActivities(payActivities),
      ...summarizeCurrentWeekActivities(currentWeekActivities),
      expectedPayout: summarizeExpectedPayout(
        earningsData,
        options.referenceDate || new Date(),
        payActivities
      ),
      currentWeekPayout: summarizeCurrentWeekPayout(
        earningsData,
        options.referenceDate || new Date(),
        payActivities
      ),
      processingPayout: pickLatestProcessingPayment(payments),
      currentWeekError,
    },
  };
}

module.exports = {
  PLATFORM_ORIGIN,
  buildDashboardPayload,
  buildTrpcBody,
  buildTrpcUrl,
  fetchDashboardForAllProjects,
  fetchDashboardForProject,
  fetchPaymentsDashboard,
  fetchPayActivitiesByIds,
  fetchProfile,
  fetchProjects,
  fetchTrpcMutation,
  getCurrentWeekRange,
  getPreviousWeekRange,
  normalizeCurrentWeekPayActivity,
  normalizePayActivity,
  normalizePayment,
  normalizeProjectInput,
  normalizeProjectList,
  normalizeTask,
  summarizeCurrentWeekPayout,
  summarizeExpectedPayout,
};



