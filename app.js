(function () {
  "use strict";

  const STORAGE_KEY = "promptLibrary.v1";

  /** @typedef {{ id: string, title: string, content: string, createdAt: string }} Prompt */

  /** @returns {Prompt[]} */
  function loadPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.title === "string" &&
          typeof p.content === "string"
      );
    } catch {
      return [];
    }
  }

  /** @param {Prompt[]} prompts */
  function savePrompts(prompts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  }

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 11);
  }

  const form = document.getElementById("prompt-form");
  const titleInput = document.getElementById("prompt-title");
  const contentInput = document.getElementById("prompt-content");
  const listEl = document.getElementById("prompt-list");
  const emptyEl = document.getElementById("empty-state");
  const countEl = document.getElementById("prompt-count");
  const clearBtn = document.getElementById("clear-form");

  /** @param {Prompt[]} prompts */
  function render(prompts) {
    listEl.innerHTML = "";
    const n = prompts.length;
    countEl.textContent = n === 1 ? "1 saved" : `${n} saved`;

    if (n === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const sorted = [...prompts].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });

    for (const p of sorted) {
      const li = document.createElement("li");
      li.className = "prompt-card";
      li.setAttribute("role", "listitem");

      const top = document.createElement("div");
      top.className = "prompt-card__top";

      const left = document.createElement("div");
      const h3 = document.createElement("h3");
      h3.className = "prompt-card__title";
      h3.textContent = p.title;

      const meta = document.createElement("p");
      meta.className = "prompt-card__meta";
      meta.textContent = formatDate(p.createdAt);

      left.append(h3, meta);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--danger";
      del.setAttribute("aria-label", `Delete prompt: ${p.title}`);
      del.dataset.id = p.id;
      del.textContent = "Delete";

      top.append(left, del);

      const pre = document.createElement("pre");
      pre.className = "prompt-card__body";
      pre.textContent = p.content;

      li.append(top, pre);
      listEl.appendChild(li);
    }
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function refresh() {
    render(loadPrompts());
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      if (!title) titleInput.focus();
      else contentInput.focus();
      return;
    }

    /** @type {Prompt} */
    const prompt = {
      id: generateId(),
      title,
      content,
      createdAt: new Date().toISOString(),
    };

    const prompts = loadPrompts();
    prompts.push(prompt);
    savePrompts(prompts);
    form.reset();
    titleInput.focus();
    refresh();
  });

  clearBtn.addEventListener("click", () => {
    titleInput.focus();
  });

  listEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest("button[data-id]");
    if (!btn || !btn.dataset.id) return;

    const id = btn.dataset.id;
    const prompts = loadPrompts().filter((p) => p.id !== id);
    savePrompts(prompts);
    refresh();
  });

  refresh();
})();
