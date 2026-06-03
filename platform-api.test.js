const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDashboardPayload,
  buildTrpcBody,
  buildTrpcUrl,
  fetchPayActivitiesByIds,
  fetchTrpcMutation,
  normalizeCurrentWeekPayActivity,
  normalizePayActivity,
  normalizePayment,
  normalizeProjectInput,
  normalizeProjectList,
  summarizeCurrentWeekPayout,
  summarizeExpectedPayout,
} = require("./platform-api");

const WORKER_ROUTE = ["fel", "low"].join("");
const workerProcedure = (name) => `${WORKER_ROUTE}.${name}`;

test("normalizeProjectInput accepts project IDs and training project URLs", () => {
  assert.deepEqual(
    normalizeProjectInput("00000000-0000-4000-8000-000000000000"),
    {
      projectId: "00000000-0000-4000-8000-000000000000",
      projectUrl:
        `https://training-platform.example/${WORKER_ROUTE}/projects/past/00000000-0000-4000-8000-000000000000`,
    }
  );
  assert.deepEqual(
    normalizeProjectInput(
      `https://training-platform.example/${WORKER_ROUTE}/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902`
    ),
    {
      projectId: "a1c6c53b-cfad-414e-bad6-c9a68f7ee902",
      projectUrl:
        `https://training-platform.example/${WORKER_ROUTE}/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902`,
    }
  );
});

test("buildTrpcUrl encodes batched tRPC input", () => {
  const url = new URL(
    buildTrpcUrl("annotationProject.listByProfileId", {
      profileId: "profile-1",
    })
  );

  assert.equal(url.pathname, "/api/trpc/annotationProject.listByProfileId");
  assert.equal(url.searchParams.get("batch"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("input")), {
    "0": { json: { profileId: "profile-1" } },
  });
});

test("buildTrpcBody encodes tRPC mutation input", () => {
  assert.equal(
    buildTrpcBody({ payActivityIds: ["activity-1"] }),
    JSON.stringify({ "0": { json: { payActivityIds: ["activity-1"] } } })
  );
});

test("fetchTrpcMutation posts batched tRPC body", async () => {
  const storageState = {
    cookies: [
      {
        name: "session",
        value: "abc",
        domain: "training-platform.example",
        path: "/",
      },
    ],
  };
  let captured;
  const result = await fetchTrpcMutation(
    workerProcedure("getPayActivitiesByIds"),
    { payActivityIds: ["activity-1"] },
    storageState,
    {
      fetch: async (url, options) => {
        captured = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              result: {
                data: {
                  json: [{ id: "activity-1", hours: 2 }],
                },
              },
            },
          ],
        };
      },
    }
  );

  assert.equal(captured.options.method, "POST");
  assert.equal(
    captured.url,
    `https://training-platform.example/api/trpc/${workerProcedure("getPayActivitiesByIds")}?batch=1`
  );
  assert.equal(
    captured.options.body,
    JSON.stringify({ "0": { json: { payActivityIds: ["activity-1"] } } })
  );
  assert.deepEqual(result, [{ id: "activity-1", hours: 2 }]);
});

test("fetchPayActivitiesByIds chunks large activity lookups", async () => {
  const storageState = {
    cookies: [
      {
        name: "session",
        value: "abc",
        domain: "training-platform.example",
        path: "/",
      },
    ],
  };
  const bodies = [];
  const activities = await fetchPayActivitiesByIds(
    ["a1", "a2", "a3"],
    storageState,
    {
      payActivityChunkSize: 2,
      fetch: async (_url, options) => {
        const ids = JSON.parse(options.body)["0"].json.payActivityIds;
        bodies.push(ids);
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              result: {
                data: {
                  json: ids.map((id) => ({ id, earningType: "task" })),
                },
              },
            },
          ],
        };
      },
    }
  );

  assert.deepEqual(bodies, [["a1", "a2"], ["a3"]]);
  assert.deepEqual(
    activities.map((activity) => activity.id),
    ["a1", "a2", "a3"]
  );
});

test("normalizeProjectList merges active and past projects", () => {
  assert.deepEqual(
    normalizeProjectList(
      [{ id: "active-1", name: "Active", status: "active" }],
      [{ id: "past-1", name: "Past", status: "paused" }]
    ),
    [
      { id: "active-1", name: "Active", status: "active", source: "current" },
      { id: "past-1", name: "Past", status: "paused", source: "past" },
    ]
  );
});

test("buildDashboardPayload creates task summaries with project context", () => {
  const payload = buildDashboardPayload({
    project: { id: "project-1", name: "Project One" },
    tasks: [
      {
        id: "task-1",
        pipelineStage: { name: "Internal Audit" },
        buildStatus: "failing",
        data: { task_title: "Fix a thing" },
      },
    ],
  });

  assert.equal(payload.summary.total, 1);
  assert.equal(payload.summary.failingCount, 1);
  assert.deepEqual(payload.tasks[0], {
    id: "task-1",
    projectId: "project-1",
    projectName: "Project One",
    stage: "Internal Audit",
    status: null,
    buildStatus: "failing",
    title: "Fix a thing",
    updatedAt: null,
  });
});

test("normalizes payment and pay activity shapes", () => {
  assert.deepEqual(
    normalizePayment({
      id: "payout-1",
      amount: "$324.92",
      status: "paid",
      payableActivityIds: ["activity-1"],
    }),
    {
      id: "payout-1",
      projectId: null,
      projectName: "",
      amount: "$324.92",
      amountCentsUsd: 32492,
      date: null,
      status: "paid",
      rate: null,
      description: null,
      payableActivityIds: ["activity-1"],
      createdAt: null,
    }
  );

  assert.deepEqual(
    normalizePayActivity({
      id: "activity-1",
      projectId: "project-1",
      projectName: "Project One",
      sourceType: "manual",
      amountCentsUsd: 32492,
      hours: 12.5,
      hourlyRateCentsUsd: 2600,
      totalTasks: 4,
      earningType: "task",
    }),
    {
      id: "activity-1",
      projectId: "project-1",
      projectName: "Project One",
      sourceType: "manual",
      earningType: "task",
      taskId: null,
      amountCentsUsd: 32492,
      hours: 12.5,
      hourlyRateCentsUsd: 2600,
      totalTasks: 4,
    }
  );
});

test("normalizes current week pay activity time", () => {
  assert.deepEqual(
    normalizeCurrentWeekPayActivity({
      id: "activity-1",
      taskId: "task-1",
      projectId: "project-1",
      projectName: "Project One",
      timeEarnedSeconds: 5400,
    }),
    {
      id: "activity-1",
      taskId: "task-1",
      projectId: "project-1",
      projectName: "Project One",
      timeEarnedSeconds: 5400,
      hours: 1.5,
    }
  );
});

test("summarizes expected payout for the previous Monday-Sunday window", () => {
  const summary = summarizeExpectedPayout(
    {
      data: [
        {
          amountCentsUsd: 1200,
          payableActivityId: "activity-1",
          payoutId: null,
          voidedAt: null,
          createdAt: "2026-05-18T12:00:00.000Z",
        },
        {
          amountCentsUsd: 3400,
          payableActivityId: "activity-2",
          payoutId: null,
          voidedAt: null,
          createdAt: "2026-05-24T23:59:00.000Z",
        },
        {
          amountCentsUsd: 5000,
          payoutId: null,
          voidedAt: null,
          createdAt: "2026-05-25T00:00:00.000Z",
        },
        {
          amountCentsUsd: 7000,
          payoutId: "paid",
          voidedAt: null,
          createdAt: "2026-05-20T12:00:00.000Z",
        },
      ],
    },
    new Date("2026-05-25T21:00:00.000Z"),
    [
      {
        id: "activity-2",
        projectName: "Project Two",
        hours: 1.25,
        hourlyRateCentsUsd: 5000,
        earningType: "task",
      },
      {
        id: "activity-1",
        projectId: "project-1",
        projectName: "Project One",
        hours: 0.5,
        hourlyRateCentsUsd: 2400,
        earningType: "task",
      },
    ]
  );

  assert.equal(summary.start, "2026-05-18T00:00:00.000Z");
  assert.equal(summary.end, "2026-05-25T00:00:00.000Z");
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.totalCents, 4600);
  assert.deepEqual(summary.incentive, { rowCount: 0, totalCents: 0 });
  assert.deepEqual(summary.hoursTotal, {
    rowCount: 2,
    totalCents: 4600,
    hours: 1.75,
  });
  assert.deepEqual(summary.byDay, [
    { day: "2026-05-18", amountCentsUsd: 1200 },
    { day: "2026-05-24", amountCentsUsd: 3400 },
  ]);
  assert.deepEqual(summary.breakdown, [
    {
      date: "2026-05-18",
      projectId: "project-1",
      projectName: "Project One",
      hours: 0.5,
      hourlyRateCentsUsd: 2400,
      amountCentsUsd: 1200,
      rowCount: 1,
      earningType: "task",
      sourceType: null,
    },
    {
      date: "2026-05-24",
      projectId: null,
      projectName: "Project Two",
      hours: 1.25,
      hourlyRateCentsUsd: 5000,
      amountCentsUsd: 3400,
      rowCount: 1,
      earningType: "task",
      sourceType: null,
    },
  ]);
});

test("summarizes current week payout for unpaid current Monday-Sunday rows", () => {
  const summary = summarizeCurrentWeekPayout(
    {
      data: [
        {
          amountCentsUsd: 7900,
          payableActivityId: "activity-1",
          payoutId: null,
          voidedAt: null,
          createdAt: "2026-05-28T00:41:55.000Z",
        },
        {
          amountCentsUsd: 40000,
          payableActivityId: "activity-2",
          payoutId: "processing",
          voidedAt: null,
          createdAt: "2026-05-28T01:00:00.000Z",
        },
        {
          amountCentsUsd: 5000,
          payableActivityId: "activity-3",
          payoutId: null,
          voidedAt: null,
          createdAt: "2026-05-24T23:59:00.000Z",
        },
      ],
    },
    new Date("2026-05-28T12:00:00.000Z"),
    [
      {
        id: "activity-1",
        projectName: "Example Project",
        hours: 1.58,
        hourlyRateCentsUsd: 5000,
        earningType: "task",
      },
    ]
  );

  assert.equal(summary.start, "2026-05-25T00:00:00.000Z");
  assert.equal(summary.end, "2026-06-01T00:00:00.000Z");
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.totalCents, 7900);
  assert.deepEqual(summary.hoursTotal, {
    rowCount: 1,
    totalCents: 7900,
    hours: 1.58,
  });
});

test("normalizeTask extracts updatedAt from common shapes", () => {
  const { normalizeTask } = require("./platform-api");

  const task = normalizeTask(
    {
      id: "t-1",
      pipelineStage: { name: "Delivered", enteredAt: "2026-05-22T10:00:00Z" },
      data: { task_title: "Hi" },
    },
    { id: "p-1", name: "P" }
  );

  assert.equal(task.updatedAt, "2026-05-22T10:00:00Z");
});



