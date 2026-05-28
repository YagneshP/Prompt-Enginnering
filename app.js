(function () {
  "use strict";

  const STORAGE_KEY = "promptLibrary.v1";
  const BACKUP_STORAGE_KEY = "promptLibrary.v1.import-backup";
  const EXPORT_VERSION = 1;
  const SUPPORTED_IMPORT_VERSIONS = [1];

  /** @typedef {{ noteId: string, content: string, updatedAt: string }} Note */
  /** @typedef {{ min: number, max: number, confidence: "high" | "medium" | "low" }} TokenEstimate */
  /** @typedef {{ model: string, createdAt: string, updatedAt: string, tokenEstimate: TokenEstimate }} MetadataObject */
  /** @typedef {{ id: string, title: string, content: string, createdAt: string, rating: number, notes: Note[], metadata: MetadataObject }} Prompt */

  /** @type {"all" | "rated" | "unrated" | "high"} */
  let activeFilter = "all";
  /** @type {"newest" | "rating-desc" | "rating-asc"} */
  let activeSort = "newest";

  function isISO8601(value) {
    if (typeof value !== "string") return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) && d.toISOString() === value;
  }

  /**
   * @param {string} text
   * @param {boolean} isCode
   * @returns {TokenEstimate}
   */
  function estimateTokens(text, isCode) {
    if (typeof text !== "string") throw new Error("Text must be a string.");
    const trimmed = text.trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
    const charCount = text.length;
    let min = 0.75 * wordCount;
    let max = 0.25 * charCount;
    if (isCode) {
      min *= 1.3;
      max *= 1.3;
    }
    min = Number(min.toFixed(2));
    max = Number(max.toFixed(2));
    const basis = Math.max(min, max);
    const confidence = basis < 1000 ? "high" : basis <= 5000 ? "medium" : "low";
    return { min, max, confidence };
  }

  /**
   * @param {string} modelName
   * @param {string} content
   * @param {boolean} [isCode]
   * @returns {MetadataObject}
   */
  function trackModel(modelName, content, isCode) {
    if (typeof modelName !== "string" || !modelName.trim()) {
      throw new Error("Model name must be a non-empty string.");
    }
    const model = modelName.trim();
    if (model.length > 100) {
      throw new Error("Model name must be at most 100 characters.");
    }
    if (typeof content !== "string") {
      throw new Error("Content must be a string.");
    }
    const now = new Date().toISOString();
    if (!isISO8601(now)) throw new Error("Failed to generate ISO 8601 timestamp.");
    return {
      model,
      createdAt: now,
      updatedAt: now,
      tokenEstimate: estimateTokens(content, Boolean(isCode)),
    };
  }

  /**
   * @param {MetadataObject} metadata
   * @param {string} [override]
   * @returns {MetadataObject}
   */
  function updateTimestamps(metadata, override) {
    if (!metadata || typeof metadata !== "object") {
      throw new Error("Metadata object is required.");
    }
    if (!isISO8601(metadata.createdAt)) {
      throw new Error("createdAt must be a valid ISO 8601 string.");
    }
    const updatedAt = override || new Date().toISOString();
    if (!isISO8601(updatedAt)) {
      throw new Error("updatedAt must be a valid ISO 8601 string.");
    }
    if (new Date(updatedAt).getTime() < new Date(metadata.createdAt).getTime()) {
      throw new Error("updatedAt must be greater than or equal to createdAt.");
    }
    return { ...metadata, updatedAt };
  }

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
          .map((n) => ({ noteId: n.noteId, content: n.content, updatedAt: n.updatedAt }))
      : [];

    const content = String(/** @type {{ content?: unknown }} */ (p).content || "");
    const metadataRaw = /** @type {{ metadata?: MetadataObject }} */ (p).metadata;
    let metadata;
    try {
      metadata = metadataRaw
        ? updateTimestamps(metadataRaw, metadataRaw.updatedAt)
        : trackModel("legacy-import", content, false);
    } catch {
      metadata = trackModel("legacy-import", content, false);
    }

    return {
      .../** @type {Prompt} */ (p),
      createdAt: metadata.createdAt,
      rating: Number.isInteger(rating) && rating >= 0 && rating <= 5 ? rating : 0,
      notes,
      metadata,
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
        .filter((p) => p && typeof p.id === "string" && typeof p.title === "string" && typeof p.content === "string")
        .map(normalizePrompt);
    } catch {
      return [];
    }
  }

  /** @param {Prompt[]} prompts */
  function savePrompts(prompts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  }

  /** @param {unknown} note */
  function isValidNote(note) {
    return (
      note &&
      typeof note === "object" &&
      typeof /** @type {{ noteId?: unknown }} */ (note).noteId === "string" &&
      typeof /** @type {{ content?: unknown }} */ (note).content === "string" &&
      typeof /** @type {{ updatedAt?: unknown }} */ (note).updatedAt === "string" &&
      isISO8601(/** @type {{ updatedAt: string }} */ (note).updatedAt)
    );
  }

  /** @param {unknown} estimate */
  function isValidTokenEstimate(estimate) {
    if (!estimate || typeof estimate !== "object") return false;
    const e = /** @type {{ min?: unknown; max?: unknown; confidence?: unknown }} */ (estimate);
    return (
      typeof e.min === "number" &&
      !Number.isNaN(e.min) &&
      typeof e.max === "number" &&
      !Number.isNaN(e.max) &&
      (e.confidence === "high" || e.confidence === "medium" || e.confidence === "low")
    );
  }

  /** @param {unknown} metadata */
  function isValidMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") return false;
    const m = /** @type {{ model?: unknown; createdAt?: unknown; updatedAt?: unknown; tokenEstimate?: unknown }} */ (metadata);
    return (
      typeof m.model === "string" &&
      m.model.trim().length > 0 &&
      m.model.length <= 100 &&
      typeof m.createdAt === "string" &&
      isISO8601(m.createdAt) &&
      typeof m.updatedAt === "string" &&
      isISO8601(m.updatedAt) &&
      new Date(m.updatedAt).getTime() >= new Date(m.createdAt).getTime() &&
      isValidTokenEstimate(m.tokenEstimate)
    );
  }

  /**
   * @param {unknown} p
   * @param {number} [index]
   * @returns {string[]}
   */
  function validatePromptIntegrity(p, index) {
    const prefix = typeof index === "number" ? `Prompt #${index + 1}: ` : "";
    const errors = [];
    if (!p || typeof p !== "object") return [`${prefix}must be an object.`];
    const prompt = /** @type {Record<string, unknown>} */ (p);
    if (typeof prompt.id !== "string" || !prompt.id.trim()) errors.push(`${prefix}missing or invalid id.`);
    if (typeof prompt.title !== "string" || !prompt.title.trim()) errors.push(`${prefix}missing or invalid title.`);
    if (typeof prompt.content !== "string") errors.push(`${prefix}content must be a string.`);
    if (typeof prompt.createdAt !== "string" || !isISO8601(prompt.createdAt)) {
      errors.push(`${prefix}createdAt must be a valid ISO 8601 string.`);
    }
    const rating = Number(prompt.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      errors.push(`${prefix}rating must be an integer from 0 to 5.`);
    }
    if (!Array.isArray(prompt.notes)) {
      errors.push(`${prefix}notes must be an array.`);
    } else {
      prompt.notes.forEach((note, noteIndex) => {
        if (!isValidNote(note)) errors.push(`${prefix}note #${noteIndex + 1} is invalid.`);
      });
    }
    if (!isValidMetadata(prompt.metadata)) errors.push(`${prefix}metadata is invalid or incomplete.`);
    return errors;
  }

  /** @param {Prompt[]} prompts */
  function computeExportStatistics(prompts) {
    const totalPrompts = prompts.length;
    const rated = prompts.filter((p) => p.rating > 0);
    const averageRating =
      rated.length === 0 ? 0 : Number((rated.reduce((sum, p) => sum + p.rating, 0) / rated.length).toFixed(2));
    /** @type {Record<string, number>} */
    const modelCounts = {};
    for (const p of prompts) {
      const model = p.metadata.model.trim() || "unknown";
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    }
    let mostUsedModel = null;
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedModel = model;
      }
    }
    return { totalPrompts, averageRating, mostUsedModel };
  }

  /**
   * @param {Prompt[]} prompts
   * @returns {{ version: number, exportedAt: string, statistics: ReturnType<typeof computeExportStatistics>, prompts: Prompt[] }}
   */
  function buildExportPayload(prompts) {
    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      statistics: computeExportStatistics(prompts),
      prompts,
    };
  }

  /** @param {string} filename @param {string} json */
  function downloadJsonFile(filename, json) {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function formatExportTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
  }

  function exportPromptLibrary() {
    const prompts = loadPrompts();
    /** @type {string[]} */
    const errors = [];
    prompts.forEach((p, index) => errors.push(...validatePromptIntegrity(p, index)));
    if (errors.length > 0) {
      throw new Error(`Export aborted — data integrity check failed:\n\n${errors.slice(0, 8).join("\n")}${errors.length > 8 ? `\n…and ${errors.length - 8} more.` : ""}`);
    }
    const payload = buildExportPayload(prompts);
    const json = JSON.stringify(payload, null, 2);
    const filename = `prompt-library-export-${formatExportTimestamp(new Date())}.json`;
    downloadJsonFile(filename, json);
    return { filename, count: prompts.length };
  }

  function backupCurrentData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      localStorage.removeItem(BACKUP_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      BACKUP_STORAGE_KEY,
      JSON.stringify({ backedUpAt: new Date().toISOString(), data: raw })
    );
  }

  function restoreFromBackup() {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) return false;
    try {
      const backup = JSON.parse(raw);
      if (backup && typeof backup.data === "string") {
        localStorage.setItem(STORAGE_KEY, backup.data);
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }

  function clearImportBackup() {
    localStorage.removeItem(BACKUP_STORAGE_KEY);
  }

  /**
   * @param {unknown} data
   * @returns {{ ok: true, prompts: Prompt[] } | { ok: false, errors: string[] }}
   */
  function validateImportPayload(data) {
    /** @type {string[]} */
    const errors = [];
    if (!data || typeof data !== "object") return { ok: false, errors: ["File must contain a JSON object."] };
    const payload = /** @type {Record<string, unknown>} */ (data);
    const version = Number(payload.version);
    if (!Number.isInteger(version)) errors.push("Missing or invalid version field.");
    else if (!SUPPORTED_IMPORT_VERSIONS.includes(version)) {
      errors.push(`Unsupported export version ${version}. Supported: ${SUPPORTED_IMPORT_VERSIONS.join(", ")}.`);
    }
    if (typeof payload.exportedAt !== "string" || !isISO8601(payload.exportedAt)) {
      errors.push("Missing or invalid exportedAt timestamp.");
    }
    if (!payload.statistics || typeof payload.statistics !== "object") {
      errors.push("Missing statistics object.");
    }
    if (!Array.isArray(payload.prompts)) {
      errors.push("Missing or invalid prompts array.");
      return { ok: false, errors };
    }
    if (payload.prompts.length === 0) errors.push("Import file contains no prompts.");
    /** @type {Set<string>} */
    const seenIds = new Set();
    payload.prompts.forEach((p, index) => {
      errors.push(...validatePromptIntegrity(p, index));
      const id = p && typeof p === "object" ? String(/** @type {{ id?: unknown }} */ (p).id || "") : "";
      if (id) {
        if (seenIds.has(id)) errors.push(`Duplicate id in import file: "${id}".`);
        seenIds.add(id);
      }
    });
    if (errors.length > 0) return { ok: false, errors };
    /** @type {Prompt[]} */
    const prompts = [];
    for (let index = 0; index < payload.prompts.length; index++) {
      try {
        prompts.push(normalizePrompt(payload.prompts[index]));
      } catch {
        errors.push(`Prompt #${index + 1}: failed to normalize.`);
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, prompts };
  }

  /**
   * @param {Prompt[]} imported
   * @param {Prompt[]} existing
   */
  function findDuplicateIds(imported, existing) {
    const existingIds = new Set(existing.map((p) => p.id));
    return imported.filter((p) => existingIds.has(p.id)).map((p) => p.id);
  }

  /** @typedef {"replace" | "merge-skip" | "merge-overwrite" | "merge-keep-both"} ImportStrategy */

  /**
   * @param {Prompt[]} imported
   * @param {Prompt[]} existing
   * @param {ImportStrategy} strategy
   * @returns {Prompt[]}
   */
  function applyImportStrategy(imported, existing, strategy) {
    if (strategy === "replace") return imported.map((p) => normalizePrompt(p));
    if (strategy === "merge-skip") {
      const existingIds = new Set(existing.map((p) => p.id));
      return [...existing, ...imported.filter((p) => !existingIds.has(p.id)).map((p) => normalizePrompt(p))];
    }
    if (strategy === "merge-overwrite") {
      const byId = new Map(existing.map((p) => [p.id, p]));
      for (const p of imported) byId.set(p.id, normalizePrompt(p));
      return [...byId.values()];
    }
    if (strategy === "merge-keep-both") {
      const existingIds = new Set(existing.map((p) => p.id));
      const merged = [...existing];
      for (const p of imported) {
        if (existingIds.has(p.id)) {
          const copy = { ...normalizePrompt(p), id: generateId() };
          merged.push(copy);
        } else {
          merged.push(normalizePrompt(p));
        }
      }
      return merged;
    }
    throw new Error(`Unknown import strategy: ${strategy}`);
  }

  /**
   * @param {Prompt[]} importedPrompts
   * @param {ImportStrategy} strategy
   */
  function importPromptLibrary(importedPrompts, strategy) {
    backupCurrentData();
    try {
      const existing = loadPrompts();
      const merged = applyImportStrategy(importedPrompts, existing, strategy);
      merged.forEach((p, index) => {
        const issues = validatePromptIntegrity(p, index);
        if (issues.length > 0) throw new Error(`Post-merge validation failed:\n${issues.join("\n")}`);
      });
      savePrompts(merged);
      clearImportBackup();
      return { imported: importedPrompts.length, total: merged.length, skipped: importedPrompts.length - findDuplicateIds(importedPrompts, existing).length };
    } catch (error) {
      const restored = restoreFromBackup();
      if (!restored) localStorage.removeItem(STORAGE_KEY);
      throw new Error(
        `${error instanceof Error ? error.message : "Import failed."}${restored ? " Your previous library was restored from the automatic backup." : " Could not restore backup — local data may be empty."}`
      );
    }
  }

  /**
   * @param {Prompt[]} imported
   * @param {string[]} duplicateIds
   * @returns {Promise<ImportStrategy | null>}
   */
  function promptImportStrategy(imported, duplicateIds) {
    const existing = loadPrompts();
    const importCount = imported.length;
    const existingCount = existing.length;
    const dupCount = duplicateIds.length;

    if (existingCount === 0) return Promise.resolve("replace");

    if (dupCount === 0) {
      const merge = window.confirm(
        `Import ${importCount} prompt${importCount === 1 ? "" : "s"}?\n\n` +
          `Your library has ${existingCount} prompt${existingCount === 1 ? "" : "s"} with no ID conflicts. ` +
          `Choose OK to merge (add imported prompts), or Cancel to abort.`
      );
      return Promise.resolve(merge ? "merge-skip" : null);
    }

    const choice = window.prompt(
      `Import conflict: ${dupCount} prompt${dupCount === 1 ? "" : "s"} share IDs with your library (${existingCount} saved, ${importCount} in file).\n\n` +
        `Type one option:\n` +
        `  replace — replace entire library with import\n` +
        `  skip — merge; keep local copies for conflicts\n` +
        `  overwrite — merge; imported copies win for conflicts\n` +
        `  keep-both — merge; duplicates get new IDs\n` +
        `  cancel — abort import`,
      "skip"
    );
    if (choice === null) return Promise.resolve(null);
    const normalized = choice.trim().toLowerCase();
    if (normalized === "cancel" || normalized === "") return Promise.resolve(null);
    if (normalized === "replace") {
      const ok = window.confirm(
        `Replace all ${existingCount} local prompt${existingCount === 1 ? "" : "s"} with ${importCount} from the file? This cannot be undone except via the automatic pre-import backup.`
      );
      return Promise.resolve(ok ? "replace" : null);
    }
    if (normalized === "skip") return Promise.resolve("merge-skip");
    if (normalized === "overwrite") return Promise.resolve("merge-overwrite");
    if (normalized === "keep-both" || normalized === "keep both") return Promise.resolve("merge-keep-both");
    window.alert(`Unrecognized choice "${choice}". Import cancelled.`);
    return Promise.resolve(null);
  }

  /**
   * @param {File} file
   */
  async function handleImportFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") && file.type && file.type !== "application/json") {
      throw new Error(`Invalid file type "${file.type || "unknown"}". Please choose a .json export file.`);
    }
    let text;
    try {
      text = await file.text();
    } catch {
      throw new Error("Could not read the selected file.");
    }
    if (!text.trim()) throw new Error("The file is empty.");
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`Invalid JSON: ${detail}`);
    }
    const validation = validateImportPayload(data);
    if (!validation.ok) {
      throw new Error(`Invalid import file:\n\n${validation.errors.slice(0, 10).join("\n")}${validation.errors.length > 10 ? `\n…and ${validation.errors.length - 10} more.` : ""}`);
    }
    const imported = validation.prompts;
    const existing = loadPrompts();
    const duplicateIds = findDuplicateIds(imported, existing);
    const strategy = await promptImportStrategy(imported, duplicateIds);
    if (!strategy) return;
    const result = importPromptLibrary(imported, strategy);
    refresh();
    const dupNote =
      duplicateIds.length > 0 && strategy.startsWith("merge")
        ? ` (${duplicateIds.length} ID conflict${duplicateIds.length === 1 ? "" : "s"} resolved via "${strategy.replace("merge-", "")}")`
        : "";
    window.alert(
      `Import complete.\n\n` +
        `${result.total} prompt${result.total === 1 ? "" : "s"} now in your library${dupNote}.`
    );
  }

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 11);
  }

  const form = document.getElementById("prompt-form");
  const titleInput = document.getElementById("prompt-title");
  const contentInput = document.getElementById("prompt-content");
  const modelInput = document.getElementById("prompt-model");
  const isCodeInput = document.getElementById("prompt-is-code");
  const listEl = document.getElementById("prompt-list");
  const emptyEl = document.getElementById("empty-state");
  const filterEmptyEl = document.getElementById("filter-empty-state");
  const countEl = document.getElementById("prompt-count");
  const ratingSummaryEl = document.getElementById("rating-summary");
  const clearBtn = document.getElementById("clear-form");
  const sortSelect = document.getElementById("sort-select");
  const filterTabs = document.querySelector(".filter-tabs");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file");

  /** @param {Prompt[]} prompts */
  function getVisiblePrompts(prompts) {
    let list = [...prompts];
    if (activeFilter === "rated") list = list.filter((p) => p.rating > 0);
    if (activeFilter === "unrated") list = list.filter((p) => p.rating === 0);
    if (activeFilter === "high") list = list.filter((p) => p.rating >= 4);

    const byCreatedDesc = (a, b) =>
      new Date(b.metadata.createdAt || 0).getTime() - new Date(a.metadata.createdAt || 0).getTime();
    if (activeSort === "rating-desc") {
      list.sort((a, b) => (b.rating !== a.rating ? b.rating - a.rating : byCreatedDesc(a, b)));
    } else if (activeSort === "rating-asc") {
      list.sort((a, b) => (a.rating !== b.rating ? a.rating - b.rating : byCreatedDesc(a, b)));
    } else {
      list.sort(byCreatedDesc);
    }
    return list;
  }

  /** @param {Prompt[]} allPrompts */
  function updateRatingSummary(allPrompts) {
    const rated = allPrompts.filter((p) => p.rating > 0);
    if (rated.length === 0) return void (ratingSummaryEl.hidden = true);
    const avg = rated.reduce((sum, p) => sum + p.rating, 0) / rated.length;
    ratingSummaryEl.textContent = `Average rating: ${avg.toFixed(1)} / 5 (${rated.length} rated)`;
    ratingSummaryEl.hidden = false;
  }

  /** @param {Prompt} prompt */
  function buildStarRating(prompt) {
    const wrap = document.createElement("div");
    wrap.className = "star-rating-wrap";
    const label = document.createElement("span");
    label.className = "star-rating__label";
    label.textContent = prompt.rating > 0 ? "Effectiveness" : "Rate effectiveness";
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
      btn.setAttribute("aria-label", `${star} star${star === 1 ? "" : "s"}`);
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

  function buildMetadataSection(prompt) {
    const section = document.createElement("section");
    section.className = "prompt-card__metadata";

    const model = document.createElement("p");
    model.className = "prompt-card__metadata-item";
    model.textContent = `Model: ${prompt.metadata.model}`;

    const created = document.createElement("p");
    created.className = "prompt-card__metadata-item";
    created.textContent = `Created: ${formatDate(prompt.metadata.createdAt)}`;

    const updated = document.createElement("p");
    updated.className = "prompt-card__metadata-item";
    updated.textContent = `Updated: ${formatDate(prompt.metadata.updatedAt)}`;

    const tokens = document.createElement("p");
    tokens.className = "prompt-card__metadata-item";
    const confidence = document.createElement("span");
    confidence.className = `token-confidence token-confidence--${prompt.metadata.tokenEstimate.confidence}`;
    confidence.textContent = prompt.metadata.tokenEstimate.confidence;
    tokens.textContent = `Tokens: ${prompt.metadata.tokenEstimate.min} - ${prompt.metadata.tokenEstimate.max} (`;
    tokens.appendChild(confidence);
    tokens.append(")");

    section.append(model, created, updated, tokens);
    return section;
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
    if (!isEditing) textarea.setAttribute("readonly", "true");
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
    for (const note of prompt.notes) list.appendChild(buildNoteItem(note));
    section.append(head, list);
    return section;
  }

  function previewStars(group, hoverValue) {
    const stars = group.querySelectorAll(".star-rating__star");
    stars.forEach((btn, i) => btn.classList.toggle("is-preview", hoverValue > 0 && i + 1 <= hoverValue));
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function refresh() {
    const all = loadPrompts();
    render(all, getVisiblePrompts(all));
  }

  function render(allPrompts, visible) {
    listEl.innerHTML = "";
    const total = allPrompts.length;
    const shown = visible.length;
    countEl.textContent = shown === total ? (total === 1 ? "1 saved" : `${total} saved`) : `${shown} of ${total} shown`;
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
      const dateStr = formatDate(p.metadata.createdAt);
      meta.textContent = p.rating > 0 ? `${dateStr} · ${p.rating} star${p.rating === 1 ? "" : "s"}` : dateStr;
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
      const metadata = buildMetadataSection(p);
      const pre = document.createElement("pre");
      pre.className = "prompt-card__body";
      pre.textContent = p.content;
      const notes = buildNotesSection(p);
      li.append(top, stars, metadata, pre, notes);
      listEl.appendChild(li);
    }
  }

  function setRating(promptId, value) {
    try {
      const rating = Math.max(0, Math.min(5, Math.round(Number(value))));
      const prompts = loadPrompts().map((p) =>
        p.id === promptId ? { ...p, rating, metadata: updateTimestamps(p.metadata) } : p
      );
      savePrompts(prompts);
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to update rating.");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const model = modelInput instanceof HTMLInputElement ? modelInput.value.trim() : "";
    const isCode = isCodeInput instanceof HTMLInputElement ? isCodeInput.checked : false;
    if (!title || !content || !model) {
      if (!title) titleInput.focus();
      else if (!content) contentInput.focus();
      else if (modelInput instanceof HTMLInputElement) modelInput.focus();
      return;
    }
    try {
      const metadata = trackModel(model, content, isCode);
      const prompt = { id: generateId(), title, content, createdAt: metadata.createdAt, rating: 0, notes: [], metadata };
      const prompts = loadPrompts();
      prompts.push(prompt);
      savePrompts(prompts);
      form.reset();
      titleInput.focus();
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save prompt.");
    }
  });

  clearBtn.addEventListener("click", () => titleInput.focus());

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
    if (rateBtn instanceof HTMLButtonElement && rateBtn.dataset.id) return setRating(rateBtn.dataset.id, rateBtn.dataset.value || "0");
    const delBtn = target.closest('button[data-action="delete"]');
    if (delBtn instanceof HTMLButtonElement && delBtn.dataset.id) {
      const prompts = loadPrompts().filter((p) => p.id !== delBtn.dataset.id);
      savePrompts(prompts);
      refresh();
      return;
    }

    const noteAddBtn = target.closest('button[data-action="note-add"]');
    if (noteAddBtn instanceof HTMLButtonElement && noteAddBtn.dataset.id) {
      const note = { noteId: generateId(), content: "", updatedAt: new Date().toISOString() };
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
    if (!(noteEl instanceof HTMLElement) || !(promptEl instanceof HTMLElement)) return;
    const promptId = promptEl.dataset.promptId;
    const noteId = noteEl.dataset.noteId;
    if (!promptId || !noteId) return;
    const textarea = noteEl.querySelector(".note-item__content");
    const editBtn = noteEl.querySelector('button[data-action="note-edit"]');
    const saveBtn = noteEl.querySelector('button[data-action="note-save"]');
    if (!(textarea instanceof HTMLTextAreaElement) || !(editBtn instanceof HTMLButtonElement) || !(saveBtn instanceof HTMLButtonElement)) return;

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
          return { ...p, notes: [...p.notes, { noteId, content: textarea.value, updatedAt: now }], metadata: updateTimestamps(p.metadata) };
        }
        const notes = p.notes.map((n) => (n.noteId === noteId ? { ...n, content: textarea.value, updatedAt: now } : n));
        return { ...p, notes, metadata: updateTimestamps(p.metadata) };
      });
      savePrompts(prompts);
      refresh();
      return;
    }

    if (target.closest('button[data-action="note-cancel"]')) {
      const isNew = noteEl.dataset.isNew === "true";
      if (isNew) return void noteEl.remove();
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
      const prompts = loadPrompts().map((p) =>
        p.id !== promptId ? p : { ...p, notes: p.notes.filter((n) => n.noteId !== noteId), metadata: updateTimestamps(p.metadata) }
      );
      savePrompts(prompts);
      refresh();
    }
  });

  listEl.addEventListener("mouseover", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const star = target.closest(".star-rating__star");
    if (!(star instanceof HTMLButtonElement)) return;
    const group = star.closest(".star-rating");
    if (group) previewStars(group, Number(star.dataset.value) || 0);
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
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("star-rating__star")) return;
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
      if (promptId && target.dataset.value) setRating(promptId, target.dataset.value);
      return;
    } else {
      return;
    }
    const nextStar = stars[next];
    if (nextStar instanceof HTMLButtonElement) nextStar.focus();
  });

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      try {
        const { filename, count } = exportPromptLibrary();
        window.alert(`Exported ${count} prompt${count === 1 ? "" : "s"} to ${filename}.`);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Export failed.");
      }
    });
  }

  if (importBtn && importFileInput instanceof HTMLInputElement) {
    importBtn.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", async () => {
      const file = importFileInput.files && importFileInput.files[0];
      importFileInput.value = "";
      if (!file) return;
      try {
        await handleImportFile(file);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Import failed.");
        refresh();
      }
    });
  }

  refresh();
})();
