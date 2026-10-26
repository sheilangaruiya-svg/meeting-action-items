
const transcriptInput = document.getElementById("transcript");
const extractBtn = document.getElementById("extractBtn");
const addBtn = document.getElementById("addBtn");
const previewBtn = document.getElementById("previewBtn");
const postBtn = document.getElementById("postBtn");
const actionItemsContainer = document.getElementById("actionItems");
const slackPreview = document.getElementById("slackPreview");
const statusMessage = document.getElementById("status");

let actionItems = [];

const TASK_WORDS =
  /\b(will|i'll|must|need to|needs to|please|responsible for|follow up|send|create|update|review|finish|complete|prepare|schedule|confirm|check|deliver|submit|assign|fix|finish|approve|organize|draft|share|provide|make|call|email|contact|book|coordinate|ensure|investigate|resolve|look into)\b/i;

const NAME = "[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)*(?:\\s+[A-Z][a-z]+)*";

function splitTranscript(transcript) {
  // Preserve speaker labels and split transcript lines into sentences.
  return transcript
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap(line => {
      const trimmed = line.trim();
      if (!trimmed) return [];

      // Keep "Name: text" together as one speaker turn.
      const match = trimmed.match(new RegExp("^(" + NAME + ")\\s*:\\s*(.*)$"));

      if (match) {
        const speaker = match[1];
        const content = match[2];

        return content
          .split(/(?<=[.!?])\s+(?=[A-Z])/)
          .map(part => part.trim())
          .filter(Boolean)
          .map(part => `${speaker}: ${part}`);
      }

      return trimmed
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map(part => part.trim())
        .filter(Boolean);
    });
}

function getSpeaker(sentence) {
  const match = sentence.match(new RegExp("^(" + NAME + ")\\s*:\\s*"));
  return match ? match[1] : "";
}

function getContent(sentence) {
  return sentence.replace(new RegExp("^" + NAME + "\\s*:\\s*"), "").trim();
}

function getOwner(sentence) {
  const speaker = getSpeaker(sentence);
  const content = getContent(sentence);

  // "Sarah: I'll do it" means Sarah owns the task.
  if (/^(i'll|i will|i need to|i must|let me)\b/i.test(content)) {
    return speaker || "Unassigned";
  }

  // "Sarah: James, can you send it?" means James owns the task.
  const requested = content.match(
    new RegExp("^(" + NAME + ")\\s*,?\\s+(?:can you|could you|would you|please|will you|need to|needs to|must)\\b", "i")
  );

  if (requested) return requested[1];

  // "Sarah: James will send it."
  const namedCommitment = content.match(
    new RegExp("\\b(" + NAME + ")\\s+(?:will|needs to|must|is responsible for)\\b")
  );

  if (namedCommitment) return namedCommitment[1];

  // "Sarah: Please send the report."
  // The speaker is the likely owner only when making a commitment
  // or stating their own task, not when giving an ambiguous instruction.
  if (
    speaker &&
    /^(i will|i'll|i need to|i must|let me)\b/i.test(content)
  ) {
    return speaker;
  }

  return "Unassigned";
}

function getDeadline(sentence) {
  const text = getContent(sentence);

  const patterns = [
    /\b(?:by|before|due(?:\s+on)?)\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:AM|PM))?|tomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM))?|today|next week|end of (?:day|week)|the next meeting|the first week of November|\d{1,2}(?:st|nd|rd|th)?\s+of\s+[A-Za-z]+|[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM))?/i,
    /\b(?:by|before)\s+EOD\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return "No deadline";
}

function cleanTask(sentence) {
  let task = getContent(sentence);

  // Remove a person's name when the speaker is assigning the task.
  task = task.replace(
    new RegExp("^" + NAME + "\\s*,?\\s+(?=(?:can you|could you|would you|please|will you|needs to|need to|must)\\b)", "i"),
    ""
  );

  task = task
    .replace(/^(?:i'll|i will|i need to|i must|let me)\s+/i, "")
    .replace(/^(?:please|can you|could you|would you|will you)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return task || getContent(sentence);
}

function normalizeTask(task) {
  return task
    .toLowerCase()
    .replace(/\b(i'll|i will|please|can you|could you|would you|will you)\b/g, "")
    .replace(/\b(by|before|due)\s+.*$/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractActions(transcript) {
  const sentences = splitTranscript(transcript);
  const extracted = [];

  for (const sentence of sentences) {
    if (!TASK_WORDS.test(sentence)) continue;

    const content = getContent(sentence);

    // Skip a question that only requests an action when no clear task
    // can be identified. The review screen allows manual additions.
    if (
      /\bshould probably\b/i.test(content) ||
      /\bmaybe we should\b/i.test(content)
    ) {
      continue;
    }

    const task = cleanTask(sentence);
    const owner = getOwner(sentence);
    const deadline = getDeadline(sentence);
    const normalized = normalizeTask(task);

    if (!normalized) continue;

    // Collapse a request and its acceptance when they describe the same
    // task and have the same identifiable owner.
    const duplicate = extracted.find(item =>
      normalizeTask(item.task) === normalized &&
      item.owner === owner
    );

    if (duplicate) {
      if (
        duplicate.deadline === "No deadline" &&
        deadline !== "No deadline"
      ) {
        duplicate.deadline = deadline;
      }
      continue;
    }

    extracted.push({ task, owner, deadline });
  }

  return extracted;
}

function updatePreview() {
  const lines = actionItems
    .map((item, index) => {
      const task = item.task.trim() || "(Task description needed)";
      const owner = item.owner.trim() || "Unassigned";
      const deadline = item.deadline.trim() || "No deadline";

      return `${index + 1}. ${task}\n   Owner: ${owner}\n   Deadline: ${deadline}`;
    });

  slackPreview.textContent = lines.length
    ? `*Meeting Action Items*\n\n${lines.join("\n\n")}`
    : "Your approved recap will appear here.";
}

function renderItems() {
  actionItemsContainer.replaceChildren();

  if (actionItems.length === 0) {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent =
      "No action items yet. Paste a transcript and extract tasks, or add one manually.";
    actionItemsContainer.appendChild(message);
    updatePreview();
    return;
  }

  actionItems.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "action-item";

    const fields = [
      { key: "task", label: "Task description" },
      { key: "owner", label: "Owner" },
      { key: "deadline", label: "Deadline" }
    ];

    fields.forEach(field => {
      const label = document.createElement("label");
      label.textContent = field.label;

      const input = document.createElement("input");
      input.type = "text";
      input.value = item[field.key] || "";
      input.setAttribute(
        "aria-label",
        `${field.label}, task ${index + 1}`
      );

      input.addEventListener("input", () => {
        actionItems[index][field.key] = input.value;
        updatePreview();
      });

      label.appendChild(input);
      card.appendChild(label);
    });

    const removeButton = document.createElement("button");
    removeButton.className = "secondary";
    removeButton.type = "button";
    removeButton.textContent = "Remove task";

    removeButton.addEventListener("click", () => {
      actionItems.splice(index, 1);
      renderItems();
      statusMessage.textContent = "Task removed.";
    });

    card.appendChild(removeButton);
    actionItemsContainer.appendChild(card);
  });

  updatePreview();
}

extractBtn.addEventListener("click", () => {
  const transcript = transcriptInput.value.trim();

  if (!transcript) {
    statusMessage.textContent =
      "Please paste a meeting transcript first.";
    return;
  }

  actionItems = extractActions(transcript);
  renderItems();

  statusMessage.textContent = actionItems.length
    ? `Found ${actionItems.length} possible action item(s). Please review them.`
    : "No likely action items found. You can add tasks manually.";

  postBtn.disabled = true;
});

addBtn.addEventListener("click", () => {
  actionItems.push({
    task: "",
    owner: "Unassigned",
    deadline: "No deadline"
  });

  renderItems();
  statusMessage.textContent = "New task added. Fill in its details.";
  postBtn.disabled = true;
});

previewBtn.addEventListener("click", () => {
  updatePreview();
  statusMessage.textContent =
    "Preview updated. Review the items before sharing.";
});

// Posting stays disabled until the Slack backend is configured.
postBtn.disabled = true;

// Show the initial empty state when the page loads.
renderItems();
