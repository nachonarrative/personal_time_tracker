const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSegments,
  extractRecords,
  formatDuration,
  mergeRecords,
  summarize,
  toCsv,
  validateImportText,
} = require("./web/time-tracker-core");

const startedResponse = [
  {
    result: {
      data: {
        json: {
          status: "created",
          event: {
            id: "start-1",
            taskId: "task-1",
            pipelineStageId: "stage-1",
            eventName: "started",
            createdBy: "profile-1",
            createdAt: "2026-06-03T17:16:36.000Z",
            annotationProjectId: "project-1",
            taskRevisionId: "revision-1",
          },
        },
      },
    },
  },
];

const pausedResponse = [
  {
    result: {
      data: {
        json: {
          status: "created",
          event: {
            id: "pause-1",
            taskId: "task-1",
            pipelineStageId: "stage-1",
            eventName: "paused",
            createdBy: "profile-1",
            createdAt: "2026-06-03T17:30:42.000Z",
            annotationProjectId: "project-1",
            taskRevisionId: "revision-1",
          },
        },
      },
    },
  },
];

const confirmationPayload = {
  "0": {
    json: {
      taskId: "task-1",
      workerId: "profile-1",
      timeWorkedInSeconds: 846,
    },
  },
};

test("extractRecords finds trainer platform timer events and confirm-time payloads", () => {
  const records = extractRecords(
    [startedResponse, pausedResponse, confirmationPayload],
    "2026-06-03T18:00:00.000Z"
  );

  assert.equal(records.events.length, 2);
  assert.equal(records.confirmations.length, 1);
  assert.equal(records.events[0].eventName, "started");
  assert.equal(records.confirmations[0].timeWorkedInSeconds, 846);
});

test("buildSegments pairs started/resumed events with pauses", () => {
  const records = extractRecords([startedResponse, pausedResponse]);
  const { segments, unmatched } = buildSegments(records.events);

  assert.equal(segments.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(segments[0].seconds, 846);
});

test("summarize calculates confirmed pay and observed delta", () => {
  const records = extractRecords(
    [startedResponse, pausedResponse, confirmationPayload],
    "2026-06-03T18:00:00.000Z"
  );
  const summary = summarize(records, 5000);

  assert.equal(summary.observedSeconds, 846);
  assert.equal(summary.confirmedSeconds, 846);
  assert.equal(summary.deltaSeconds, 0);
  assert.equal(summary.expectedCents, 1175);
  assert.equal(summary.byTask[0].expectedCents, 1175);
});

test("mergeRecords dedupes repeated imports", () => {
  const first = extractRecords([startedResponse, confirmationPayload]);
  const merged = mergeRecords(first, first);

  assert.equal(merged.events.length, 1);
  assert.equal(merged.confirmations.length, 1);
});

test("formatDuration and toCsv produce reviewable evidence output", () => {
  assert.equal(formatDuration(846), "0:14:06");

  const records = extractRecords(
    [startedResponse, pausedResponse, confirmationPayload],
    "2026-06-03T18:00:00.000Z"
  );
  const csv = toCsv(summarize(records, 5000).byTask);

  assert.match(csv, /taskId,eventCount,confirmationCount/);
  assert.match(csv, /task-1,2,1,0:14:06,0:14:06,0:00:00,11.75,11.75/);
});

test("extractRecords rejects non-JSON and sensitive request material", () => {
  assert.throws(
    () => extractRecords("Cookie: session=secret"),
    /cookies, headers, tokens/
  );
  assert.throws(
    () => extractRecords("taskId: task-1"),
    /Paste must be JSON/
  );
  assert.throws(
    () => extractRecords({ hello: "world" }),
    /No timer event or confirmed-time record/
  );
});

test("validateImportText allows JSON and blocks unsafe paste text", () => {
  assert.equal(validateImportText('{"taskId":"task-1"}'), true);
  assert.throws(
    () => validateImportText("Authorization: Bearer secret"),
    /cookies, headers, tokens/
  );
  assert.throws(
    () => validateImportText("not json"),
    /Paste must be JSON/
  );
});




