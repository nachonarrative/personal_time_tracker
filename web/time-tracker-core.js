(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TimeTrackerCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ACTIVE_EVENTS = new Set(["started", "resumed"]);
  const STOP_EVENTS = new Set(["paused"]);
  const SENSITIVE_PATTERNS = [
    /\bAuthorization\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    /\bCookie\b/i,
    /\bSet-Cookie\b/i,
    /\b_requestHeaders\b/i,
    /\bheaders\b\s*:/i,
    /"headers"\s*:/i,
    /"cookies?"\s*:/i,
    /"authorization"\s*:/i,
    /"accessToken"\s*:/i,
    /"refreshToken"\s*:/i,
    /"idToken"\s*:/i,
    /"session"\s*:/i,
    /"sessionId"\s*:/i,
    /"x-csrf-token"\s*:/i,
    /"xsrf-token"\s*:/i,
    /"_trajectory_session"\s*:/i,
    /\bcsrf\b/i,
    /\btoken\b/i,
    /\bsession\b/i,
    /\bpassword\b/i,
  ];

  function stableString(value) {
    if (!value || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
      .join(",")}}`;
  }

  function makeId(prefix, value) {
    let hash = 0;
    const text = stableString(value);

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }

    return `${prefix}-${hash.toString(16).padStart(8, "0")}`;
  }

  function walk(value, visit) {
    if (!value || typeof value !== "object") return;
    visit(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, visit));
      return;
    }
    Object.values(value).forEach((item) => walk(item, visit));
  }

  function parseJsonLoose(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      throw new Error("Paste JSON before importing.");
    }
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      throw new Error(
        "This looks like it may include cookies, headers, tokens, sessions, or passwords. Copy only the JSON from Preview, Response, or the small Payload object."
      );
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error(
        "Paste must be JSON. It should start with { or [. Do not paste headers, cookies, or plain text."
      );
    }
    return JSON.parse(trimmed);
  }

  function validateImportText(text) {
    parseJsonLoose(text);
    return true;
  }

  function extractRecords(input, importedAt = new Date().toISOString()) {
    const parsed = typeof input === "string" ? parseJsonLoose(input) : input;
    const events = [];
    const confirmations = [];
    const seen = new Set();

    walk(parsed, (node) => {
      if (
        typeof node.taskId === "string" &&
        typeof node.eventName === "string" &&
        typeof node.createdAt === "string"
      ) {
        const event = {
          kind: "event",
          id: node.id || makeId("event", node),
          taskId: node.taskId,
          eventName: node.eventName,
          createdAt: node.createdAt,
          pipelineStageId: node.pipelineStageId || null,
          annotationProjectId: node.annotationProjectId || null,
          taskRevisionId: node.taskRevisionId || null,
          createdBy: node.createdBy || null,
          importedAt,
        };
        const key = `event:${event.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(event);
        }
      }

      if (
        typeof node.taskId === "string" &&
        typeof node.timeWorkedInSeconds === "number" &&
        Number.isFinite(node.timeWorkedInSeconds)
      ) {
        const confirmation = {
          kind: "confirmation",
          id: makeId("confirm", node),
          taskId: node.taskId,
          workerId: node.workerId || node[`${["fel", "low"].join("")}Id`] || null,
          timeWorkedInSeconds: node.timeWorkedInSeconds,
          createdAt: node.createdAt || importedAt,
          importedAt,
        };
        const key = `confirmation:${confirmation.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          confirmations.push(confirmation);
        }
      }
    });

    if (events.length === 0 && confirmations.length === 0) {
      throw new Error(
        "No timer event or confirmed-time record found. Look for JSON with taskId plus eventName/createdAt, or taskId plus timeWorkedInSeconds."
      );
    }

    return { events, confirmations };
  }

  function mergeRecords(existing = { events: [], confirmations: [] }, incoming) {
    const events = [...(existing.events || [])];
    const confirmations = [...(existing.confirmations || [])];
    const eventIds = new Set(events.map((event) => event.id));
    const confirmationIds = new Set(
      confirmations.map((confirmation) => confirmation.id)
    );

    for (const event of incoming.events || []) {
      if (!eventIds.has(event.id)) {
        eventIds.add(event.id);
        events.push(event);
      }
    }

    for (const confirmation of incoming.confirmations || []) {
      if (!confirmationIds.has(confirmation.id)) {
        confirmationIds.add(confirmation.id);
        confirmations.push(confirmation);
      }
    }

    return {
      events: events.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      confirmations: confirmations.sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      ),
    };
  }

  function buildSegments(events = []) {
    const byTask = new Map();

    for (const event of events) {
      if (!byTask.has(event.taskId)) byTask.set(event.taskId, []);
      byTask.get(event.taskId).push(event);
    }

    const segments = [];
    const unmatched = [];

    for (const [taskId, taskEvents] of byTask.entries()) {
      const sorted = [...taskEvents].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
      let active = null;

      for (const event of sorted) {
        if (ACTIVE_EVENTS.has(event.eventName)) {
          if (active) unmatched.push({ taskId, reason: "active_restarted", event: active });
          active = event;
          continue;
        }

        if (STOP_EVENTS.has(event.eventName)) {
          if (!active) {
            unmatched.push({ taskId, reason: "pause_without_start", event });
            continue;
          }

          const startedAt = new Date(active.createdAt);
          const pausedAt = new Date(event.createdAt);
          const seconds = Math.max(0, (pausedAt - startedAt) / 1000);

          segments.push({
            id: makeId("segment", {
              taskId,
              startedAt: active.createdAt,
              pausedAt: event.createdAt,
            }),
            taskId,
            startedEventName: active.eventName,
            startedAt: active.createdAt,
            pausedAt: event.createdAt,
            seconds,
            annotationProjectId:
              active.annotationProjectId || event.annotationProjectId || null,
            taskRevisionId: active.taskRevisionId || event.taskRevisionId || null,
          });
          active = null;
        }
      }

      if (active) unmatched.push({ taskId, reason: "open_active_segment", event: active });
    }

    return { segments, unmatched };
  }

  function summarize(records = { events: [], confirmations: [] }, hourlyRateCents = 5000) {
    const { segments, unmatched } = buildSegments(records.events || []);
    const confirmedSeconds = (records.confirmations || []).reduce(
      (total, item) => total + (item.timeWorkedInSeconds || 0),
      0
    );
    const observedSeconds = segments.reduce((total, item) => total + item.seconds, 0);

    return {
      eventCount: (records.events || []).length,
      confirmationCount: (records.confirmations || []).length,
      segmentCount: segments.length,
      observedSeconds,
      confirmedSeconds,
      deltaSeconds: confirmedSeconds - observedSeconds,
      expectedCents: Math.round((confirmedSeconds / 3600) * hourlyRateCents),
      observedCents: Math.round((observedSeconds / 3600) * hourlyRateCents),
      unmatchedCount: unmatched.length,
      segments,
      unmatched,
      byTask: summarizeByTask(records, segments, hourlyRateCents),
    };
  }

  function summarizeByTask(records, segments, hourlyRateCents) {
    const tasks = new Map();

    function ensure(taskId) {
      if (!tasks.has(taskId)) {
        tasks.set(taskId, {
          taskId,
          observedSeconds: 0,
          confirmedSeconds: 0,
          eventCount: 0,
          confirmationCount: 0,
          expectedCents: 0,
        });
      }
      return tasks.get(taskId);
    }

    for (const event of records.events || []) ensure(event.taskId).eventCount += 1;
    for (const segment of segments) {
      ensure(segment.taskId).observedSeconds += segment.seconds;
    }
    for (const confirmation of records.confirmations || []) {
      const entry = ensure(confirmation.taskId);
      entry.confirmedSeconds += confirmation.timeWorkedInSeconds || 0;
      entry.confirmationCount += 1;
    }
    for (const entry of tasks.values()) {
      entry.expectedCents = Math.round(
        (entry.confirmedSeconds / 3600) * hourlyRateCents
      );
      entry.observedCents = Math.round(
        (entry.observedSeconds / 3600) * hourlyRateCents
      );
      entry.deltaSeconds = entry.confirmedSeconds - entry.observedSeconds;
    }

    return [...tasks.values()].sort((a, b) => b.confirmedSeconds - a.confirmedSeconds);
  }

  function formatDuration(seconds) {
    const whole = Math.round(Number(seconds || 0));
    const sign = whole < 0 ? "-" : "";
    const absolute = Math.abs(whole);
    const hours = Math.floor(absolute / 3600);
    const minutes = Math.floor((absolute % 3600) / 60);
    const secs = absolute % 60;
    return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(
      secs
    ).padStart(2, "0")}`;
  }

  function toCsv(rows) {
    const headers = [
      "taskId",
      "eventCount",
      "confirmationCount",
      "observedTime",
      "confirmedTime",
      "deltaTime",
      "observedPay",
      "confirmedPay",
    ];
    const escapeCell = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.taskId,
          row.eventCount,
          row.confirmationCount,
          formatDuration(row.observedSeconds),
          formatDuration(row.confirmedSeconds),
          formatDuration(row.deltaSeconds),
          (row.observedCents / 100).toFixed(2),
          (row.expectedCents / 100).toFixed(2),
        ]
          .map(escapeCell)
          .join(",")
      ),
    ].join("\n");
  }

  return {
    ACTIVE_EVENTS,
    STOP_EVENTS,
    buildSegments,
    extractRecords,
    formatDuration,
    mergeRecords,
    summarize,
    toCsv,
    validateImportText,
  };
});



