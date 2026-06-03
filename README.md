# Trainer Time Tracker

A local web app for keeping an independent record of trainer platform work time,
confirmed payable seconds, incentives, and payout totals.

The app runs on your own laptop. It is meant for personal recordkeeping: helping
workers compare their own notes, timer evidence, and payout rows without asking
anyone to share passwords, cookies, account access, or private account data.

## Disclaimer

This project is independent and unofficial. It is not affiliated with, endorsed
by, sponsored by, or approved by any trainer platform or related company.

This tool does not submit work, alter payment data, bypass access controls,
avoid login requirements, or modify any trainer platform system. It is a local
recordkeeping aid for people who want to maintain their own work-time and payout
notes.

Users are responsible for complying with any agreements, platform rules,
workplace policies, and laws that apply to their own accounts and work. Do not
use this tool to access another person's account or data.

## What It Tracks

- Current-week payout rows returned by trainer platform.
- Incentive rows, hourly rows, and total-from-hours cards.
- Raw timer events from `task.createTimeTrackingEvent`.
- Confirmed payable seconds from `task.confirmTimeAndEmitPayActivity`.
- Per-task observed time, confirmed time, delta, and expected pay.
- CSV exports for your own records.

## Privacy And Safety

This is a local tool. There is no hosted backend, no shared database, and no
cloud sync.

The independent time tracker stores imported records in your browser's
`localStorage`. That means the tracker data stays on your machine unless you
choose to export it or share it.

For the timer tracker, paste only response or payload JSON that belongs to your
own account. Do not paste request headers, cookies, bearer tokens, session
values, passwords, or anything from an auth tab.

Trainer platform login state, if used for the payout dashboard, is saved locally in an
`auth.json` file on your machine. That file is gitignored and should never be
committed, uploaded, sent to someone else, or included in a screenshot.

This project does not intentionally collect telemetry, analytics, or personal
data. It does not send your tracker entries to the project maintainer.

## What Not To Share

Before opening an issue, posting a screenshot, sending a CSV, or publishing a
fork, remove anything you do not want public.

Do not share:

- `auth.json`
- cookies
- request headers
- bearer tokens
- session IDs
- passwords
- private project links
- personal payout details you do not want public
- copied payloads that include personal IDs you do not want public

Safe screenshots usually show only totals, task IDs you are comfortable sharing,
and the app interface without browser request headers.

## Requirements

- Node.js 18 or newer
- Git
- Chromium installed by Playwright

## How Someone Uses This From GitHub

This app runs on the person's own computer. They do not need VS Code.

1. Open the GitHub repo page.
2. Click the green **Code** button.
3. Copy the HTTPS link.
4. Install **Node.js** and **Git** if they do not already have them.
5. Open PowerShell on Windows, or Terminal on macOS.
6. Run:

```bash
git clone https://github.com/YOUR_USERNAME/trainer-time-tracker.git
cd trainer-time-tracker
npm install
npx playwright install chromium
npm start
```

7. Open <http://localhost:4173> in a browser.

After setup, daily use is shorter:

```bash
cd trainer-time-tracker
npm start
```

Then open <http://localhost:4173>. The data they import into the independent
time tracker is saved locally in that browser. They should export CSV/PDF files
or take screenshots regularly if they want a backup outside the browser.

## First-Time Setup

```bash
git clone https://github.com/YOUR_USERNAME/trainer-time-tracker.git
cd trainer-time-tracker
npm install
npx playwright install chromium
npm start
```

Open <http://localhost:4173>.

If port `4173` is already busy:

```bash
PORT=5050 npm start
```

Then open <http://localhost:5050>.

## Daily Use

```bash
cd trainer-time-tracker
npm start
```

Open <http://localhost:4173>. Press `Ctrl + C` in the terminal when you want to
stop the app.

## Payout Dashboard

1. Click **Open trainer platform login**.
2. Sign in normally in the Chromium window.
3. Return to the local app and click **Save Login**.
4. Click **Fetch Current Week Payout**.

The dashboard shows the current unpaid week, incentive total, total from hours,
and the date/project/hour/rate breakdown returned for your account.

## Independent Time Tracker

Use this when you want a separate evidence trail for timer events and confirmed
pay time.

The app includes a **Start Here** guide above the paste box. It walks beginners
through each click with simple browser-tool visuals.

Important: open browser tools before you start working or before you change the
task timer. The timer JSON only appears when the trainer task timer sends a
request, such as `started`, `resumed`, or `paused`. If the timer was already
running before the **Network** tab was open and recording, the earlier timer
event may not be visible. Keep **Preserve log** on, then start, pause, or resume
the timer while browser tools are open.

### Very Short Version

1. Open trainer platform in Chrome or Edge.
2. Press `F12`, or press `Ctrl` + `Shift` + `I`.
3. Click **Network**.
4. Turn on **Preserve log**.
5. Keep browser tools open while the trainer task timer is running.
6. Search for `task.createTimeTrackingEvent`.
7. Start, resume, or pause a task so the timer request appears.
8. Click that request and copy the JSON from **Preview** or **Response**.
9. Paste it into the tracker and click **Import JSON**.
10. Search for `task.confirmTimeAndEmitPayActivity`.
11. Copy the payload JSON that includes `timeWorkedInSeconds`.
12. Paste it into the tracker and click **Import JSON** again.

Safe to paste:

- `taskId`
- `eventName`
- `createdAt`
- `timeWorkedInSeconds`
- response JSON or payload JSON

Safe timer event example:

```json
{
  "taskId": "example-task-id-123",
  "eventName": "started",
  "createdAt": "2026-06-03T17:16:36.641Z"
}
```

Safe confirmed-time example:

```json
{
  "taskId": "example-task-id-123",
  "workerId": "example-worker-id-456",
  "timeWorkedInSeconds": 846
}
```

Never paste:

- cookies
- request headers
- passwords
- bearer tokens
- anything named `Authorization`

The paste box blocks obvious non-JSON or sensitive-looking text before it lands
in the field. The import button also rejects anything that is not JSON, does not
include timer/pay fields, or looks like it contains cookies, headers, tokens,
sessions, or passwords.

The tracker calculates:

- **Observed timer**: paired `started` or `resumed` events through `paused`
  events.
- **Confirmed pay time**: seconds sent to the pay confirmation endpoint.
- **Confirmed - observed**: the difference between what the timer evidence shows
  and what was confirmed for pay.

Click **Save CSV** to download a task-level record as a spreadsheet-friendly
file.

Click **Export PDF** to open a printable ledger report. When your browser's
print window opens, choose **Save as PDF** to keep a local PDF copy.

## Example Confirm-Time Payload

```json
{
  "0": {
    "json": {
      "taskId": "example-task-id-123",
      "workerId": "example-worker-id-456",
      "timeWorkedInSeconds": 846
    }
  }
}
```

At `$50/hr`, `846` seconds is about `$11.75`.

## Project Layout

```text
server.js                 Local Node.js HTTP server
platform-api.js          Trainer platform API calls using your local session
dashboard-core.js         Dashboard helpers
web/app.js                Browser UI
web/time-tracker-core.js  Independent timer parser and math
web/styles.css            YSK-themed styling
scripts/                  Data generation helpers
```

## Tests

```bash
npm test
```

## Sharing On GitHub

This repository is safest to share as an open-source, local-first tool. Keep the
language factual and boring: personal recordkeeping, local audit trail, payout
math, and worker notes.

Recommended public framing:

- "Local time and payout recordkeeping for workers."
- "Independent, unofficial, and not affiliated with trainer platform."
- "No credential collection. No hosted backend. No shared database."
- "Users are responsible for following their own agreements and policies."

Avoid public wording that implies attacking, bypassing, scraping at scale, or
accessing data that does not belong to the user.

Before publishing, make sure these files are not committed:

- `auth.json`
- `config.json`
- any copied DevTools payloads containing personal IDs you do not want public

The `.gitignore` already excludes the local auth/config files.

## Maintainer Notes

This project should stay local-first and privacy-first.

Please do not add features that:

- collect other workers' data
- upload tracker entries to a hosted service by default
- ask users to share passwords, cookies, headers, or tokens
- impersonate trainer platform or present this as an official tool
- bypass access controls or automate actions a user could not do in their own
  logged-in browser

If hosted or team-sharing features are added in the future, they should require
clear opt-in consent, explain exactly what data is sent, and avoid collecting
credentials or session material.

## Important Note

This tool does not change trainer platform data and does not submit anything for
payment. It gives workers a local, auditable ledger so they can compare what
they observed, what was confirmed, and what later appears in the payout
dashboard.




