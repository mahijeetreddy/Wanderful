const form = document.querySelector("#planner-form");
const overlay = document.querySelector("#loading-overlay");
const resultSection = document.querySelector("#result-section");
const itinerary = document.querySelector("#itinerary");
const errorBox = document.querySelector("#error-box");
const copyButton = document.querySelector("#copy-button");
const steps = Array.from(document.querySelectorAll(".timeline li"));
const loadingMessage = document.querySelector("#loading-message");

let latestMarkdown = "";
let stepTimer = null;
let messageTimer = null;
const loadingMessages = [
  "Checking budget constraints and trip shape.",
  "Searching flights, hotels, weather, and local context.",
  "Coordinating specialist agents into one itinerary.",
  "Finalizing the Markdown travel plan.",
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(markdown) {
  const lines = escapeHtml(markdown).split("\n");
  const html = [];
  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${line.slice(4)}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${line.slice(2)}</h1>`);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
    } else {
      closeList();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  closeList();
  return html.join("");
}

function inlineMarkdown(line) {
  return line
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

function setBusy(isBusy) {
  overlay.hidden = !isBusy;
  form.querySelector("button[type='submit']").disabled = isBusy;

  if (!isBusy) {
    clearInterval(stepTimer);
    clearInterval(messageTimer);
    stepTimer = null;
    messageTimer = null;
    return;
  }

  steps.forEach((step) => step.classList.remove("active", "done"));
  loadingMessage.textContent = loadingMessages[0];
  let index = 0;
  let messageIndex = 0;
  steps[index].classList.add("active");
  stepTimer = setInterval(() => {
    steps[index]?.classList.remove("active");
    steps[index]?.classList.add("done");
    index = Math.min(index + 1, steps.length - 1);
    steps[index]?.classList.add("active");
  }, 4500);
  messageTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % loadingMessages.length;
    loadingMessage.textContent = loadingMessages[messageIndex];
  }, 7000);
}

function formPayload() {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultSection.hidden = true;
  errorBox.hidden = true;
  itinerary.innerHTML = "";
  setBusy(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 390000);

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formPayload()),
      signal: controller.signal,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Planner request failed.");
    }

    latestMarkdown = payload.itinerary || "";
    itinerary.innerHTML = renderMarkdown(latestMarkdown);
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    errorBox.textContent =
      error.name === "AbortError"
        ? "The planner timed out in the browser after 6.5 minutes. Check the server logs, API keys, and provider quotas, then try again."
        : error.message;
    errorBox.hidden = false;
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    clearTimeout(timeout);
    steps.forEach((step) => step.classList.remove("active"));
    steps.forEach((step) => step.classList.add("done"));
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!latestMarkdown) {
    return;
  }
  await navigator.clipboard.writeText(latestMarkdown);
  const original = copyButton.textContent;
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = original;
  }, 1400);
});
