
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Meeting Action Items app is running." });
});

app.post("/api/slack", async (req, res) => {
  const { message, approved } = req.body || {};

  if (approved !== true) {
    return res.status(400).json({
      error: "Please review and approve the recap before posting."
    });
  }

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "A Slack message is required."
    });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    return res.status(503).json({
      error: "Slack is not configured yet. Add a webhook URL to your local .env file."
    });
  }

  try {
    const url = new URL(webhookUrl);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "hooks.slack.com" ||
      !url.pathname.startsWith("/services/")
    ) {
      return res.status(400).json({
        error: "The configured Slack webhook URL is not valid."
      });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.trim() }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "Slack rejected the message. Check the webhook configuration."
      });
    }

    res.json({ success: true, message: "Recap sent to Slack." });
  } catch (error) {
    console.error("Slack posting failed:", error.message);
    res.status(502).json({
      error: "Unable to send the recap. Check your connection and Slack configuration."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Meeting Action Items app running at http://localhost:${PORT}`);
});
