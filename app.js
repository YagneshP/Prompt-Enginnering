(function () {
  "use strict";

  const STORAGE_KEY = "promptLibrary.v1";

  /** @typedef {{ noteId: string, content: string, updatedAt: string }} Note */
  /** @typedef {{ id: string, title: string, content: string, createdAt: string, rating: number, notes: Note[] }} Prompt */

  /** @type {"all" | "rated" | "unrated" | "high"} */
  let activeFilter = "all";

  /** @type {"newest" | "rating-desc" | "rating-asc"} */
  let activeSort = "newest";

  /** @param {unknown} p */
  function normalizePrompt(p) {
    const rating = Number(/** @type {{ rating?: unknown }} */ (p).rating);
    const rawNotes = /** @type {{ notes?: unknown }} */ (p).notes;
    const notes = Array.isArray(rawNotes)
      ? rawNotes
          .filter(
            (n) =>
              n &&
              typeof n.noteId === "string" &&
              typeof n.content === "string" &&
              typeof n.updatedAt === "string"
          )
          .map((n) => ({
            noteId: n.noteId,
            content: n.content,
            updatedAt: n.updatedAt,
          }))
      : [];
    return {
      .../** @type {Prompt} */ (p),
      rating:
        Number.isInteger(rating) && rating >= 0 && rating <= 5 ? rating : 0,
      notes,
    };
  }

  /** @returns {Prompt[]} */
  function loadPrompts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (p) =>
            p &&
            typeof p.id === "string" &&
            typeof p.title === "string" &&
            typeof p.content === "string"
        )
        .map(normalizePrompt);
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
  const filterEmptyEl = document.getElementById("filter-empty-state");
  const countEl = document.getElementById("prompt-count");
  const ratingSummaryEl = document.getElementById("rating-summary");
  const clearBtn = document.getElementById("clear-form");
  const sortSelect = document.getElementById("sort-select");
  const filterTabs = document.querySelector(".filter-tabs");

  /** @param {Prompt[]} prompts */
  function getVisiblePrompts(prompts) {
    let list = [...prompts];

    if (activeFilter === "rated") list = list.filter((p) => p.rating > 0);
    if (activeFilter === "unrated") list = list.filter((p) => p.rating === 0);
    if (activeFilter === "high") list = list.filter((p) => p.rating >= 4);

    if (activeSort === "rating-desc") {
      list.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return (
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
        );
      });
    } else if (activeSort === "rating-asc") {
      list.sort((a, b) => {
        if (a.rating !== b.rating) return a.rating - b.rating;
        return (
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
        );
      });
    } else {
      list.sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
      );
    }

    return list;
  }

  /** @param {Prompt[]} allPrompts */
  function updateRatingSummary(allPrompts) {
    const rated = allPrompts.filter((p) => p.rating > 0);
    if (rated.length === 0) {
      ratingSummaryEl.hidden = true;
      return;
    }
    const avg =
      rated.reduce((sum, p) => sum + p.rating, 0) / rated.length;
    ratingSummaryEl.textContent = `Average rating: ${avg.toFixed(1)} / 5 (${rated.length} rated)`;
    ratingSummaryEl.hidden = false;
  }

  /** @param {Prompt} prompt */
  function buildStarRating(prompt) {
    const wrap = document.createElement("div");
    wrap.className = "star-rating-wrap";

    const label = document.createElement("span");
    label.className = "star-rating__label";
    label.textContent =
      prompt.rating > 0 ? "Effectiveness" : "Rate effectiveness";

    const group = document.createElement("div");
    group.className = "star-rating";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", `Rate ${prompt.title}`);
    group.dataset.id = prompt.id;

    for (let star = 1; star <= 5; star++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "star-rating__star";
      if (star <= prompt.rating) btn.classList.add("is-filled");
      btn.dataset.action = "rate";
      btn.dataset.id = prompt.id;
      btn.dataset.value = String(star);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(prompt.rating === star));
      btn.setAttribute(
        "aria-label",
        `${star} star${star === 1 ? "" : "s"}`
      );
      btn.textContent = "★";
      group.appendChild(btn);
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "star-rating__clear";
    clear.dataset.action = "rate";
    clear.dataset.id = prompt.id;
    clear.dataset.value = "0";
    clear.textContent = "Clear";
    clear.hidden = prompt.rating === 0;
    clear.setAttribute("aria-label", `Clear rating for ${prompt.title}`);

    wrap.append(label, group, clear);
    return wrap;
  }

  /**
   * @param {Note} note
   * @param {{ isEditing?: boolean, isNew?: boolean }} [options]
   */
  function buildNoteItem(note, options) {
    const isEditing = Boolean(options && options.isEditing);
    const isNew = Boolean(options && options.isNew);
    const noteEl = document.createElement("article");
    noteEl.className = "note-item";
    noteEl.dataset.noteId = note.noteId;
    noteEl.dataset.isNew = String(isNew);
    noteEl.dataset.originalContent = note.content;

    const textarea = document.createElement("textarea");
    textarea.className = "note-item__content";
    textarea.value = note.content;
    textarea.setAttribute("rows", "3");
    textarea.disabled = !isEditing;
    if (!isEditing) {
      textarea.setAttribute("readonly", "true");
    }

    const meta = document.createElement("p");
    meta.className = "note-item__meta";
    meta.textContent = isNew ? "New note" : `Saved ${formatDate(note.updatedAt)}`;

    const actions = document.createElement("div");
    actions.className = "note-item__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn--ghost";
    editBtn.dataset.action = "note-edit";
    editBtn.textContent = "Edit";
    editBtn.hidden = isEditing || isNew;

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--primary";
    saveBtn.dataset.action = "note-save";
    saveBtn.textContent = "Save";
    saveBtn.hidden = !isEditing;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.dataset.action = "note-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.hidden = !isEditing;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--danger";
    deleteBtn.dataset.action = "note-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.hidden = isNew;

    actions.append(editBtn, saveBtn, cancelBtn, deleteBtn);
    noteEl.append(textarea, meta, actions);
    return noteEl;
  }

  /** @param {Prompt} prompt */
  function buildNotesSection(prompt) {
    const section = document.createElement("section");
    section.className = "notes";
    section.dataset.promptId = prompt.id;

    const head = document.createElement("div");
    head.className = "notes__head";

    const title = document.createElement("h4");
    title.className = "notes__title";
    title.textContent = "Notes";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn--ghost";
    addBtn.dataset.action = "note-add";
    addBtn.dataset.id = prompt.id;
    addBtn.textContent = "Add note";

    head.append(title, addBtn);

    const list = document.createElement("div");
    list.className = "notes__list";

    for (const note of prompt.notes) {
      list.appendChild(buildNoteItem(note));
    }

    section.append(head, list);
    return section;
  }

  /** @param {HTMLElement} group @param {number} hoverValue */
  function previewStars(group, hoverValue) {
    const stars = group.querySelectorAll(".star-rating__star");
    stars.forEach((btn, i) => {
      const starNum = i + 1;
      btn.classList.toggle("is-preview", hoverValue > 0 && starNum <= hoverValue);
    });
  }

  /** @param {Prompt[]} allPrompts @param {Prompt[]} visible */
  function render(allPrompts, visible) {
    listEl.innerHTML = "";
    const total = allPrompts.length;
    const shown = visible.length;

    countEl.textContent =
      shown === total
        ? total === 1
          ? "1 saved"
          : `${total} saved`
        : `${shown} of ${total} shown`;

    updateRatingSummary(allPrompts);

    if (total === 0) {
      emptyEl.hidden = false;
      filterEmptyEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;

    if (shown === 0) {
      filterEmptyEl.hidden = false;
      return;
    }

    filterEmptyEl.hidden = true;

    for (const p of visible) {
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
      const dateStr = formatDate(p.createdAt);
      meta.textContent =
        p.rating > 0
          ? `${dateStr} · ${p.rating} star${p.rating === 1 ? "" : "s"}`
          : dateStr;

      left.append(h3, meta);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--danger";
      del.dataset.action = "delete";
      del.dataset.id = p.id;
      del.setAttribute("aria-label", `Delete prompt: ${p.title}`);
      del.textContent = "Delete";

      top.append(left, del);

      const stars = buildStarRating(p);

      const pre = document.createElement("pre");
      pre.className = "prompt-card__body";
      pre.textContent = p.content;

      const notes = buildNotesSection(p);
      li.append(top, stars, pre, notes);
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
    const all = loadPrompts();
    render(all, getVisiblePrompts(all));
  }

  function setRating(promptId, value) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(value))));
    const prompts = loadPrompts().map((p) =>
      p.id === promptId ? { ...p, rating } : p
    );
    savePrompts(prompts);
    refresh();
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
      rating: 0,
        notes: [],
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

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      activeSort = /** @type {typeof activeSort} */ (sortSelect.value);
      refresh();
    });
  }

  if (filterTabs) {
    filterTabs.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("[data-filter]");
      if (!(btn instanceof HTMLButtonElement) || !btn.dataset.filter) return;

      activeFilter = /** @type {typeof activeFilter} */ (btn.dataset.filter);

      filterTabs.querySelectorAll("[data-filter]").forEach((tab) => {
        const isActive = tab === btn;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
      });

      refresh();
    });
  }

  listEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const rateBtn = target.closest('button[data-action="rate"]');
    if (rateBtn instanceof HTMLButtonElement && rateBtn.dataset.id) {
      setRating(rateBtn.dataset.id, rateBtn.dataset.value || "0");
      return;
    }

    const delBtn = target.closest('button[data-action="delete"]');
    if (delBtn instanceof HTMLButtonElement && delBtn.dataset.id) {
      const prompts = loadPrompts().filter((p) => p.id !== delBtn.dataset.id);
      savePrompts(prompts);
      refresh();
      return;
    }

    const noteAddBtn = target.closest('button[data-action="note-add"]');
    if (noteAddBtn instanceof HTMLButtonElement && noteAddBtn.dataset.id) {
      const note = {
        noteId: generateId(),
        content: "",
        updatedAt: new Date().toISOString(),
      };
      const notesSection = noteAddBtn.closest(".notes");
      if (!(notesSection instanceof HTMLElement)) return;
      const notesList = notesSection.querySelector(".notes__list");
      if (!(notesList instanceof HTMLElement)) return;
      const noteEl = buildNoteItem(note, { isEditing: true, isNew: true });
      notesList.appendChild(noteEl);
      const textarea = noteEl.querySelector(".note-item__content");
      if (textarea instanceof HTMLTextAreaElement) textarea.focus();
      return;
    }

    const noteEl = target.closest(".note-item");
    const promptEl = target.closest(".notes");
    if (!(noteEl instanceof HTMLElement) || !(promptEl instanceof HTMLElement)) {
      return;
    }

    const promptId = promptEl.dataset.promptId;
    const noteId = noteEl.dataset.noteId;
    if (!promptId || !noteId) return;

    const textarea = noteEl.querySelector(".note-item__content");
    const editBtn = noteEl.querySelector('button[data-action="note-edit"]');
    const saveBtn = noteEl.querySelector('button[data-action="note-save"]');
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    if (!(editBtn instanceof HTMLButtonElement)) return;
    if (!(saveBtn instanceof HTMLButtonElement)) return;

    if (target.closest('button[data-action="note-edit"]')) {
      textarea.disabled = false;
      textarea.removeAttribute("readonly");
      noteEl.dataset.originalContent = textarea.value;
      editBtn.hidden = true;
      saveBtn.hidden = false;
      const cancelBtn = noteEl.querySelector('button[data-action="note-cancel"]');
      if (cancelBtn instanceof HTMLButtonElement) cancelBtn.hidden = false;
      textarea.focus();
      return;
    }

    if (target.closest('button[data-action="note-save"]')) {
      const now = new Date().toISOString();
      const isNew = noteEl.dataset.isNew === "true";
      const prompts = loadPrompts().map((p) => {
        if (p.id !== promptId) return p;
        if (isNew) {
          return {
            ...p,
            notes: [...p.notes, { noteId, content: textarea.value, updatedAt: now }],
          };
        }
        const notes = p.notes.map((n) =>
          n.noteId === noteId ? { ...n, content: textarea.value, updatedAt: now } : n
        );
        return { ...p, notes };
      });
      savePrompts(prompts);
      refresh();
      return;
    }

    if (target.closest('button[data-action="note-cancel"]')) {
      const isNew = noteEl.dataset.isNew === "true";
      if (isNew) {
        noteEl.remove();
        return;
      }
      textarea.value = noteEl.dataset.originalContent || "";
      textarea.disabled = true;
      textarea.setAttribute("readonly", "true");
      editBtn.hidden = false;
      saveBtn.hidden = true;
      const cancelBtn = noteEl.querySelector('button[data-action="note-cancel"]');
      if (cancelBtn instanceof HTMLButtonElement) cancelBtn.hidden = true;
      return;
    }

    if (target.closest('button[data-action="note-delete"]')) {
      const prompts = loadPrompts().map((p) => {
        if (p.id !== promptId) return p;
        return { ...p, notes: p.notes.filter((n) => n.noteId !== noteId) };
      });
      savePrompts(prompts);
      refresh();
      return;
    }
  });

  listEl.addEventListener("mouseover", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const star = target.closest(".star-rating__star");
    if (!(star instanceof HTMLButtonElement)) return;
    const group = star.closest(".star-rating");
    if (!group) return;
    previewStars(group, Number(star.dataset.value) || 0);
  });

  listEl.addEventListener("mouseout", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const group = target.closest(".star-rating");
    if (!group) return;
    const related = e.relatedTarget;
    if (related instanceof Node && group.contains(related)) return;
    previewStars(group, 0);
  });

  listEl.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains("star-rating__star")) return;

    const group = target.closest(".star-rating");
    if (!group) return;
    const stars = [...group.querySelectorAll(".star-rating__star")];
    const index = stars.indexOf(target);
    if (index < 0) return;

    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      next = Math.min(index + 1, stars.length - 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      next = Math.max(index - 1, 0);
    } else if (e.key >= "1" && e.key <= "5") {
      e.preventDefault();
      const promptId = group.dataset.id;
      if (promptId) setRating(promptId, e.key);
      return;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const promptId = group.dataset.id;
      if (promptId && target.dataset.value) {
        setRating(promptId, target.dataset.value);
      }
      return;
    } else {
      return;
    }

    const nextStar = stars[next];
    if (nextStar instanceof HTMLButtonElement) nextStar.focus();
  });

  refresh();
})();
