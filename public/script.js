// public/script.js — UI wiring: review, sign-off, send now or schedule.
// Extraction lives in public/extract.js (loaded first) as window.Recap.extractActions.

const el = (id) => document.getElementById(id);

const transcriptInput = el("transcript");
const extractBtn = el("extractBtn");
const addBtn = el("addBtn");
const previewBtn = el("previewBtn");
const postBtn = el("postBtn");
const copyBtn = el("copyBtn");
const actionItemsContainer = el("actionItems");
const slackPreview = el("slackPreview");
const statusMessage = el("status");
const meetingTitle = el("meetingTitle");
const approver = el("approver");
const nowBtn = el("nowBtn");
const laterBtn = el("laterBtn");
const whenWrap = el("whenWrap");
const sendAt = el("sendAt");
const scheduleHint = document.getElementById("scheduleHint");
const queueBox = el("queue");

let actionItems = [];
let sendMode = "now"; // "now" | "later"
let busy = false;
let postedOnce = false;

/* ---------------- theme ---------------- */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeLabel").textContent = theme === "dark" ? "Light" : "Dark";
  try { localStorage.setItem("recap-theme", theme); } catch (e) {}
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("recap-theme"); } catch (e) {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

document.getElementById("themeBtn").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ---------------- helpers ---------------- */

function setStatus(text, isError) {
  statusMessage.textContent = text;
  statusMessage.className = isError ? "error" : "";
}

function titleText() {
  return meetingTitle.value.trim() || "Meeting Action Items";
}

function approverName() {
  return approver.value.trim();
}

function buildMessage() {
  if (!actionItems.length) return "";

  const lines = actionItems.map((item, index) => {
    const task = item.task.trim() || "(Task description needed)";
    const owner = item.owner.trim() || "Unassigned";
    const deadline = item.deadline.trim() || "No deadline";
    return `${index + 1}. ${task}\n   Owner: ${owner}\n   Deadline: ${deadline}`;
  });

  const who = approverName();
  const stamp = new Date().toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric"
  });
  const signoff = who ? `_Approved by ${who} · ${stamp}_` : `_Not yet approved · ${stamp}_`;

  return `*${titleText()}*\n${signoff}\n\n${lines.join("\n\n")}`;
}

function updatePreview() {
  slackPreview.textContent = buildMessage() || "Nothing to preview yet.";
  refreshPostState();
}

function refreshPostState() {
  const hasItems = actionItems.some((item) => item.task.trim());
  const signedOff = approverName().length > 1;
  const scheduledOk = sendMode === "now" || Boolean(sendAt.value);

  postBtn.disabled = busy || !hasItems || !signedOff || !scheduledOk || postedOnce;
  postBtn.textContent = postedOnce
    ? "Sent ✓"
    : busy
      ? "Working…"
      : sendMode === "now"
        ? "Post to Slack"
        : "Schedule recap";
}

/* ---------------- review list ---------------- */

function renderItems() {
  actionItemsContainer.replaceChildren();

  if (!actionItems.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No action items yet. Paste a transcript and extract, or add one by hand.";
    actionItemsContainer.appendChild(empty);
    updatePreview();
    return;
  }

  actionItems.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "action-item";

    [
      { key: "task", label: "Task description" },
      { key: "owner", label: "Owner" },
      { key: "deadline", label: "Deadline" }
    ].forEach((field) => {
      const label = document.createElement("label");
      label.textContent = field.label;

      const input = document.createElement("input");
      input.type = "text";
      input.value = item[field.key] || "";
      input.setAttribute("aria-label", `${field.label}, task ${index + 1}`);
      input.addEventListener("input", () => {
        actionItems[index][field.key] = input.value;
        if (postedOnce) { postedOnce = false; setStatus("Task changed — send again to update the channel."); }
        updatePreview();
      });

      label.appendChild(input);
      card.appendChild(label);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      actionItems.splice(index, 1);
      postedOnce = false;
      renderItems();
      setStatus("Task removed.");
    });
    card.appendChild(remove);

    actionItemsContainer.appendChild(card);
  });

  updatePreview();
}

/* ---------------- extract / add ---------------- */

extractBtn.addEventListener("click", () => {
  const transcript = transcriptInput.value.trim();
  if (!transcript) {
    setStatus("Paste a meeting transcript first.", true);
    return;
  }

  actionItems = window.Recap.extractActions(transcript);
  postedOnce = false;
  renderItems();

  setStatus(
    actionItems.length
      ? `Found ${actionItems.length} action item${actionItems.length === 1 ? "" : "s"} — review them below.`
      : "No likely action items found. Add tasks manually if you need to.",
    !actionItems.length
  );
});

addBtn.addEventListener("click", () => {
  actionItems.push({ task: "", owner: "Unassigned", deadline: "No deadline" });
  postedOnce = false;
  renderItems();
  setStatus("New task added. Fill in the details.");
});

previewBtn.addEventListener("click", () => {
  updatePreview();
  setStatus("Preview refreshed.");
});

meetingTitle.addEventListener("input", updatePreview);
approver.addEventListener("input", updatePreview);
sendAt.addEventListener("input", refreshPostState);

/* ---------------- send timing ---------------- */

function setSendMode(mode) {
  sendMode = mode;
  nowBtn.setAttribute("aria-pressed", String(mode === "now"));
  laterBtn.setAttribute("aria-pressed", String(mode === "later"));
  whenWrap.hidden = mode !== "later";
  scheduleHint.hidden = mode !== "later";
  if (mode === "later" && !sendAt.value) {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    sendAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  }
  postedOnce = false;
  refreshPostState();
}

nowBtn.addEventListener("click", () => setSendMode("now"));
laterBtn.addEventListener("click", () => setSendMode("later"));

/* ---------------- posting ---------------- */

postBtn.addEventListener("click", async () => {
  if (busy) return;

  const message = buildMessage();
  if (!message) { setStatus("Add at least one task before sending.", true); return; }
  if (!approverName()) { setStatus("Add the name of the person approving this recap.", true); return; }

  busy = true;
  refreshPostState();

  const scheduling = sendMode === "later";
  const endpoint = scheduling ? "/api/schedule" : "/api/slack";
  const body = { message, approved: true, approver: approverName(), title: titleText() };
  if (scheduling) body.sendAt = new Date(sendAt.value).toISOString();

  setStatus(scheduling ? "Scheduling the recap…" : "Posting the recap to Slack…");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(data.error || `Request failed (${response.status}).`, true);
      return;
    }

    postedOnce = !scheduling;
    setStatus(
      scheduling
        ? `Scheduled for ${new Date(body.sendAt).toLocaleString()}.`
        : data.message || "Recap sent to Slack."
    );
    if (scheduling) loadQueue();
  } catch (error) {
    setStatus("Could not reach the server. Is it running on port 3000?", true);
  } finally {
    busy = false;
    refreshPostState();
  }
});

copyBtn.addEventListener("click", async () => {
  const message = buildMessage();
  if (!message) { setStatus("There is nothing to copy yet.", true); return; }
  try {
    await navigator.clipboard.writeText(message);
    setStatus("Recap copied — paste it into Slack.");
  } catch (error) {
    setStatus("Copy failed. Select the preview text manually.", true);
  }
});

/* ---------------- scheduled queue ---------------- */

async function loadQueue() {
  try {
    const response = await fetch("/api/schedule");
    if (!response.ok) return;
    const { jobs } = await response.json();
    queueBox.replaceChildren();

    if (!jobs || !jobs.length) return;

    jobs.forEach((job) => {
      const row = document.createElement("div");
      row.className = "queue-item";
      const when = new Date(job.sendAt).toLocaleString();
      row.innerHTML = `<span>Queued for <strong>${when}</strong></span><span>${job.state}</span>`;
      queueBox.appendChild(row);
    });
  } catch (error) {
    /* queue is a nicety; ignore failures */
  }
}

/* ---------------- boot ---------------- */

initTheme();
setSendMode("now");
renderItems();
loadQueue();
