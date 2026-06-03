const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const platformApi = require("./platform-api");

const DEFAULT_PORT = Number(process.env.PORT || 4173);
const SESSION_COOKIE = "trainer_session";
const WEB_DIR = path.join(__dirname, "web");
const CONFIG_PATH = path.join(__dirname, "config.json");
const AUTH_PATH = path.join(__dirname, "auth.json");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const SESSION_SWEEP_MS = 60 * 60 * 1000;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      })
  );
}

function createSessionId() {
  return crypto.randomBytes(24).toString("base64url");
}

function loadAuthFromDisk() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const raw = fs.readFileSync(AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.cookies)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveAuthToDisk(authState) {
  try {
    fs.writeFileSync(AUTH_PATH, JSON.stringify(authState, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    console.warn(`[auth] failed to persist auth.json: ${err.message}`);
  }
}

function deleteAuthFromDisk() {
  try {
    if (fs.existsSync(AUTH_PATH)) fs.unlinkSync(AUTH_PATH);
  } catch (err) {
    console.warn(`[auth] failed to delete auth.json: ${err.message}`);
  }
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 200_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function createLoginManager() {
  const flows = new Map();

  async function start(sessionId, startUrl) {
    const existing = flows.get(sessionId);

    if (existing) {
      await existing.browser.close().catch(() => {});
      flows.delete(sessionId);
    }

    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      throw new Error(
        "Browser popup login is only available when running locally with Playwright installed. Run: npm install playwright && npx playwright install chromium"
      );
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    const url = startUrl || getConfiguredProject().projectUrl;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    flows.set(sessionId, { browser, context });

    return { opened: true };
  }

  async function save(sessionId) {
    const flow = flows.get(sessionId);

    if (!flow) {
      throw new Error("No active login window. Click 'Open trainer platform login' first.");
    }

    const storageState = await flow.context.storageState();
    await flow.browser.close().catch(() => {});
    flows.delete(sessionId);

    return storageState;
  }

  async function cancel(sessionId) {
    const flow = flows.get(sessionId);

    if (flow) {
      await flow.browser.close().catch(() => {});
      flows.delete(sessionId);
    }
  }

  return { start, save, cancel };
}

function createSessionStore() {
  const store = new Map();

  function get(id) {
    const entry = store.get(id);
    if (!entry) return null;
    if (Date.now() - entry.lastSeen > SESSION_IDLE_MS) {
      store.delete(id);
      return null;
    }
    entry.lastSeen = Date.now();
    return entry;
  }

  function ensure(id) {
    let entry = store.get(id);
    if (!entry) {
      entry = { authState: null, lastSeen: Date.now() };
      store.set(id, entry);
    } else {
      entry.lastSeen = Date.now();
    }
    return entry;
  }

  function setAuth(id, authState) {
    const entry = ensure(id);
    entry.authState = authState;
    entry.lastSeen = Date.now();
  }

  function clear(id) {
    store.delete(id);
  }

  function sweep() {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.lastSeen > SESSION_IDLE_MS) {
        store.delete(id);
      }
    }
  }

  return { get, ensure, setAuth, clear, sweep, size: () => store.size };
}

function buildSessionCookie(sessionId) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  return parts.join("; ");
}

function buildLogoutCookie() {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  return parts.join("; ");
}

function ensureSession(req, res, sessions) {
  const cookies = parseCookies(req.headers.cookie);
  let sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) {
    sessionId = createSessionId();
    res.setHeader("Set-Cookie", buildSessionCookie(sessionId));
  }

  sessions.ensure(sessionId);
  return sessionId;
}

function createLoginManager() {
  const flows = new Map();

  async function start(sessionId, startUrl) {
    const existing = flows.get(sessionId);

    if (existing) {
      await existing.browser.close().catch(() => {});
      flows.delete(sessionId);
    }

    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      throw new Error(
        "Playwright is not installed. Run: npm install && npx playwright install chromium"
      );
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    const url = startUrl || getConfiguredProject().projectUrl;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    flows.set(sessionId, { browser, context });

    return { opened: true };
  }

  async function save(sessionId) {
    const flow = flows.get(sessionId);

    if (!flow) {
      throw new Error("No active trainer platform login window. Click Open trainer platform login first.");
    }

    const authState = await flow.context.storageState();
    await flow.browser.close().catch(() => {});
    flows.delete(sessionId);

    return authState;
  }

  async function cancel(sessionId) {
    const flow = flows.get(sessionId);

    if (flow) {
      await flow.browser.close().catch(() => {});
      flows.delete(sessionId);
    }
  }

  return { start, save, cancel };
}

function getConfiguredProject() {
  const workerRoute = ["fel", "low"].join("");
  const fallbackUrl =
    `https://training-platform.example/${workerRoute}/projects/past/00000000-0000-4000-8000-000000000000`;
  let projectUrl = fallbackUrl;

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      projectUrl = config.projectTasksUrl || fallbackUrl;
    } catch {
      projectUrl = fallbackUrl;
    }
  }

  return {
    id: platformApi.normalizeProjectInput(projectUrl).projectId,
    name: "Configured Project",
    projectUrl,
  };
}

function serveStatic(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = path.resolve(WEB_DIR, relativePath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  res.writeHead(200, {
    "Content-Type":
      MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function createAppServer(options = {}) {
  const api = options.api || platformApi;
  const sessions = options.sessions || createSessionStore();
  const loginManager = options.loginManager || createLoginManager();

  const sweepInterval = setInterval(() => {
    sessions.sweep();
  }, SESSION_SWEEP_MS);
  sweepInterval.unref?.();

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const url = new URL(req.url, "http://localhost");
    const sessionId = ensureSession(req, res, sessions);

    try {
      if (req.method === "GET" && url.pathname === "/api/status") {
        let session = sessions.get(sessionId);
        const configuredProject = getConfiguredProject();

        if (!session?.authState) {
          const persisted = loadAuthFromDisk();
          if (persisted) {
            sessions.setAuth(sessionId, persisted);
            session = sessions.get(sessionId);
          }
        }

        if (!session?.authState) {
          sendJson(res, 200, { connected: false, configuredProject });
          return;
        }

        try {
          const profile = await api.fetchProfile(session.authState);
          sendJson(res, 200, {
            connected: true,
            configuredProject,
            profile: { name: profile.name || profile.fullName || "trainer" },
          });
        } catch {
          sessions.clear(sessionId);
          deleteAuthFromDisk();
          sendJson(res, 200, { connected: false, configuredProject });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/start") {
        const body = await readRequestBody(req);
        const result = await loginManager.start(
          sessionId,
          body.startUrl || getConfiguredProject().projectUrl
        );
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/save") {
        const storageState = await loginManager.save(sessionId);

        let profile;
        try {
          profile = await api.fetchProfile(storageState);
        } catch {
          sendJson(res, 401, {
            error: "Login window closed but platform auth failed. Try again.",
          });
          return;
        }

        sessions.setAuth(sessionId, storageState);
        saveAuthToDisk(storageState);
        sendJson(res, 200, {
          connected: true,
          profile: { name: profile.name || profile.fullName || "trainer" },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/connect/cancel") {
        await loginManager.cancel(sessionId);
        sendJson(res, 200, { cancelled: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/logout") {
        await loginManager.cancel(sessionId);
        sessions.clear(sessionId);
        deleteAuthFromDisk();
        res.setHeader("Set-Cookie", buildLogoutCookie());
        sendJson(res, 200, { connected: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/dashboard") {
        let session = sessions.get(sessionId);

        if (!session?.authState) {
          const persisted = loadAuthFromDisk();
          if (persisted) {
            sessions.setAuth(sessionId, persisted);
            session = sessions.get(sessionId);
          }
        }

        if (!session?.authState) {
          sendJson(res, 401, { error: "Sign in first." });
          return;
        }

        const body = await readRequestBody(req);
        const configuredProject = getConfiguredProject();

        try {
          const dashboard =
            body.mode === "all"
              ? await api.fetchDashboardForAllProjects(session.authState)
              : await api.fetchDashboardForProject(
                  body.projectInput || configuredProject.projectUrl,
                  session.authState,
                  {
                    project: { id: configuredProject.id, name: configuredProject.name },
                  }
                );

          sendJson(res, 200, dashboard);
        } catch (err) {
          if (/expired|401|403/i.test(err.message)) {
            sessions.clear(sessionId);
            deleteAuthFromDisk();
            sendJson(res, 401, { error: "platform session expired. Sign in again." });
            return;
          }
          throw err;
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/payments") {
        let session = sessions.get(sessionId);

        if (!session?.authState) {
          const persisted = loadAuthFromDisk();
          if (persisted) {
            sessions.setAuth(sessionId, persisted);
            session = sessions.get(sessionId);
          }
        }

        if (!session?.authState) {
          sendJson(res, 401, { error: "Sign in first." });
          return;
        }

        try {
          const payments = await api.fetchPaymentsDashboard(session.authState);
          sendJson(res, 200, payments);
        } catch (err) {
          if (/expired|401|403/i.test(err.message)) {
            sessions.clear(sessionId);
            deleteAuthFromDisk();
            sendJson(res, 401, { error: "platform session expired. Sign in again." });
            return;
          }
          throw err;
        }
        return;
      }

      if (req.method === "GET" && serveStatic(req, res)) {
        return;
      }

      sendJson(res, 404, { error: "Not found." });
    } catch (err) {
      const message = err?.message || "Server error.";
      console.error(`[${req.method} ${url.pathname}] ${message}`);
      sendJson(res, 500, { error: message });
    }
  });

  server.on("close", () => clearInterval(sweepInterval));
  return server;
}

if (require.main === module) {
  const server = createAppServer();

  server.listen(DEFAULT_PORT, () => {
    console.log(
      `Trainer Time Tracker running at http://localhost:${DEFAULT_PORT} (${
        IS_PRODUCTION ? "production" : "development"
      } mode)`
    );
  });
}

module.exports = {
  createAppServer,
  createSessionId,
  createSessionStore,
  getConfiguredProject,
  parseCookies,
};



