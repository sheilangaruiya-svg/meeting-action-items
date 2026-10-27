require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000; // one week
const HISTORY_FILE = path.join(__dirname, "history.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- slack ---------------- */

function getWebhook() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.trim() || /PASTE-REAL-URL/i.test(webhookUrl)) {
    return { error: "Slack is not configured yet. Add a webhook URL to your local .env file." };
  }

  let url;
  try {
    url = new URL(webhookUrl.trim());
  } catch (e) {
    return { error: "The configured Slack webhook URL is not valid." };
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.slack.com" ||
    !url.pathname.startsWith("/services/")
  ) {
    return { error: "The configured Slack webhook URL is not valid." };
  }

  return { url: webhookUrl.trim() };
}

async function sendToSlack(message) {
  const hook = getWebhook();
  if (hook.error) return { ok: false, code: 503, error: hook.error };

  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.trim() }),
      signal: AbortSignal.timeout(10000)
    });

    const body = (await response.text()).trim();

    if (!response.ok) {
      console.error("Slack rejected the post:", response.status, body);
      return {
        ok: false,
        code: 502,
        error:
          "Slack rejected the message (" +
          response.status +
          ": " +
          (body || "no detail") +
          "). Check the webhook configuration."
      };
    }

    // Slack answers "ok" with 200. Anything else is worth showing.
    console.log("Slack accepted the post:", response.status, body || "ok");
    return { ok: true, slackReply: body || "ok" };
  } catch (error) {
    console.error("Slack posting failed:", error.message);
    return {
      ok: false,
      code: 502,
      error: "Unable to send the recap. Check your connection and Slack configuration."
    };
  }
}

/* ---------------- history ---------------- */

function readHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(list) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, 50), null, 2));
  } catch (e) {
    console.error("Could not save history:", e.message);
  }
}

function countTasks(message) {
  return String(message || "")
    .split("\n")
    .filter((line) => /^\s*\d+\.\s/.test(line)).length;
}

function countOwners(message) {
  const owners = new Set();
  for (const m of String(message || "").matchAll(/Owner:\s*(.+)/g)) {
    const o = m[1].trim();
    if (o && o.toLowerCase() !== "unassigned") owners.add(o);
  }
  return owners.size;
}

function recordRecap(entry) {
  const list = readHistory();
  list.unshift(entry);
  writeHistory(list);
}

/* ---------------- routes ---------------- */

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Meeting Action Items app is running.",
    slack: getWebhook().error ? "not configured" : "configured"
  });
});

app.post("/api/slack", async (req, res) => {
  const { message, approved, approver, title } = req.body || {};

  if (approved !== true) {
    return res.status(400).json({ error: "Please review and approve the recap before posting." });
  }

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "A Slack message is required." });
  }

  const result = await sendToSlack(message);

  if (!result.ok) {
    recordRecap({
      id: "try_" + Date.now(),
      at: new Date().toISOString(),
      state: "failed",
      error: result.error,
      approver: typeof approver === "string" ? approver.trim() : "",
      title: typeof title === "string" ? title.trim() : "",
      tasks: countTasks(message),
      owners: countOwners(message),
      preview: message.trim().split("\n").slice(0, 2).join(" ")
    });
    return res.status(result.code).json({ error: result.error });
  }

  const entry = {
    id: "recap_" + Date.now(),
    at: new Date().toISOString(),
    state: "sent",
    approver: typeof approver === "string" ? approver.trim() : "",
    title: typeof title === "string" ? title.trim() : "",
    tasks: countTasks(message),
    owners: countOwners(message),
    slackReply: result.slackReply,
    message: message.trim()
  };
  recordRecap(entry);

  res.json({ success: true, message: "Recap sent to Slack.", recap: entry });
});

app.get("/api/slack/test", async (req, res) => {
  const result = await sendToSlack(
    "*Meeting Action Items* \u2014 test post.\nIf you can read this in the channel, the webhook works."
  );
  if (!result.ok) return res.status(result.code).json({ error: result.error });
  res.json({
    success: true,
    message: "Test message posted. Look at the channel your webhook is attached to.",
    slackReply: result.slackReply
  });
});

app.get("/api/history", (req, res) => {
  res.json({ items: readHistory() });
});

app.delete("/api/history", (req, res) => {
  writeHistory([]);
  res.json({ success: true });
});

/* ---------------- scheduled sending ---------------- */

// In-memory queue: simple and honest. Lost on restart, by design.
const jobs = new Map();

function scheduleJob(job) {
  const delay = new Date(job.sendAt).getTime() - Date.now();
  const timer = setTimeout(async () => {
    const result = await sendToSlack(job.message);
    job.state = result.ok ? "sent" : "failed";
    job.error = result.ok ? undefined : result.error;
    job.sentAt = new Date().toISOString();
    jobs.set(job.id, job);

    if (result.ok) {
      recordRecap({
        id: job.id,
        at: job.sentAt,
        state: "sent",
        scheduledFor: job.sendAt,
        approver: job.approver,
        title: job.title,
        tasks: countTasks(job.message),
        owners: countOwners(job.message),
        slackReply: result.slackReply,
        message: job.message.trim()
      });
    } else {
      console.error("Scheduled recap failed:", job.error);
      recordRecap({
        id: job.id,
        at: job.sentAt,
        state: "failed",
        scheduledFor: job.sendAt,
        approver: job.approver,
        title: job.title,
        tasks: countTasks(job.message),
        error: job.error,
        preview: job.message.trim().split("\n").slice(0, 2).join(" ")
      });
    }
  }, Math.max(0, Math.min(delay, MAX_DELAY_MS)));

  job.timer = timer;
  jobs.set(job.id, job);
}

app.post("/api/schedule", (req, res) => {
  const { message, approved, sendAt, approver, title } = req.body || {};

  if (approved !== true) {
    return res.status(400).json({ error: "Please review and approve the recap before scheduling." });
  }

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "A Slack message is required." });
  }

  if (typeof sendAt !== "string") {
    return res.status(400).json({ error: "A send time is required." });
  }

  const when = new Date(sendAt);
  if (Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: "That send time is not a valid date." });
  }

  const delay = when.getTime() - Date.now();
  if (delay < 0) {
    return res.status(400).json({ error: "That send time is in the past. Pick a time in the future." });
  }
  if (delay > MAX_DELAY_MS) {
    return res.status(400).json({ error: "Schedules can be at most one week ahead." });
  }

  const hook = getWebhook();
  if (hook.error) {
    return res.status(503).json({ error: hook.error });
  }

  const job = {
    id: "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    sendAt: when.toISOString(),
    message,
    approver: typeof approver === "string" ? approver.trim() : "",
    title: typeof title === "string" ? title.trim() : "",
    state: "queued",
    createdAt: new Date().toISOString()
  };

  scheduleJob(job);

  res.json({
    success: true,
    message: "Recap scheduled.",
    job: { id: job.id, sendAt: job.sendAt, state: job.state }
  });
});

app.get("/api/schedule", (req, res) => {
  const all = [...jobs.values()]
    .sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt))
    .slice(0, 20)
    .map((job) => ({
      id: job.id,
      sendAt: job.sendAt,
      state: job.state,
      approver: job.approver,
      title: job.title
    }));

  res.json({ jobs: all });
});

app.delete("/api/schedule/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "No such scheduled recap." });
  if (job.timer) clearTimeout(job.timer);
  jobs.delete(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Meeting Action Items app running at http://localhost:${PORT}`);
});
