const state = {
  connected: false,
  configuredProject: null,
  loginWindowOpen: false,
  payments: null,
  tracker: { events: [], confirmations: [] },
};

const elements = {
  connectionCard: document.querySelector("#connection-card"),
  connectionTitle: document.querySelector("#connection-title"),
  connectionCopy: document.querySelector("#connection-copy"),
  connectButton: document.querySelector("#connect-button"),
  saveLoginButton: document.querySelector("#save-login-button"),
  logoutButton: document.querySelector("#logout-button"),
  fetchButton: document.querySelector("#fetch-project-button"),
  configuredProjectId: document.querySelector("#configured-project-id"),
  message: document.querySelector("#message"),
  dashboard: document.querySelector("#dashboard"),
  dashboardTitle: document.querySelector("#dashboard-title"),
  generatedAt: document.querySelector("#generated-at"),
  refreshButton: document.querySelector("#refresh-button"),
  expectedSummary: document.querySelector("#expected-summary"),
  incentiveSummary: document.querySelector("#incentive-summary"),
  hoursSummary: document.querySelector("#hours-summary"),
  expectedCount: document.querySelector("#expected-count"),
  expectedTable: document.querySelector("#expected-table"),
  trackerUpdatedAt: document.querySelector("#tracker-updated-at"),
  trackerRate: document.querySelector("#tracker-rate"),
  trackerJson: document.querySelector("#tracker-json"),
  importTrackerButton: document.querySelector("#import-tracker-button"),
  sampleTrackerButton: document.querySelector("#sample-tracker-button"),
  clearTrackerButton: document.querySelector("#clear-tracker-button"),
  exportTrackerButton: document.querySelector("#export-tracker-button"),
  exportTrackerPdfButton: document.querySelector("#export-tracker-pdf-button"),
  trackerObservedSummary: document.querySelector("#tracker-observed-summary"),
  trackerConfirmedSummary: document.querySelector("#tracker-confirmed-summary"),
  trackerDeltaSummary: document.querySelector("#tracker-delta-summary"),
  trackerRowCount: document.querySelector("#tracker-row-count"),
  trackerTable: document.querySelector("#tracker-table"),
};
const TRACKER_STORAGE_KEY = "trainer_time_tracker_records_v1";
const LEGACY_TRACKER_STORAGE_KEYS = [
  `${["h", "a", "i"].join("")}_time_tracker_records_v1`,
  "Trainer_time_tracker_records_v1",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  return body;
}

function showMessage(text, type = "info") {
  elements.message.hidden = false;
  elements.message.textContent = text;
  elements.message.className = `message ${type === "error" ? "error" : ""}`;
}

function clearMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
}

function setBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;

  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function renderConnection(profile) {
  elements.connectionCard.classList.toggle("connected", state.connected);
  elements.connectionTitle.textContent = state.connected
    ? `Signed in${profile?.name ? ` as ${profile.name}` : ""}`
    : "Not signed in";
  elements.connectionCopy.textContent = state.connected
    ? "Ready to fetch your current week payout breakdown."
    : "Open trainer platform login to create a local session.";
  elements.saveLoginButton.disabled = !state.loginWindowOpen;

  if (state.configuredProject && elements.configuredProjectId) {
    elements.configuredProjectId.textContent = state.configuredProject.id || "";
  }
}

function formatMoney(cents) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(Number(cents || 0) / 100);
}

function formatDuration(value) {
  const totalMinutes = Math.round(Number(value || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatRate(cents) {
  if (cents === null || cents === undefined) return "-";
  return `${formatMoney(cents)}/hr`;
}

function formatSeconds(seconds) {
  return TimeTrackerCore.formatDuration(seconds);
}

function formatDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateRange(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "";
  }
  const inclusiveEnd = new Date(endDate);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);

  return `${startDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}-${inclusiveEnd.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

function renderExpectedPayout() {
  const summary = state.payments?.summary || {};
  const expected = summary.currentWeekPayout || summary.expectedPayout;
  const processing = summary.processingPayout;

  if (!expected) {
    elements.expectedSummary.innerHTML = "";
    elements.expectedCount.textContent = "0 rows";
    elements.expectedTable.innerHTML = `
      <tr><td colspan="4" style="padding: 24px; text-align: center; color: var(--muted);">
        No expected payout data returned for this account.
      </td></tr>
    `;
    return;
  }

  const breakdown = expected.breakdown || [];
  const incentive = expected.incentive || { rowCount: 0, totalCents: 0 };
  const hoursTotal = expected.hoursTotal || { rowCount: 0, totalCents: 0, hours: 0 };
  elements.dashboardTitle.textContent = "Current Week Payout";
  elements.generatedAt.textContent = `Updated ${new Date(
    state.payments.generatedAt
  ).toLocaleString()}`;
  elements.expectedCount.textContent = `${breakdown.length} row${
    breakdown.length === 1 ? "" : "s"
  }`;
  elements.expectedSummary.innerHTML = `
    <span class="expected-label">Current week ${escapeHtml(
      formatDateRange(expected.start, expected.end)
    )}</span>
    <strong>${formatMoney(expected.totalCents)}</strong>
    <small>${expected.rowCount} unpaid earning row${
    expected.rowCount === 1 ? "" : "s"
    }${
      processing
        ? `; processing ${escapeHtml(processing.amount)} (${escapeHtml(processing.status)})`
        : ""
    }</small>
  `;
  elements.incentiveSummary.innerHTML = `
    <span class="expected-label">INCENTIVE</span>
    <strong>${formatMoney(incentive.totalCents)}</strong>
    <small>${incentive.rowCount} milestone earning row${
    incentive.rowCount === 1 ? "" : "s"
  }</small>
  `;
  elements.hoursSummary.innerHTML = `
    <span class="expected-label">TOTAL FROM HOURS</span>
    <strong>${formatMoney(hoursTotal.totalCents)}</strong>
    <small>${formatDuration(hoursTotal.hours)} across ${hoursTotal.rowCount} earning row${
    hoursTotal.rowCount === 1 ? "" : "s"
  }</small>
  `;

  elements.expectedTable.innerHTML = breakdown
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(formatDay(row.date))}</td>
          <td>${escapeHtml(row.projectName || "Unassigned")}</td>
          <td class="numeric">${formatDuration(row.hours)}</td>
          <td class="numeric">${formatRate(row.hourlyRateCentsUsd)}</td>
        </tr>
      `
    )
    .join("");
}

function renderDashboard() {
  elements.dashboard.hidden = false;
  renderExpectedPayout();
}

function getHourlyRateCents() {
  const value = Number.parseFloat(elements.trackerRate?.value || "50");
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : 5000;
}

function loadTracker() {
  try {
    for (const key of [TRACKER_STORAGE_KEY, ...LEGACY_TRACKER_STORAGE_KEYS]) {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && Array.isArray(saved.events) && Array.isArray(saved.confirmations)) {
        state.tracker = saved;
        if (key !== TRACKER_STORAGE_KEY) saveTracker();
        return;
      }
    }
  } catch {
    state.tracker = { events: [], confirmations: [] };
  }
}

function saveTracker() {
  localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state.tracker));
}

function renderTracker() {
  if (!elements.trackerTable) return;

  const summary = TimeTrackerCore.summarize(state.tracker, getHourlyRateCents());
  elements.trackerUpdatedAt.textContent = `Saved locally: ${summary.eventCount} events, ${summary.confirmationCount} confirmations`;
  elements.trackerRowCount.textContent = `${summary.byTask.length} task${
    summary.byTask.length === 1 ? "" : "s"
  }`;
  elements.trackerObservedSummary.innerHTML = `
    <span class="expected-label">Observed timer</span>
    <strong>${escapeHtml(formatSeconds(summary.observedSeconds))}</strong>
    <small>${summary.segmentCount} paired timer segment${
    summary.segmentCount === 1 ? "" : "s"
  }</small>
  `;
  elements.trackerConfirmedSummary.innerHTML = `
    <span class="expected-label">Confirmed pay time</span>
    <strong>${escapeHtml(formatSeconds(summary.confirmedSeconds))}</strong>
    <small>${formatMoney(summary.expectedCents)} at ${formatRate(
    getHourlyRateCents()
  )}</small>
  `;
  elements.trackerDeltaSummary.innerHTML = `
    <span class="expected-label">Confirmed - observed</span>
    <strong>${escapeHtml(formatSeconds(summary.deltaSeconds))}</strong>
    <small>${summary.unmatchedCount} unmatched timer event${
    summary.unmatchedCount === 1 ? "" : "s"
  }</small>
  `;

  if (summary.byTask.length === 0) {
    elements.trackerTable.innerHTML = `
      <tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--muted);">
        Paste timer event or confirm-time JSON to start a local ledger.
      </td></tr>
    `;
    return;
  }

  elements.trackerTable.innerHTML = summary.byTask
    .map(
      (row) => `
        <tr>
          <td class="mono">${escapeHtml(row.taskId)}</td>
          <td class="numeric">${row.eventCount} / ${row.confirmationCount}</td>
          <td class="numeric">${escapeHtml(formatSeconds(row.observedSeconds))}</td>
          <td class="numeric">${escapeHtml(formatSeconds(row.confirmedSeconds))}</td>
          <td class="numeric ${Math.abs(row.deltaSeconds) > 1 ? "delta-warning" : ""}">${escapeHtml(
        formatSeconds(row.deltaSeconds)
      )}</td>
          <td class="numeric">${formatMoney(row.expectedCents)}</td>
        </tr>
      `
    )
    .join("");
}

function importTrackerJson() {
  try {
    const incoming = TimeTrackerCore.extractRecords(elements.trackerJson.value);
    state.tracker = TimeTrackerCore.mergeRecords(state.tracker, incoming);
    saveTracker();
    renderTracker();
    showMessage(
      `Imported ${incoming.events.length} timer event(s) and ${incoming.confirmations.length} confirmation(s).`
    );
    elements.trackerJson.value = "";
  } catch (err) {
    showMessage(`Tracker import failed: ${err.message}`, "error");
  }
}

function loadTrackerSample() {
  elements.trackerJson.value = JSON.stringify(
    [
      {
        result: {
          data: {
            json: {
              status: "created",
              event: {
                id: "sample-start",
                taskId: "sample-task",
                pipelineStageId: "sample-stage",
                eventName: "started",
                createdBy: "sample-profile",
                createdAt: "2026-06-03T17:16:36.641Z",
                annotationProjectId: "sample-project",
                taskRevisionId: "sample-revision",
              },
            },
          },
        },
      },
      {
        result: {
          data: {
            json: {
              status: "created",
              event: {
                id: "sample-pause",
                taskId: "sample-task",
                pipelineStageId: "sample-stage",
                eventName: "paused",
                createdBy: "sample-profile",
                createdAt: "2026-06-03T17:30:42.641Z",
                annotationProjectId: "sample-project",
                taskRevisionId: "sample-revision",
              },
            },
          },
        },
      },
      {
        "0": {
          json: {
            taskId: "sample-task",
            workerId: "sample-profile",
            timeWorkedInSeconds: 846,
          },
        },
      },
    ],
    null,
    2
  );
}

function clearTracker() {
  if (!confirm("Clear locally saved timer evidence?")) return;
  state.tracker = { events: [], confirmations: [] };
  saveTracker();
  renderTracker();
  showMessage("Cleared local timer tracker.");
}

function exportTrackerCsv() {
  const summary = TimeTrackerCore.summarize(state.tracker, getHourlyRateCents());
  const csv = TimeTrackerCore.toCsv(summary.byTask);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trainer-time-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildTrackerReportHtml(summary) {
  const rate = formatRate(getHourlyRateCents());
  const generatedAt = new Date().toLocaleString();
  const rows = summary.byTask
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.taskId)}</td>
          <td>${row.eventCount} / ${row.confirmationCount}</td>
          <td>${escapeHtml(formatSeconds(row.observedSeconds))}</td>
          <td>${escapeHtml(formatSeconds(row.confirmedSeconds))}</td>
          <td>${escapeHtml(formatSeconds(row.deltaSeconds))}</td>
          <td>${formatMoney(row.expectedCents)}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Time Tracker Ledger Report</title>
    <style>
      body {
        margin: 32px;
        color: #111;
        font-family: Arial, sans-serif;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 24px;
      }
      .meta {
        margin: 0 0 20px;
        color: #555;
        font-size: 12px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 18px;
      }
      .card {
        padding: 12px;
        border: 2px solid #111;
        border-radius: 6px;
      }
      .label {
        display: block;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .value {
        display: block;
        margin: 4px 0;
        font-size: 22px;
        font-weight: 800;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      th,
      td {
        padding: 8px;
        border: 1px solid #111;
        text-align: left;
      }
      th {
        background: #eee;
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      td:nth-child(n + 2),
      th:nth-child(n + 2) {
        text-align: right;
      }
      .note {
        margin-top: 18px;
        color: #555;
        font-size: 11px;
      }
      @media print {
        body { margin: 18mm; }
        button { display: none; }
      }
    </style>
  </head>
  <body>
    <h1>Independent Time Tracker Ledger</h1>
    <p class="meta">Generated ${escapeHtml(generatedAt)}. Hourly rate used: ${escapeHtml(rate)}.</p>
    <section class="cards">
      <div class="card">
        <span class="label">Observed Timer</span>
        <span class="value">${escapeHtml(formatSeconds(summary.observedSeconds))}</span>
        <small>${summary.segmentCount} paired timer segment${summary.segmentCount === 1 ? "" : "s"}</small>
      </div>
      <div class="card">
        <span class="label">Confirmed Pay Time</span>
        <span class="value">${escapeHtml(formatSeconds(summary.confirmedSeconds))}</span>
        <small>${formatMoney(summary.expectedCents)} confirmed pay estimate</small>
      </div>
      <div class="card">
        <span class="label">Confirmed - Observed</span>
        <span class="value">${escapeHtml(formatSeconds(summary.deltaSeconds))}</span>
        <small>${summary.unmatchedCount} unmatched timer event${summary.unmatchedCount === 1 ? "" : "s"}</small>
      </div>
    </section>
    <table>
      <thead>
        <tr>
          <th>Task ID</th>
          <th>Events</th>
          <th>Observed</th>
          <th>Confirmed</th>
          <th>Delta</th>
          <th>Confirmed Pay</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows ||
          '<tr><td colspan="6" style="text-align:center;">No tracker records imported.</td></tr>'
        }
      </tbody>
    </table>
    <p class="note">
      This report is generated locally from records imported into the tracker.
      It is for personal recordkeeping and does not submit or modify payment data.
    </p>
    <script>
      window.addEventListener("load", () => setTimeout(() => window.print(), 150));
    </script>
  </body>
</html>`;
}

function exportTrackerPdf() {
  const summary = TimeTrackerCore.summarize(state.tracker, getHourlyRateCents());
  const report = buildTrackerReportHtml(summary);
  const blob = new Blob([report], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const reportWindow = window.open(url, "_blank");

  if (!reportWindow) {
    URL.revokeObjectURL(url);
    showMessage("PDF report was blocked by the browser. Allow popups for this local app, then try again.", "error");
    return;
  }

  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showMessage("Opened PDF report. In the print window, choose Save as PDF.");
}

function guardTrackerPaste(event) {
  const text = event.clipboardData?.getData("text") || "";
  try {
    TimeTrackerCore.validateImportText(text);
  } catch (err) {
    event.preventDefault();
    showMessage(`Paste blocked: ${err.message}`, "error");
  }
}

async function loadStatus({ autoFetch = false } = {}) {
  const status = await request("/api/status");
  state.connected = status.connected;
  state.configuredProject = status.configuredProject;
  renderConnection(status.profile);

  if (autoFetch && status.connected) {
    fetchPayments({ silent: true }).catch(() => {});
  }
}

async function startLogin() {
  const done = setBusy(elements.connectButton, "Opening...");
  clearMessage();

  try {
    await request("/api/connect/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.loginWindowOpen = true;
    renderConnection();
    showMessage("trainer platform login window opened. Finish signing in there, then click Save Login.");
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function saveLogin() {
  const done = setBusy(elements.saveLoginButton, "Saving...");

  try {
    const result = await request("/api/connect/save", { method: "POST" });
    state.connected = true;
    state.loginWindowOpen = false;
    renderConnection(result.profile);
    showMessage("Signed in. You can fetch your current week payout now.");
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    done();
  }
}

async function logout() {
  await request("/api/logout", { method: "POST" });
  state.connected = false;
  state.payments = null;
  elements.dashboard.hidden = true;
  renderConnection();
  showMessage("Logged out.");
}

async function fetchPayments({ silent = false } = {}) {
  const restoreFetch = setBusy(elements.fetchButton, "Fetching...");
  const previousRefreshLabel = elements.refreshButton ? elements.refreshButton.innerHTML : null;

  if (elements.refreshButton) {
    elements.refreshButton.disabled = true;
    elements.refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Refreshing...';
  }

  try {
    state.payments = await request("/api/payments", { method: "POST" });
    renderDashboard();
    if (!silent) showMessage("Fetched current week payout breakdown.");
    else clearMessage();
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    restoreFetch();
    if (elements.refreshButton && previousRefreshLabel !== null) {
      elements.refreshButton.disabled = false;
      elements.refreshButton.innerHTML = previousRefreshLabel;
    }
  }
}

elements.connectButton.addEventListener("click", startLogin);
elements.saveLoginButton.addEventListener("click", saveLogin);
elements.logoutButton.addEventListener("click", logout);
elements.fetchButton.addEventListener("click", () => fetchPayments());
if (elements.refreshButton) {
  elements.refreshButton.addEventListener("click", () => fetchPayments());
}
if (elements.importTrackerButton) {
  elements.importTrackerButton.addEventListener("click", importTrackerJson);
  elements.sampleTrackerButton.addEventListener("click", loadTrackerSample);
  elements.clearTrackerButton.addEventListener("click", clearTracker);
  elements.exportTrackerButton.addEventListener("click", exportTrackerCsv);
  elements.exportTrackerPdfButton.addEventListener("click", exportTrackerPdf);
  elements.trackerRate.addEventListener("input", renderTracker);
  elements.trackerJson.addEventListener("paste", guardTrackerPaste);
}

loadTracker();
renderTracker();
loadStatus({ autoFetch: true }).catch((err) => showMessage(err.message, "error"));




