(function () {
  "use strict";

  const MODEL_CONFIG = Object.freeze({
    clip: Object.freeze({
      label: "CLIP RN50",
      atlasUrls: Object.freeze([
        "assets/data/clip/atlas/concept_atlas_clip_qwen_gpus_4567.atlas.gz",
      ]),
    }),
    densenet161: Object.freeze({
      label: "DenseNet161",
      atlasUrls: Object.freeze([
        "assets/data/densenet161/atlas/concept_atlas_densenet161_qwen_gpus_4567.atlas.gz",
      ]),
    }),
    resnet18: Object.freeze({
      label: "ResNet18",
      atlasUrls: Object.freeze([
        "assets/data/resnet18/atlas/concept_atlas_resnet18_qwen_gpus_4567.atlas.gz",
      ]),
    }),
  });

  const VALID_MODELS = new Set(Object.keys(MODEL_CONFIG));
  const VALID_METHODS = new Set(["atlas", "global", "local"]);

  const appState = {
    step: "model",
    model: null,
    method: null,
    globalTargetKey: null,
    globalTargetsByModel: Object.create(null),
    globalTargetsLoading: false,
    globalPayloadByUrl: Object.create(null),
    globalRenderKey: null,
    globalLoading: false,
    atlas: null,
    atlasModel: null,
    atlasViewer: null,
    atlasLoading: false,
  };

  const dom = {
    stepPills: Array.from(document.querySelectorAll(".step-pill")),
    views: Array.from(document.querySelectorAll(".step-view")),
    modelCards: Array.from(document.querySelectorAll(".pick-card[data-model]")),
    methodCards: Array.from(document.querySelectorAll(".pick-card[data-method]")),
    goButtons: Array.from(document.querySelectorAll("[data-go]")),
    selectionSummary: document.getElementById("selection-summary"),
    atlasPanel: document.getElementById("atlas-panel"),
    atlasRoot: document.getElementById("atlas-root"),
    atlasLoading: document.getElementById("atlas-loading"),
    atlasError: document.getElementById("atlas-error"),
    atlasHelp: document.getElementById("atlas-help"),
    globalPanel: document.getElementById("global-panel"),
    globalRoot: document.getElementById("global-root"),
    globalLoading: document.getElementById("global-loading"),
    globalError: document.getElementById("global-error"),
    globalHelp: document.getElementById("global-help"),
    globalTargetNote: document.getElementById("global-target-note"),
    globalTargetGrid: document.getElementById("global-target-grid"),
    resetViewBtn: document.querySelector('[data-action="reset-view"]'),
  };

  function normalizeChoice(value, allowed) {
    const key = String(value || "").trim().toLowerCase();
    if (!key || !allowed.has(key)) return null;
    return key;
  }

  function normalizeMethodKey(value) {
    const key = normalizeChoice(value, VALID_METHODS);
    if (!key) return null;
    if (key === "local") return "global";
    return key;
  }

  function methodLabel(methodKey) {
    const key = String(methodKey || "").toLowerCase();
    if (key === "atlas") return "ATLAS";
    if (key === "global") return "GLOBAL";
    return "-";
  }

  function modelLabel(modelKey) {
    const cfg = modelKey ? MODEL_CONFIG[modelKey] : null;
    if (cfg && cfg.label) return cfg.label;
    return modelKey ? String(modelKey).toUpperCase() : "-";
  }

  function atlasUrlCandidates(modelKey) {
    const cfg = modelKey ? MODEL_CONFIG[modelKey] : null;
    return cfg && Array.isArray(cfg.atlasUrls) ? cfg.atlasUrls : [];
  }

  function globalBaseDir(modelKey) {
    const mk = String(modelKey || "").trim().toLowerCase();
    return mk ? `assets/data/${mk}/global/` : "";
  }

  function isAbsoluteLikeUrl(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return false;
    return raw.startsWith("http://")
      || raw.startsWith("https://")
      || raw.startsWith("data:")
      || raw.startsWith("/");
  }

  function joinUrl(base, suffix) {
    const b = String(base || "").trim();
    const s = String(suffix || "").trim();
    if (!s) return "";
    if (isAbsoluteLikeUrl(s)) return s;
    if (!b) return s;
    const left = b.endsWith("/") ? b : `${b}/`;
    const right = s.startsWith("./") ? s.slice(2) : s;
    return `${left}${right}`;
  }

  function parseTargetIdText(value, fallbackName) {
    const raw = String(value || "").trim();
    if (raw) return raw;
    const name = String(fallbackName || "");
    const match = name.match(/target\s*#\s*(\d+)/i);
    return match ? String(match[1]) : "";
  }

  function currentGlobalTargets() {
    const model = String(appState.model || "");
    if (!model) return [];
    const rows = appState.globalTargetsByModel[model];
    return Array.isArray(rows) ? rows : [];
  }

  function currentGlobalTarget() {
    const key = String(appState.globalTargetKey || "");
    if (!key) return null;
    const rows = currentGlobalTargets();
    for (let i = 0; i < rows.length; i += 1) {
      if (String(rows[i].key || "") === key) return rows[i];
    }
    return null;
  }

  function setUiMode(step) {
    const atlasMode = step === "atlas";
    document.body.classList.toggle("mode-atlas", atlasMode);
    document.body.classList.toggle("mode-select", !atlasMode);
    document.body.classList.remove("step-model", "step-method", "step-target", "step-atlas");
    document.body.classList.add(`step-${step}`);
    document.body.classList.toggle("method-atlas", appState.method === "atlas");
    document.body.classList.toggle("method-global", appState.method === "global");
  }

  function updateUrlState() {
    const params = new URLSearchParams();
    if (appState.model) params.set("model", appState.model);
    if (appState.method) params.set("method", appState.method);
    if (appState.method === "global" && appState.globalTargetKey) {
      params.set("target", appState.globalTargetKey);
    }
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(
      {
        model: appState.model,
        method: appState.method,
        target: appState.globalTargetKey,
        step: appState.step,
      },
      "",
      next
    );
  }

  function applyUrlState() {
    const params = new URLSearchParams(window.location.search || "");
    const model = normalizeChoice(params.get("model"), VALID_MODELS);
    const method = normalizeMethodKey(params.get("method"));
    const target = String(params.get("target") || "").trim() || null;
    appState.model = model;
    appState.method = model ? method : null;
    appState.globalTargetKey = model && method === "global" ? target : null;
    if (appState.model && appState.method === "atlas") return "atlas";
    if (appState.model && appState.method === "global") {
      return appState.globalTargetKey ? "atlas" : "target";
    }
    if (appState.model) return "method";
    return "model";
  }

  function formatBytes(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${n.toFixed(0)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStep(step, options) {
    const opts = options && typeof options === "object" ? options : {};
    const syncUrl = opts.syncUrl !== false;
    appState.step = step;
    setUiMode(step);
    dom.views.forEach((v) => {
      const active = v.getAttribute("data-step-view") === step;
      v.classList.toggle("is-active", active);
    });
    dom.stepPills.forEach((p) => {
      p.classList.toggle("is-active", p.getAttribute("data-step") === step);
    });

    const isAtlasStep = step === "atlas";
    const showAtlasPanel = isAtlasStep && appState.method === "atlas";
    const showGlobalPanel = isAtlasStep && appState.method === "global";
    if (dom.atlasPanel) dom.atlasPanel.hidden = !showAtlasPanel;
    if (dom.globalPanel) dom.globalPanel.hidden = !showGlobalPanel;
    if (dom.atlasHelp) dom.atlasHelp.hidden = !showAtlasPanel;
    if (dom.globalHelp) dom.globalHelp.hidden = !showGlobalPanel;

    if (syncUrl) updateUrlState();
    updateSelectionSummary();

    if (step === "target") {
      void loadGlobalTargetsIfNeeded();
      return;
    }

    if (step === "atlas") {
      if (appState.method === "atlas") {
        void loadAtlasIfNeeded();
        window.setTimeout(() => {
          if (appState.step === "atlas" && appState.atlasViewer) {
            appState.atlasViewer.notifyResize();
          }
        }, 520);
      } else if (appState.method === "global") {
        void loadGlobalIfNeeded();
      }
    }
  }

  function updateSelectionSummary() {
    if (!dom.selectionSummary) return;
    const model = modelLabel(appState.model);
    const method = methodLabel(appState.method);
    const curTarget = currentGlobalTarget();
    const targetText = appState.method === "global"
      ? ` | Target: ${curTarget ? shortTargetName(curTarget.name || curTarget.slug || "", "-") : "-"}`
      : "";
    dom.selectionSummary.textContent = `Model: ${model} | Method: ${method}${targetText}`;
  }

  function setLoadingState(message) {
    if (!dom.atlasLoading) return;
    dom.atlasLoading.textContent = message || "Loading atlas...";
    dom.atlasLoading.hidden = false;
    if (dom.atlasError) dom.atlasError.hidden = true;
  }

  function clearLoadingState() {
    if (dom.atlasLoading) dom.atlasLoading.hidden = true;
  }

  function setErrorState(errorMessage) {
    if (!dom.atlasError) return;
    dom.atlasError.textContent = errorMessage;
    dom.atlasError.hidden = false;
    if (dom.atlasLoading) dom.atlasLoading.hidden = true;
  }

  function setLoadingStage(stage, loadedBytes, totalBytes) {
    const loaded = Math.max(0, Number(loadedBytes) || 0);
    const total = Math.max(0, Number(totalBytes) || 0);
    if (stage === "download") {
      if (total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((loaded * 100) / total)));
        setLoadingState(`Downloading atlas ${formatBytes(loaded)} / ${formatBytes(total)} (${pct}%)`);
      } else {
        setLoadingState(`Downloading atlas ${formatBytes(loaded)}`);
      }
      return;
    }
    if (stage === "decompress") {
      setLoadingState(`Decompressing atlas ${formatBytes(loaded)}`);
      return;
    }
    if (stage === "parse") {
      setLoadingState("Parsing atlas JSON...");
      return;
    }
    if (stage === "normalize") {
      setLoadingState("Building atlas structures...");
      return;
    }
    if (stage === "render") {
      setLoadingState("Rendering interactive atlas...");
      return;
    }
    setLoadingState("Loading atlas...");
  }

  function setGlobalLoadingState(message) {
    if (!dom.globalLoading) return;
    dom.globalLoading.textContent = message || "Loading global explanation...";
    dom.globalLoading.hidden = false;
    if (dom.globalError) dom.globalError.hidden = true;
  }

  function clearGlobalLoadingState() {
    if (dom.globalLoading) dom.globalLoading.hidden = true;
  }

  function setGlobalErrorState(errorMessage) {
    if (!dom.globalError) return;
    dom.globalError.textContent = errorMessage;
    dom.globalError.hidden = false;
    if (dom.globalLoading) dom.globalLoading.hidden = true;
  }

  function setGlobalLoadingStage(stage, loadedBytes, totalBytes) {
    const loaded = Math.max(0, Number(loadedBytes) || 0);
    const total = Math.max(0, Number(totalBytes) || 0);
    if (stage === "download") {
      if (total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((loaded * 100) / total)));
        setGlobalLoadingState(`Downloading global explanation ${formatBytes(loaded)} / ${formatBytes(total)} (${pct}%)`);
      } else {
        setGlobalLoadingState(`Downloading global explanation ${formatBytes(loaded)}`);
      }
      return;
    }
    if (stage === "decompress") {
      setGlobalLoadingState(`Decompressing global explanation ${formatBytes(loaded)}`);
      return;
    }
    if (stage === "parse") {
      setGlobalLoadingState("Parsing global explanation JSON...");
      return;
    }
    if (stage === "render") {
      setGlobalLoadingState("Rendering global explanation...");
      return;
    }
    setGlobalLoadingState("Loading global explanation...");
  }

  function setTargetNote(message, options) {
    if (!dom.globalTargetNote) return;
    const opts = options && typeof options === "object" ? options : {};
    dom.globalTargetNote.textContent = String(message || "");
    dom.globalTargetNote.classList.toggle("is-error", !!opts.error);
    dom.globalTargetNote.hidden = !!opts.hidden;
  }

  async function readStreamToBytes(stream, onProgress, totalBytesHint) {
    const reader = stream.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const next = await reader.read();
      if (!next || next.done) break;
      const value = next.value;
      if (!value || !value.byteLength) continue;
      chunks.push(value);
      received += value.byteLength;
      if (onProgress) onProgress(received, totalBytesHint || 0);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return out;
  }

  async function fetchCompressedTextPayload(url, onStage, label) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) {
      throw new Error(`Failed to load ${String(label || "payload")} (${response.status} ${response.statusText})`);
    }

    const totalBytes = safeInt(response.headers.get("content-length"), 0);
    let downloaded = null;
    if (response.body) {
      downloaded = await readStreamToBytes(response.body, (loaded) => {
        if (onStage) onStage("download", loaded, totalBytes);
      }, totalBytes);
    } else {
      const buffer = await response.arrayBuffer();
      downloaded = new Uint8Array(buffer);
      if (onStage) onStage("download", downloaded.byteLength, totalBytes);
    }

    if (!url.toLowerCase().endsWith(".gz")) {
      return new TextDecoder().decode(downloaded);
    }

    if (typeof DecompressionStream === "undefined") {
      throw new Error(
        "Your browser does not support gzip streaming for .gz files. Use a modern Chromium/Firefox, or host uncompressed JSON."
      );
    }

    if (onStage) onStage("decompress", 0, 0);
    const compressed = new Blob([downloaded]).stream();
    const decompressed = compressed.pipeThrough(new DecompressionStream("gzip"));
    const payloadBytes = await readStreamToBytes(decompressed, (loaded) => {
      if (onStage) onStage("decompress", loaded, 0);
    }, 0);
    return new TextDecoder().decode(payloadBytes);
  }

  async function fetchAtlasPayload(url, onStage) {
    return fetchCompressedTextPayload(url, onStage, "atlas");
  }

  async function fetchGlobalPayload(url, onStage) {
    return fetchCompressedTextPayload(url, onStage, "global explanation");
  }

  function safeFloat(x, fallback) {
    const v = Number(x);
    if (!Number.isFinite(v)) return fallback;
    return v;
  }

  function safeInt(x, fallback) {
    const v = Number.parseInt(String(x), 10);
    if (!Number.isFinite(v)) return fallback;
    return v;
  }

  function safeText(x, fallback) {
    const text = String(x == null ? "" : x).trim();
    return text || String(fallback || "");
  }

  function escapeHtml(x) {
    return String(x ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function signed3(v) {
    const x = Number(v);
    if (!Number.isFinite(x)) return "N/A";
    return `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
  }

  function score2(v) {
    const x = Number(v);
    if (!Number.isFinite(x)) return "";
    return `(${x.toFixed(2)})`;
  }

  function normalizeSlugLabel(slug) {
    const raw = String(slug || "").trim();
    if (!raw) return "Untitled target";
    const spaced = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function shortTargetName(value, fallback) {
    let text = safeText(value, fallback || "");
    text = text.replace(/^target\s*#\s*\d+\s*:\s*/i, "");
    text = text.replace(/^target\s*:\s*/i, "");
    text = text.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return text || "Untitled target";
  }

  function normalizeManifestTargetRows(modelKey, entries) {
    const base = globalBaseDir(modelKey);
    const safe = Array.isArray(entries) ? entries : [];
    const rows = [];
    for (let i = 0; i < safe.length; i += 1) {
      const row = safe[i];
      if (!row || typeof row !== "object") continue;
      const slug = safeText(row.slug || row.folder || row.key, "");
      if (!slug) continue;
      const folderUrl = joinUrl(base, `${slug}/`);
      const name = safeText(row.name, normalizeSlugLabel(slug));
      const idText = parseTargetIdText(row.id, name);
      const idNum = Number.parseInt(idText, 10);
      const imageCandidate = safeText(row.image || row.image_url || row.imageUrl || "", "");
      const gexpCandidate = safeText(row.gexp || row.gexp_url || row.gexpUrl || "", "");
      const imageUrl = imageCandidate
        ? (imageCandidate.includes("/") || isAbsoluteLikeUrl(imageCandidate)
            ? joinUrl(base, imageCandidate)
            : joinUrl(folderUrl, imageCandidate))
        : "";
      const gexpUrl = gexpCandidate
        ? (gexpCandidate.includes("/") || isAbsoluteLikeUrl(gexpCandidate)
            ? joinUrl(base, gexpCandidate)
            : joinUrl(folderUrl, gexpCandidate))
        : "";
      rows.push({
        key: `${modelKey}:${slug}`,
        slug,
        idText,
        idNum: Number.isFinite(idNum) ? idNum : null,
        name,
        description: safeText(row.description, ""),
        imageUrl,
        gexpUrl,
      });
    }
    const valid = rows.filter((x) => !!x.gexpUrl);
    valid.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return valid;
  }

  async function discoverGlobalTargetsFromManifest(modelKey) {
    const base = globalBaseDir(modelKey);
    if (!base) return null;
    const manifestUrl = joinUrl(base, "targets.json");
    let response = null;
    try {
      response = await fetch(manifestUrl, { cache: "no-store" });
    } catch (_err) {
      return null;
    }
    if (!response || !response.ok) return null;

    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      return null;
    }
    const entries = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.targets) ? payload.targets : []);
    return normalizeManifestTargetRows(modelKey, entries);
  }

  async function fetchDirectoryListing(dirUrl) {
    const clean = String(dirUrl || "").trim();
    const url = clean.endsWith("/") ? clean : `${clean}/`;
    let response = null;
    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (_err) {
      return { subdirs: [], files: [] };
    }
    if (!response || !response.ok) {
      return { subdirs: [], files: [] };
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return { subdirs: [], files: [] };
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    const subdirsSet = new Set();
    const filesSet = new Set();
    anchors.forEach((a) => {
      const hrefRaw = String(a.getAttribute("href") || "").trim();
      if (!hrefRaw || hrefRaw === "../" || hrefRaw === "./" || hrefRaw.startsWith("?") || hrefRaw.startsWith("#")) return;
      let href = hrefRaw.split("#")[0].split("?")[0];
      if (!href) return;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return;
      if (href.startsWith("/")) return;
      try {
        href = decodeURIComponent(href);
      } catch (_err) {
        // keep original
      }
      const isDir = href.endsWith("/");
      const name = isDir ? href.slice(0, -1) : href;
      if (!name || name === "." || name === "..") return;
      if (name.includes("/")) return;
      if (isDir) subdirsSet.add(name);
      else filesSet.add(name);
    });
    return {
      subdirs: Array.from(subdirsSet).sort((a, b) => a.localeCompare(b)),
      files: Array.from(filesSet).sort((a, b) => a.localeCompare(b)),
    };
  }

  function parsePreviewText(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const out = { id: "", name: "", description: "", image: "" };
    let inBlock = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^\[target\s+\d+\]/i.test(line)) {
        if (inBlock) break;
        inBlock = true;
        continue;
      }
      if (!inBlock && line.toLowerCase().startsWith("global_explanations:")) continue;
      const lc = line.toLowerCase();
      if (lc.startsWith("id:")) out.id = line.slice(3).trim();
      else if (lc.startsWith("name:")) out.name = line.slice(5).trim();
      else if (lc.startsWith("description:")) out.description = line.slice(12).trim();
      else if (lc.startsWith("image:")) out.image = line.slice(6).trim();
    }
    return out;
  }

  async function discoverGlobalTargetsForModel(modelKey) {
    const base = globalBaseDir(modelKey);
    if (!base) return [];
    const listing = await fetchDirectoryListing(base);
    const subdirs = Array.isArray(listing.subdirs) ? listing.subdirs : [];
    if (!subdirs.length) return [];

    const rows = [];
    for (let i = 0; i < subdirs.length; i += 1) {
      const slug = subdirs[i];
      const folderUrl = `${base}${slug}/`;
      const inside = await fetchDirectoryListing(folderUrl);
      const files = Array.isArray(inside.files) ? inside.files : [];

      let previewFile = "";
      for (let j = 0; j < files.length; j += 1) {
        const f = String(files[j] || "");
        if (f.toLowerCase().endsWith(".preview.txt")) {
          previewFile = f;
          break;
        }
      }

      let gexpFile = "";
      for (let j = 0; j < files.length; j += 1) {
        const f = String(files[j] || "");
        if (f.toLowerCase().endsWith(".gexp.gz") || f.toLowerCase().endsWith(".gexp")) {
          gexpFile = f;
          break;
        }
      }

      let preview = { id: "", name: "", description: "", image: "" };
      if (previewFile) {
        try {
          const txtResp = await fetch(`${folderUrl}${previewFile}`, { cache: "no-store" });
          if (txtResp.ok) {
            const txt = await txtResp.text();
            preview = parsePreviewText(txt);
          }
        } catch (_err) {
          // ignore broken preview
        }
      }

      let imageFile = safeText(preview.image, "");
      const hasImageInFiles = imageFile && files.indexOf(imageFile) >= 0;
      if (!hasImageInFiles) {
        imageFile = "";
        for (let j = 0; j < files.length; j += 1) {
          const f = String(files[j] || "");
          if (/\.(png|jpe?g|webp|gif)$/i.test(f)) {
            imageFile = f;
            break;
          }
        }
      }

      const idText = safeText(preview.id, "");
      const idNum = Number.parseInt(idText, 10);
      rows.push({
        key: `${modelKey}:${slug}`,
        slug,
        idText,
        idNum: Number.isFinite(idNum) ? idNum : null,
        name: safeText(preview.name, normalizeSlugLabel(slug)),
        description: safeText(preview.description, ""),
        imageUrl: imageFile ? `${folderUrl}${imageFile}` : "",
        gexpUrl: gexpFile ? `${folderUrl}${gexpFile}` : "",
      });
    }

    const valid = rows.filter((r) => !!r.gexpUrl);
    valid.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return valid;
  }

  function renderGlobalTargetCards(targets) {
    if (!dom.globalTargetGrid) return;
    const rows = Array.isArray(targets) ? targets : [];
    if (!rows.length) {
      dom.globalTargetGrid.innerHTML = "";
      setTargetNote("There are no global explanations for this model.");
      return;
    }
    setTargetNote("", { hidden: true });
    const cards = rows.map((row) => {
      const active = String(appState.globalTargetKey || "") === String(row.key || "");
      const shortName = shortTargetName(row.name || "", row.slug || "");
      const title = escapeHtml(shortName);
      const imageHtml = row.imageUrl
        ? `<img src="${escapeHtml(row.imageUrl)}" alt="${title}"/>`
        : `<div></div>`;
      return [
        `<button class="target-card pick-card${active ? " is-active" : ""}" type="button" data-target-key="${escapeHtml(row.key)}">`,
        "  <div class=\"target-card-inner\">",
        `    <div class="target-card-media">${imageHtml}</div>`,
        `    <div class="target-card-title">${title}</div>`,
        "  </div>",
        "</button>",
      ].join("");
    });
    dom.globalTargetGrid.innerHTML = cards.join("");
  }

  async function loadGlobalTargetsIfNeeded() {
    const model = String(appState.model || "");
    if (!model) return;
    if (appState.globalTargetsLoading) return;
    const existing = appState.globalTargetsByModel[model];
    if (Array.isArray(existing)) {
      renderGlobalTargetCards(existing);
      return;
    }

    appState.globalTargetsLoading = true;
    setTargetNote("Scanning global explanation folders...");
    if (dom.globalTargetGrid) dom.globalTargetGrid.innerHTML = "";
    try {
      let rows = await discoverGlobalTargetsFromManifest(model);
      if (!rows) {
        rows = await discoverGlobalTargetsForModel(model);
      }
      appState.globalTargetsByModel[model] = rows;
      if (!appState.globalTargetKey && rows.length > 0) {
        appState.globalTargetKey = String(rows[0].key || "");
      }
      renderGlobalTargetCards(rows);
      updateSelectionSummary();
    } catch (err) {
      console.error(err);
      setTargetNote(
        err instanceof Error ? err.message : String(err),
        { error: true, hidden: false }
      );
    } finally {
      appState.globalTargetsLoading = false;
    }
  }

  function memberSignature(members) {
    const mask = (1n << 64n) - 1n;
    let count = BigInt(members.length);
    let sum = 0n;
    let sumSq = 0n;
    let x1 = 0n;
    let x2 = 0n;
    for (let i = 0; i < members.length; i += 1) {
      const v = BigInt(safeInt(members[i], 0));
      sum += v;
      sumSq += v * v;
      const z = (v * 11400714819323198485n) & mask;
      x1 ^= z;
      x2 = (x2 + z) & mask;
    }
    return `${count}:${sum}:${sumSq}:${x1}:${x2}`;
  }

  function normalizeAtlas(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Atlas payload must be an object.");
    }

    const rawPoints = Array.isArray(raw.points) ? raw.points : [];
    if (rawPoints.length === 0) {
      throw new Error("Atlas has no points.");
    }

    const points = [];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < rawPoints.length; i += 1) {
      const p = rawPoints[i];
      if (!p || typeof p !== "object") continue;
      const x = safeFloat(p.x, 0);
      const y = safeFloat(p.y, 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      points.push({
        concept_id: String(p.concept_id ?? ""),
        description: String(p.description ?? ""),
        x,
        y,
        metadata: p.metadata && typeof p.metadata === "object" ? { ...p.metadata } : {},
      });
    }

    const nPoints = points.length;
    if (nPoints === 0) throw new Error("Atlas points are malformed.");

    let levelsRaw = [];
    if (Array.isArray(raw.hierarchy)) {
      levelsRaw = raw.hierarchy.filter((x) => x && typeof x === "object");
    } else if (raw.hierarchy && typeof raw.hierarchy === "object") {
      levelsRaw = Object.keys(raw.hierarchy).map((k) => {
        const v = raw.hierarchy[k];
        if (v && typeof v === "object") {
          return { level_index: safeInt(k, 0), ...v };
        }
        return null;
      }).filter(Boolean);
    }

    if (levelsRaw.length === 0) {
      throw new Error("Atlas has no hierarchy levels.");
    }

    const levels = [];
    for (let i = 0; i < levelsRaw.length; i += 1) {
      const lv = levelsRaw[i] || {};
      const labelsRaw = Array.isArray(lv.labels) ? lv.labels : [];
      const labels = labelsRaw.map((x) => safeInt(x, 0));
      if (labels.length !== nPoints) {
        throw new Error(`Hierarchy labels mismatch at level ${i}: expected ${nPoints}, got ${labels.length}`);
      }

      const clustersRaw = Array.isArray(lv.clusters) ? lv.clusters : [];
      const clusters = [];
      for (let j = 0; j < clustersRaw.length; j += 1) {
        const c = clustersRaw[j] || {};
        const cid = safeInt(c.cluster_id, j);
        const members = Array.isArray(c.member_indices)
          ? c.member_indices.map((m) => safeInt(m, -1)).filter((m) => m >= 0 && m < nPoints)
          : [];
        clusters.push({
          cluster_id: cid,
          centroid_x: safeFloat(c.centroid_x, 0),
          centroid_y: safeFloat(c.centroid_y, 0),
          description: String(c.description ?? `Cluster ${cid}`),
          _sig: members.length > 0 ? memberSignature(members) : "",
        });
      }

      clusters.sort((a, b) => a.cluster_id - b.cluster_id);

      if (clusters.length > 0) {
        const needsFill = clusters.some((c) => !c._sig);
        if (needsFill) {
          const byId = new Map();
          for (let k = 0; k < labels.length; k += 1) {
            const id = labels[k];
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push(k);
          }
          clusters.forEach((c) => {
            if (c._sig) return;
            const mem = byId.get(c.cluster_id) || [];
            if (mem.length > 0) c._sig = memberSignature(mem);
          });
        }
      }

      levels.push({
        level_index: safeInt(lv.level_index, i),
        n_clusters: safeInt(lv.n_clusters, clusters.length),
        labels,
        clusters,
      });
    }

    levels.sort((a, b) => {
      if (a.n_clusters !== b.n_clusters) return a.n_clusters - b.n_clusters;
      return a.level_index - b.level_index;
    });

    const stablePairs = [];
    for (let li = 0; li < levels.length - 1; li += 1) {
      const lo = levels[li];
      const hi = levels[li + 1];
      const loBySig = new Map();
      const hiBySig = new Map();

      lo.clusters.forEach((c) => {
        if (!c._sig || loBySig.has(c._sig)) return;
        loBySig.set(c._sig, c.cluster_id);
      });
      hi.clusters.forEach((c) => {
        if (!c._sig || hiBySig.has(c._sig)) return;
        hiBySig.set(c._sig, c.cluster_id);
      });

      const pairs = [];
      loBySig.forEach((loCid, sig) => {
        if (!hiBySig.has(sig)) return;
        pairs.push([loCid, hiBySig.get(sig)]);
      });
      if (pairs.length > 0) {
        stablePairs.push({ lo: li, hi: li + 1, pairs });
      }
    }

    levels.forEach((lv) => {
      lv.clusters.forEach((c) => {
        delete c._sig;
      });
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
      minX = -1;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY === maxY) {
      minY = -1;
      maxY = 1;
    }

    const metadata = raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {};
    const imageStoreRaw = metadata.image_store && typeof metadata.image_store === "object" ? metadata.image_store : {};
    const imageStore = {};
    Object.keys(imageStoreRaw).forEach((k) => {
      const rec = imageStoreRaw[k];
      if (!rec || typeof rec !== "object") return;
      const b64 = String(rec.data_b64 || "").trim();
      if (!b64) return;
      const fmt = String(rec.format || "png").toLowerCase();
      let mime = "image/png";
      if (fmt === "jpg" || fmt === "jpeg") mime = "image/jpeg";
      else if (fmt === "webp") mime = "image/webp";
      else if (fmt) mime = `image/${fmt}`;
      imageStore[String(k)] = {
        mime,
        data_b64: b64,
        width: safeInt(rec.width, 0),
        height: safeInt(rec.height, 0),
      };
    });

    return {
      points,
      levels,
      stablePairs,
      imageStore,
      metadata,
      bounds: { min_x: minX, max_x: maxX, min_y: minY, max_y: maxY },
    };
  }

  function normalizeGlobalPayload(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Global explanation payload must be an object.");
    }
    const targetsRaw = Array.isArray(raw.targets) ? raw.targets : [];
    if (!targetsRaw.length) {
      throw new Error("Global explanation payload has no targets.");
    }
    const imageStoreRaw = raw.image_store && typeof raw.image_store === "object" ? raw.image_store : {};
    const imageStore = {};
    Object.keys(imageStoreRaw).forEach((k) => {
      const rec = imageStoreRaw[k];
      if (!rec || typeof rec !== "object") return;
      const b64 = String(rec.data_b64 || "").trim();
      if (!b64) return;
      let mime = String(rec.mime || "").trim().toLowerCase();
      if (!mime) {
        const fmt = String(rec.format || "png").toLowerCase();
        if (fmt === "jpg" || fmt === "jpeg") mime = "image/jpeg";
        else if (fmt === "webp") mime = "image/webp";
        else mime = `image/${fmt}`;
      }
      imageStore[String(k)] = {
        mime,
        data_b64: b64,
        width: safeInt(rec.width, 0),
        height: safeInt(rec.height, 0),
      };
    });
    return {
      targets: targetsRaw,
      imageStore,
      metadata: raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {},
    };
  }

  function resolveGlobalImageSource(item, imageStore, cache) {
    if (!item) return "";
    if (typeof item === "string") {
      const s = item.trim();
      if (!s) return "";
      if (s.startsWith("data:image/") || s.startsWith("http://") || s.startsWith("https://") || s.startsWith("/")) {
        return s;
      }
      if (cache[s]) return cache[s];
      const rec = imageStore[s];
      if (rec && rec.data_b64) {
        const src = `data:${rec.mime};base64,${rec.data_b64}`;
        cache[s] = src;
        return src;
      }
      return s;
    }
    if (typeof item !== "object") return "";
    const direct = String(item.src || item.image || item.image_url || item.data_uri || item.data_url || "").trim();
    if (direct) return direct;
    const ref = item.image_ref ?? item.imageRef ?? item.ref ?? item.row_index;
    if (ref === null || ref === undefined) return "";
    const key = String(ref);
    if (cache[key]) return cache[key];
    const rec = imageStore[key];
    if (!rec || !rec.data_b64) return "";
    const src = `data:${rec.mime};base64,${rec.data_b64}`;
    cache[key] = src;
    return src;
  }

  function renderGlobalTerms(items) {
    const safe = Array.isArray(items) ? items : [];
    const rows = [];
    const limit = Math.min(3, safe.length);
    for (let i = 0; i < limit; i += 1) {
      const row = safe[i] && typeof safe[i] === "object" ? safe[i] : { text: String(safe[i] || "") };
      const text = escapeHtml(String(row.text || row.term || row.description || "N/A"));
      const score = score2(row.score);
      rows.push(`<li class="global-exp-item"><span>${text}</span><span class="global-exp-score">${escapeHtml(score)}</span></li>`);
    }
    while (rows.length < 3) {
      rows.push('<li class="global-exp-item"><span>_</span><span class="global-exp-score"></span></li>');
    }
    return rows.join("");
  }

  function renderGlobalImageGrid(images, count, className, imageStore, cache) {
    const safe = Array.isArray(images) ? images : [];
    const cells = [];
    for (let i = 0; i < count; i += 1) {
      const src = resolveGlobalImageSource(safe[i], imageStore, cache);
      if (src) {
        cells.push(`<div class="${className}"><img src="${escapeHtml(src)}" alt="img-${i + 1}"/></div>`);
      } else {
        cells.push(`<div class="${className}"></div>`);
      }
    }
    return cells.join("");
  }

  function selectGlobalTarget(payload, selectedTargetMeta) {
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (!targets.length) return null;
    const meta = selectedTargetMeta && typeof selectedTargetMeta === "object" ? selectedTargetMeta : null;
    if (meta && Number.isFinite(meta.idNum)) {
      const idNum = Number(meta.idNum);
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i] || {};
        if (safeInt(t.target_label, Number.NaN) === idNum) return t;
      }
    }
    if (meta && Number.isFinite(meta.idNum)) {
      const idNum = Number(meta.idNum);
      for (let i = 0; i < targets.length; i += 1) {
        const t = targets[i] || {};
        if (safeInt(t.target_index, Number.NaN) === idNum) return t;
      }
    }
    if (meta && meta.name) {
      const name = String(meta.name).trim().toLowerCase();
      if (name) {
        for (let i = 0; i < targets.length; i += 1) {
          const t = targets[i] || {};
          if (String(t.target_name || "").trim().toLowerCase() === name) return t;
        }
      }
    }
    return targets[0] || null;
  }

  function renderGlobalViewer(payload, selectedTargetMeta) {
    const target = selectGlobalTarget(payload, selectedTargetMeta);
    if (!target) {
      return '<div class="target-note is-error">Global explanation has no target rows.</div>';
    }
    const imageStore = payload.imageStore || {};
    const imageCache = Object.create(null);
    const targetName = safeText(target.target_name, "Target");
    const targetDesc = safeText(target.target_description, "No description.");
    const targetImagesHtml = renderGlobalImageGrid(target.target_images, 4, "global-target-thumb", imageStore, imageCache);

    const headerStats = Array.isArray(target.header_stats) ? target.header_stats : [];
    const chips = [];
    const targetLabelVal = target.target_label == null ? target.target_index : target.target_label;
    chips.push(`<span class="global-viewer-chip">target: <strong>${escapeHtml(String(targetLabelVal))}</strong></span>`);
    for (let i = 0; i < headerStats.length; i += 1) {
      const row = headerStats[i];
      if (!row || typeof row !== "object") continue;
      const label = safeText(row.label, "");
      const value = safeText(row.value, "");
      if (!label) continue;
      chips.push(`<span class="global-viewer-chip">${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></span>`);
    }

    const concepts = Array.isArray(target.concepts) ? target.concepts : [];
    const conceptHtml = concepts.map((c) => {
      const effect = Number(c && c.effect);
      const hasEffect = Number.isFinite(effect);
      const marginal = Number(c && c.marginal_effect);
      const hasMarg = Number.isFinite(marginal);
      const signClass = hasEffect ? (effect >= 0 ? "effect-pos" : "effect-neg") : "";
      const effectClass = hasEffect ? (effect >= 0 ? "global-metric-pos" : "global-metric-neg") : "";
      const margClass = hasMarg ? (marginal >= 0 ? "global-metric-pos" : "global-metric-neg") : "";
      const invertHtml = renderGlobalTerms(c && c.top_explanations_invert);
      const clipHtml = renderGlobalTerms(c && c.top_explanations_clipdissect);
      const topImagesHtml = renderGlobalImageGrid(c && c.top_activating_images, 4, "global-thumb", imageStore, imageCache);
      const coImagesSrc = (c && (
        c.co_activated_images
        || c.joint_top_images
        || c.target_concept_top_images
      )) || [];
      const coImagesHtml = renderGlobalImageGrid(coImagesSrc, 9, "global-joint-thumb", imageStore, imageCache);
      const cid = safeText(c && c.concept_id, "");
      const desc = safeText(c && (c.description || c.concept_name), "N/A");
      return [
        `<article class="global-concept-card ${signClass}" tabindex="0">`,
        `  <div class="global-concept-title">Concept #${escapeHtml(cid)}</div>`,
        `  <div class="global-concept-desc">${escapeHtml(desc)}</div>`,
        "  <div class=\"global-metrics\">",
        `    <span>Effect: <span class="${effectClass}">${escapeHtml(hasEffect ? signed3(effect) : "N/A")}</span></span>`,
        `    <span>Marginal: <span class="${margClass}">${escapeHtml(hasMarg ? signed3(marginal) : "N/A")}</span></span>`,
        "  </div>",
        "  <div class=\"global-exp-grid\">",
        "    <section class=\"global-exp-block\">",
        "      <div class=\"global-exp-title\">INVERT</div>",
        `      <ul class="global-exp-list">${invertHtml}</ul>`,
        "    </section>",
        "    <section class=\"global-exp-block\">",
        "      <div class=\"global-exp-title\">CLIP-Dissect</div>",
        `      <ul class="global-exp-list">${clipHtml}</ul>`,
        "    </section>",
        "  </div>",
        "  <section>",
        "    <div class=\"global-top-label\">Top Activating Images</div>",
        `    <div class="global-top-grid">${topImagesHtml}</div>`,
        "  </section>",
        "  <aside class=\"global-joint-popover\" aria-hidden=\"true\">",
        "    <div class=\"global-joint-label\">Target-Concept Co-Activated Images</div>",
        `    <div class="global-joint-grid">${coImagesHtml}</div>`,
        "  </aside>",
        "</article>",
      ].join("");
    }).join("");

    return [
      '<section class="global-viewer">',
      '  <header class="global-viewer-head">',
      '    <div class="global-viewer-title">Global Explanation</div>',
      `    <div>${chips.join("")}</div>`,
      "  </header>",
      '  <section class="global-viewer-body">',
      '    <aside class="global-target-pane">',
      `      <div class="global-target-name">${escapeHtml(targetName)}</div>`,
      `      <div class="global-target-description">${escapeHtml(targetDesc)}</div>`,
      `      <div class="global-target-images">${targetImagesHtml}</div>`,
      "    </aside>",
      `    <main class="global-concepts-grid">${conceptHtml || '<div class="target-note">No concepts in this explanation.</div>'}</main>`,
      "  </section>",
      "</section>",
    ].join("");
  }

  function setupGlobalConceptHover(rootEl) {
    if (!rootEl) return;
    const grid = rootEl.querySelector(".global-concepts-grid");
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll(".global-concept-card"));
    if (!cards.length) return;

    const chooseSide = (card) => {
      const gridRect = grid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const minPopoverWidth = 360;
      const rightSpace = gridRect.right - cardRect.right;
      const leftSpace = cardRect.left - gridRect.left;
      const useRight = (rightSpace >= minPopoverWidth) || (rightSpace >= leftSpace);
      card.classList.toggle("popover-right", useRight);
      card.classList.toggle("popover-left", !useRight);
    };

    const activate = (card) => {
      chooseSide(card);
      grid.classList.add("has-active-hover");
      cards.forEach((c) => c.classList.toggle("is-hovered", c === card));
    };

    const clear = () => {
      grid.classList.remove("has-active-hover");
      cards.forEach((c) => c.classList.remove("is-hovered"));
    };

    cards.forEach((card) => {
      card.addEventListener("mouseenter", () => activate(card));
      card.addEventListener("mouseleave", () => clear());
      card.addEventListener("focusin", () => activate(card));
      card.addEventListener("focusout", (ev) => {
        const next = ev.relatedTarget;
        if (next && card.contains(next)) return;
        clear();
      });
    });
  }

  class AtlasViewer {
    constructor(root, atlas) {
      this.root = root;
      this.atlas = atlas;
      this.points = atlas.points;
      this.levels = atlas.levels;
      this.imageStore = atlas.imageStore || {};
      this.bounds = atlas.bounds;

      this.minZoom = 0.5;
      this.maxZoom = 64;
      this.pointRadius = 2.2;
      this.pointAlpha = 0.72;

      this.state = {
        w: 10,
        h: 10,
        dpr: 1,
        baseScale: 1,
        zoom: 1,
        panX: 0,
        panY: 0,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        hoverIndex: -1,
        mouseX: 0,
        mouseY: 0,
        showClusterLabels: true,
        searchQuery: "",
        searchMatches: null,
        searchMatchCount: 0,
      };

      this.renderPending = false;
      this.imageSrcCache = Object.create(null);
      this.cleanupFns = [];
      this.touchState = {
        mode: "none",
        lastX: 0,
        lastY: 0,
        tapStartX: 0,
        tapStartY: 0,
        tapStartTs: 0,
        tapMoved: false,
        pinchDist: 0,
        pinchCx: 0,
        pinchCy: 0,
      };
      this.palette = [
        "#2f80ed", "#27ae60", "#eb5757", "#f2994a", "#9b51e0", "#00a8a8", "#f2c94c", "#56ccf2",
        "#6fcf97", "#bb6bd9", "#f4a261", "#e76f51", "#264653", "#219ebc", "#8ecae6", "#ff7f50",
      ];

      this._prepareLevels();
      this._prepareStablePairMap();
      this._buildSearchIndex();
      this._mount();
    }

    _prepareLevels() {
      this.levels.sort((a, b) => a.n_clusters - b.n_clusters);
      this.levels.forEach((lv, idx) => {
        const byId = Object.create(null);
        const clusters = Array.isArray(lv.clusters) ? lv.clusters : [];
        for (let i = 0; i < clusters.length; i += 1) {
          const c = clusters[i] || {};
          byId[String(c.cluster_id)] = c;
        }
        lv._byId = byId;
        lv._colorById = this._buildLevelColorMap(lv, idx);
      });
    }

    _prepareStablePairMap() {
      this.stablePairMap = Object.create(null);
      const stable = Array.isArray(this.atlas.stablePairs) ? this.atlas.stablePairs : [];
      stable.forEach((rec) => {
        const lo = safeInt(rec.lo, -1);
        const hi = safeInt(rec.hi, -1);
        if (lo < 0 || hi < 0) return;
        const pairs = Array.isArray(rec.pairs) ? rec.pairs : [];
        const loToHi = Object.create(null);
        const hiToLo = Object.create(null);
        pairs.forEach((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return;
          const a = String(safeInt(pair[0], 0));
          const b = String(safeInt(pair[1], 0));
          loToHi[a] = b;
          hiToLo[b] = a;
        });
        this.stablePairMap[`${lo}-${hi}`] = { loToHi, hiToLo };
      });
    }

    _buildLevelColorMap(level, levelIndex) {
      const labels = Array.isArray(level.labels) ? level.labels : [];
      const idSet = new Set();
      labels.forEach((x) => idSet.add(safeInt(x, 0)));
      (level.clusters || []).forEach((c) => idSet.add(safeInt(c.cluster_id, 0)));
      const ids = Array.from(idSet).sort((a, b) => a - b);
      const n = Math.max(1, ids.length);
      const bits = Math.max(1, Math.ceil(Math.log2(n)));

      const order = [];
      for (let i = 0; i < n; i += 1) {
        order.push({ i, rank: this._bitReverse(i, bits) });
      }
      order.sort((a, b) => a.rank - b.rank);
      const slots = order.map((x) => x.i);

      const byId = Object.create(null);
      for (let k = 0; k < n; k += 1) {
        const cid = ids[k];
        const hue = (360 * slots[k]) / n;
        const sat = 78;
        const light = 50 + ((k % 3) - 1) * 6;
        byId[String(cid)] = this._hslToRgb(hue, sat, light);
      }
      if (Object.keys(byId).length === 0) {
        byId["0"] = this._hexToRgb(this.palette[Math.abs(levelIndex) % this.palette.length]);
      }
      return byId;
    }

    _bitReverse(x, bits) {
      let v = x | 0;
      let out = 0;
      for (let i = 0; i < bits; i += 1) {
        out = (out << 1) | (v & 1);
        v >>= 1;
      }
      return out >>> 0;
    }

    _hexToRgb(hex) {
      const h = String(hex || "").replace("#", "").trim();
      if (h.length !== 6) return [47, 128, 237];
      return [
        Number.parseInt(h.slice(0, 2), 16),
        Number.parseInt(h.slice(2, 4), 16),
        Number.parseInt(h.slice(4, 6), 16),
      ];
    }

    _hslToRgb(h, s, l) {
      const hh = ((Number(h) % 360) + 360) % 360;
      const ss = Math.max(0, Math.min(1, Number(s) / 100));
      const ll = Math.max(0, Math.min(1, Number(l) / 100));
      const c = (1 - Math.abs(2 * ll - 1)) * ss;
      const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
      const m = ll - (c * 0.5);
      let r = 0;
      let g = 0;
      let b = 0;
      if (hh < 60) [r, g, b] = [c, x, 0];
      else if (hh < 120) [r, g, b] = [x, c, 0];
      else if (hh < 180) [r, g, b] = [0, c, x];
      else if (hh < 240) [r, g, b] = [0, x, c];
      else if (hh < 300) [r, g, b] = [x, 0, c];
      else [r, g, b] = [c, 0, x];
      return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
      ];
    }

    _clusterColorRgb(levelIndex, clusterId) {
      const lvl = this.levels[levelIndex] || {};
      const map = lvl._colorById || {};
      return map[String(safeInt(clusterId, 0))] || this._hexToRgb(this.palette[Math.abs(safeInt(clusterId, 0)) % this.palette.length]);
    }

    _clusterColor(levelIndex, clusterId, alpha) {
      const rgb = this._clusterColorRgb(levelIndex, clusterId);
      if (alpha >= 0.999) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(4)})`;
    }

    _lerpRgb(a, b, t) {
      const tt = Math.max(0, Math.min(1, Number(t)));
      return [
        Math.round(a[0] + (b[0] - a[0]) * tt),
        Math.round(a[1] + (b[1] - a[1]) * tt),
        Math.round(a[2] + (b[2] - a[2]) * tt),
      ];
    }

    _mount() {
      this.root.innerHTML = [
        '<section class="atlas-viewer">',
        '  <header class="atlas-header">',
        '    <div class="atlas-title">Representation Atlas</div>',
        `    <div class="atlas-chip-row"><span class="atlas-chip">concepts: <strong>${this.points.length}</strong></span></div>`,
        '  </header>',
        '  <section class="atlas-body">',
        '    <canvas class="atlas-canvas"></canvas>',
        '    <div class="atlas-status">ready</div>',
        '    <button class="atlas-label-toggle" type="button">Hide Cluster Labels</button>',
        '    <label class="atlas-search" aria-label="Search concepts">',
        '      <input class="atlas-search-input" type="search" placeholder="Search concepts..." autocomplete="off" spellcheck="false"/>',
        '      <span class="atlas-search-count" hidden></span>',
        "    </label>",
        '    <div class="atlas-tooltip"></div>',
        '  </section>',
        '</section>',
      ].join("");

      this.canvas = this.root.querySelector(".atlas-canvas");
      this.bodyEl = this.root.querySelector(".atlas-body");
      this.statusEl = this.root.querySelector(".atlas-status");
      this.toggleLabelsBtn = this.root.querySelector(".atlas-label-toggle");
      this.searchInput = this.root.querySelector(".atlas-search-input");
      this.searchCountEl = this.root.querySelector(".atlas-search-count");
      this.tooltipEl = this.root.querySelector(".atlas-tooltip");
      this.ctx = this.canvas.getContext("2d");

      this._updateLabelsButton();
      this._updateSearchUi();
      this._bindEvents();
      this._resizeCanvas();
      this._scheduleRender();
    }

    _updateLabelsButton() {
      if (!this.toggleLabelsBtn) return;
      if (this.state.showClusterLabels) {
        this.toggleLabelsBtn.textContent = "Hide Cluster Labels";
        this.toggleLabelsBtn.setAttribute("aria-pressed", "true");
      } else {
        this.toggleLabelsBtn.textContent = "Show Cluster Labels";
        this.toggleLabelsBtn.setAttribute("aria-pressed", "false");
      }
    }

    _buildSearchIndex() {
      this.searchIndex = new Array(this.points.length);
      for (let i = 0; i < this.points.length; i += 1) {
        const p = this.points[i];
        const meta = p && typeof p.metadata === "object" ? p.metadata : {};
        const mainDescription = String(p && p.description ? p.description : "").trim();
        const vlmFallback = String(meta.vlmgrid_explanation || "").trim();
        const text = mainDescription || vlmFallback;
        this.searchIndex[i] = text.toLowerCase();
      }
    }

    _updateSearchUi() {
      if (!this.searchCountEl) return;
      const q = String(this.state.searchQuery || "").trim();
      if (!q) {
        this.searchCountEl.hidden = true;
        this.searchCountEl.textContent = "";
        return;
      }
      const count = Number(this.state.searchMatchCount || 0);
      const label = `${count} match${count === 1 ? "" : "es"}`;
      this.searchCountEl.hidden = false;
      this.searchCountEl.textContent = label;
    }

    _updateSearchMatches(query) {
      const q = String(query || "").trim().toLowerCase();
      this.state.searchQuery = q;

      if (!q) {
        this.state.searchMatches = null;
        this.state.searchMatchCount = 0;
        this._updateSearchUi();
        this._scheduleRender();
        return;
      }

      const n = this.points.length;
      const matches = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i += 1) {
        const hay = this.searchIndex && this.searchIndex[i] ? this.searchIndex[i] : "";
        if (!hay || !hay.includes(q)) continue;
        matches[i] = 1;
        count += 1;
      }

      this.state.searchMatches = matches;
      this.state.searchMatchCount = count;
      this._updateSearchUi();
      this._scheduleRender();
    }

    _on(target, eventName, handler, options) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(eventName, handler, options);
      this.cleanupFns.push(() => target.removeEventListener(eventName, handler, options));
    }

    _bindEvents() {
      const wheelHandler = (ev) => {
        ev.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
        const my = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
        const factor = Math.exp(-ev.deltaY * 0.0012);
        this._zoomAt(mx, my, factor);
      };
      this._on(this.canvas, "wheel", wheelHandler, { passive: false });
      this._on(this.bodyEl, "wheel", wheelHandler, { passive: false });
      this._on(this.root, "wheel", wheelHandler, { passive: false });

      this._on(this.canvas, "mousedown", (ev) => {
        if (ev.button !== 0) return;
        this.state.dragging = true;
        this.state.dragStartX = ev.clientX;
        this.state.dragStartY = ev.clientY;
        this.canvas.classList.add("atlas-dragging");
      });

      this._on(window, "mouseup", () => {
        this.state.dragging = false;
        this.canvas.classList.remove("atlas-dragging");
      });

      this._on(window, "mousemove", (ev) => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        this.state.mouseX = mx;
        this.state.mouseY = my;

        if (this.state.dragging) {
          const dx = ev.clientX - this.state.dragStartX;
          const dy = ev.clientY - this.state.dragStartY;
          this.state.dragStartX = ev.clientX;
          this.state.dragStartY = ev.clientY;
          this.state.panX += dx;
          this.state.panY += dy;
          this._scheduleRender();
          return;
        }

        if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
          this.state.hoverIndex = -1;
          this.tooltipEl.classList.remove("is-visible");
          this._scheduleRender();
          return;
        }

        this._pickHover(mx, my);
        this._scheduleRender();
      });

      this._on(this.canvas, "dblclick", (ev) => {
        ev.preventDefault();
        this.resetView();
      });

      if (this.toggleLabelsBtn) {
        this._on(this.toggleLabelsBtn, "click", () => {
          this.state.showClusterLabels = !this.state.showClusterLabels;
          this._updateLabelsButton();
          this._scheduleRender();
        });
      }

      if (this.searchInput) {
        this._on(this.searchInput, "input", () => {
          this._updateSearchMatches(this.searchInput.value || "");
        });
        this._on(this.searchInput, "keydown", (ev) => {
          if (ev.key !== "Escape") return;
          this.searchInput.value = "";
          this._updateSearchMatches("");
        });
      }

      this._on(this.canvas, "touchstart", (ev) => {
        if (!ev.touches || ev.touches.length === 0) return;

        if (ev.touches.length === 1) {
          const t = ev.touches[0];
          this.state.dragging = false;
          this.canvas.classList.remove("atlas-dragging");
          this.touchState.mode = "pending";
          this.touchState.lastX = t.clientX;
          this.touchState.lastY = t.clientY;
          this.touchState.tapStartX = t.clientX;
          this.touchState.tapStartY = t.clientY;
          this.touchState.tapStartTs = Date.now();
          this.touchState.tapMoved = false;
          return;
        }

        ev.preventDefault();
        const a = ev.touches[0];
        const b = ev.touches[1];
        this.state.dragging = false;
        this.canvas.classList.remove("atlas-dragging");
        this.touchState.mode = "pinch";
        this.touchState.tapMoved = true;
        this.touchState.pinchDist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));
        this.touchState.pinchCx = (a.clientX + b.clientX) * 0.5;
        this.touchState.pinchCy = (a.clientY + b.clientY) * 0.5;
      }, { passive: false });

      this._on(this.canvas, "touchmove", (ev) => {
        if (!ev.touches || ev.touches.length === 0) return;

        if (ev.touches.length === 1) {
          const t = ev.touches[0];
          const dx = t.clientX - this.touchState.lastX;
          const dy = t.clientY - this.touchState.lastY;
          this.touchState.lastX = t.clientX;
          this.touchState.lastY = t.clientY;

          const driftX = t.clientX - this.touchState.tapStartX;
          const driftY = t.clientY - this.touchState.tapStartY;

          if (this.touchState.mode === "scroll") {
            return;
          }

          if (this.touchState.mode === "pending") {
            if (Math.hypot(driftX, driftY) < 3) return;
            if (Math.abs(driftY) > Math.abs(driftX) * 1.15) {
              this.touchState.mode = "scroll";
              this.state.dragging = false;
              this.canvas.classList.remove("atlas-dragging");
              this.state.hoverIndex = -1;
              this.tooltipEl.classList.remove("is-visible");
              return;
            }
            this.touchState.mode = "pan";
            this.state.dragging = true;
            this.canvas.classList.add("atlas-dragging");
            this.touchState.lastX = t.clientX;
            this.touchState.lastY = t.clientY;
            this.touchState.tapMoved = true;
          }

          if (Math.hypot(driftX, driftY) > 8) {
            this.touchState.tapMoved = true;
          }

          if (this.touchState.mode !== "pan") return;
          ev.preventDefault();
          this.state.panX += dx;
          this.state.panY += dy;
          const rect = this.canvas.getBoundingClientRect();
          this.state.mouseX = t.clientX - rect.left;
          this.state.mouseY = t.clientY - rect.top;
          this._scheduleRender();
          return;
        }

        const a = ev.touches[0];
        const b = ev.touches[1];
        ev.preventDefault();
        const cx = (a.clientX + b.clientX) * 0.5;
        const cy = (a.clientY + b.clientY) * 0.5;
        const dist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));

        if (this.touchState.mode !== "pinch") {
          this.touchState.mode = "pinch";
          this.touchState.pinchDist = dist;
          this.touchState.pinchCx = cx;
          this.touchState.pinchCy = cy;
          this.touchState.tapMoved = true;
          return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const mx = cx - rect.left;
        const my = cy - rect.top;
        const factor = this.touchState.pinchDist > 0 ? (dist / this.touchState.pinchDist) : 1;

        this.state.panX += (cx - this.touchState.pinchCx);
        this.state.panY += (cy - this.touchState.pinchCy);
        this.touchState.pinchDist = dist;
        this.touchState.pinchCx = cx;
        this.touchState.pinchCy = cy;

        if (Math.abs(factor - 1) > 0.001) {
          this._zoomAt(mx, my, factor);
        }
        this._scheduleRender();
      }, { passive: false });

      this._on(this.canvas, "touchend", (ev) => {
        if (this.touchState.mode !== "scroll") {
          ev.preventDefault();
        }

        if (!ev.touches || ev.touches.length === 0) {
          this.state.dragging = false;
          this.canvas.classList.remove("atlas-dragging");

          if ((this.touchState.mode === "pending" || this.touchState.mode === "pan") && !this.touchState.tapMoved) {
            const dt = Date.now() - this.touchState.tapStartTs;
            const changed = ev.changedTouches && ev.changedTouches.length > 0 ? ev.changedTouches[0] : null;
            if (changed && dt < 360) {
              const rect = this.canvas.getBoundingClientRect();
              const mx = changed.clientX - rect.left;
              const my = changed.clientY - rect.top;
              this.state.mouseX = mx;
              this.state.mouseY = my;
              this._pickHover(mx, my, 22);
              this._scheduleRender();
            }
          } else {
            this.state.hoverIndex = -1;
            this.tooltipEl.classList.remove("is-visible");
            this._scheduleRender();
          }

          this.touchState.mode = "none";
          return;
        }

        if (ev.touches.length === 1) {
          const t = ev.touches[0];
          this.touchState.mode = "pending";
          this.touchState.lastX = t.clientX;
          this.touchState.lastY = t.clientY;
          this.touchState.tapStartX = t.clientX;
          this.touchState.tapStartY = t.clientY;
          this.touchState.tapStartTs = Date.now();
          this.touchState.tapMoved = true;
          return;
        }

        const a = ev.touches[0];
        const b = ev.touches[1];
        this.touchState.mode = "pinch";
        this.touchState.tapMoved = true;
        this.touchState.pinchDist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));
        this.touchState.pinchCx = (a.clientX + b.clientX) * 0.5;
        this.touchState.pinchCy = (a.clientY + b.clientY) * 0.5;
      }, { passive: false });

      this._on(this.canvas, "touchcancel", () => {
        this.state.dragging = false;
        this.canvas.classList.remove("atlas-dragging");
        this.touchState.mode = "none";
      }, { passive: false });

      if (typeof ResizeObserver !== "undefined") {
        this.ro = new ResizeObserver(() => this._resizeCanvas());
        this.ro.observe(this.canvas);
      }
      this._on(window, "resize", () => this._resizeCanvas());
    }

    resetView() {
      this.state.zoom = 1;
      this.state.panX = 0;
      this.state.panY = 0;
      this._scheduleRender();
    }

    notifyResize() {
      this._resizeCanvas();
    }

    destroy() {
      if (this.ro) {
        this.ro.disconnect();
        this.ro = null;
      }
      for (let i = 0; i < this.cleanupFns.length; i += 1) {
        this.cleanupFns[i]();
      }
      this.cleanupFns = [];
      this.root.innerHTML = "";
    }

    _resizeCanvas() {
      const rect = this.canvas.getBoundingClientRect();
      this.state.w = Math.max(1, Math.floor(rect.width));
      this.state.h = Math.max(1, Math.floor(rect.height));
      this.state.dpr = Math.max(1, Number(window.devicePixelRatio || 1));
      this.canvas.width = Math.floor(this.state.w * this.state.dpr);
      this.canvas.height = Math.floor(this.state.h * this.state.dpr);
      this.ctx.setTransform(this.state.dpr, 0, 0, this.state.dpr, 0, 0);

      const spanX = Math.max(1e-8, this.bounds.max_x - this.bounds.min_x);
      const spanY = Math.max(1e-8, this.bounds.max_y - this.bounds.min_y);
      this.state.baseScale = 0.94 * Math.min(this.state.w / spanX, this.state.h / spanY);
      this.cx = 0.5 * (this.bounds.min_x + this.bounds.max_x);
      this.cy = 0.5 * (this.bounds.min_y + this.bounds.max_y);

      this._scheduleRender();
    }

    _project(x, y) {
      const sx = ((x - this.cx) * this.state.baseScale * this.state.zoom) + (this.state.w * 0.5) + this.state.panX;
      const sy = ((this.cy - y) * this.state.baseScale * this.state.zoom) + (this.state.h * 0.5) + this.state.panY;
      return [sx, sy];
    }

    _unproject(sx, sy) {
      const wx = ((sx - (this.state.w * 0.5) - this.state.panX) / (this.state.baseScale * this.state.zoom)) + this.cx;
      const wy = this.cy - ((sy - (this.state.h * 0.5) - this.state.panY) / (this.state.baseScale * this.state.zoom));
      return [wx, wy];
    }

    _levelBlend() {
      if (this.levels.length <= 1) return { lo: 0, hi: 0, t: 0 };
      const lf = Math.max(0, Math.min(this.levels.length - 1, Math.log2(Math.max(1e-8, this.state.zoom))));
      const lo = Math.floor(lf);
      const hi = Math.min(this.levels.length - 1, lo + 1);
      const t = lf - lo;
      return { lo, hi, t };
    }

    _zoomAt(sx, sy, factor) {
      const prevZoom = this.state.zoom;
      const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, prevZoom * factor));
      if (Math.abs(nextZoom - prevZoom) < 1e-12) return;
      const world = this._unproject(sx, sy);
      this.state.zoom = nextZoom;
      const projected = this._project(world[0], world[1]);
      this.state.panX += sx - projected[0];
      this.state.panY += sy - projected[1];
      this._scheduleRender();
    }

    _scheduleRender() {
      if (this.renderPending) return;
      this.renderPending = true;
      window.requestAnimationFrame(() => {
        this.renderPending = false;
        this._render();
      });
    }

    _drawPoints(levelIndex, alpha) {
      if (alpha <= 0.001) return;
      const lvl = this.levels[levelIndex];
      if (!lvl || !Array.isArray(lvl.labels) || lvl.labels.length !== this.points.length) return;
      const labels = lvl.labels;
      const baseR = this.pointRadius;
      const hasSearch = !!this.state.searchQuery && this.state.searchMatches instanceof Uint8Array;
      const searchMatches = hasSearch ? this.state.searchMatches : null;
      for (let i = 0; i < this.points.length; i += 1) {
        const p = this.points[i];
        const xy = this._project(Number(p.x || 0), Number(p.y || 0));
        const sx = xy[0];
        const sy = xy[1];
        if (sx < -5 || sy < -5 || sx > this.state.w + 5 || sy > this.state.h + 5) continue;

        const isMatch = !hasSearch || searchMatches[i] === 1;
        const radius = hasSearch && isMatch ? (baseR + 1.1) : baseR;
        const pointAlpha = hasSearch
          ? (isMatch ? (this.pointAlpha * alpha) : (0.22 * alpha))
          : (this.pointAlpha * alpha);
        if (pointAlpha <= 0.001) continue;

        this.ctx.fillStyle = (hasSearch && !isMatch)
          ? `rgba(156, 163, 175, ${pointAlpha.toFixed(4)})`
          : this._clusterColor(levelIndex, labels[i], pointAlpha);
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        this.ctx.fill();
        if (hasSearch && isMatch) {
          this.ctx.lineWidth = 0.9;
          this.ctx.strokeStyle = "rgba(15,23,42,0.42)";
          this.ctx.stroke();
        }
      }
    }

    _drawClusterLabelCore(args) {
      const levelPos = Number(args.levelPos || 0);
      const cluster = args.cluster;
      if (!cluster) return;
      const alpha = Number(args.alpha || 0);
      if (alpha <= 0.01) return;

      const sx = Number.isFinite(args.sxOverride)
        ? Number(args.sxOverride)
        : this._project(Number(cluster.centroid_x || 0), Number(cluster.centroid_y || 0))[0];
      const sy = Number.isFinite(args.syOverride)
        ? Number(args.syOverride)
        : this._project(Number(cluster.centroid_x || 0), Number(cluster.centroid_y || 0))[1];

      if (sx < -140 || sy < -30 || sx > this.state.w + 140 || sy > this.state.h + 30) return;

      const fSize = Math.max(10, 18 - levelPos * 1.2);
      this.ctx.font = `700 ${fSize.toFixed(1)}px Sora, sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";

      const text = String(args.text || cluster.description || `Cluster ${cluster.cluster_id}`);
      const label = text.length <= 36 ? text : `${text.slice(0, 33)}...`;
      const rgb = Array.isArray(args.colorRgb)
        ? args.colorRgb
        : this._clusterColorRgb(Math.round(levelPos), Number(cluster.cluster_id || 0));
      const aa = Math.max(0.22, Math.min(1, alpha));

      this.ctx.lineWidth = 5;
      this.ctx.strokeStyle = `rgba(255,255,255,${Math.max(0.55, Math.min(0.95, aa)).toFixed(4)})`;
      this.ctx.strokeText(label, sx, sy + 0.5);

      this.ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0.28, aa).toFixed(4)})`;
      this.ctx.fillText(label, sx, sy + 0.5);
    }

    _drawClusterLabelsSingle(levelIndex, alpha) {
      if (alpha <= 0.01) return;
      const lvl = this.levels[levelIndex];
      if (!lvl || !Array.isArray(lvl.clusters)) return;
      for (let i = 0; i < lvl.clusters.length; i += 1) {
        const c = lvl.clusters[i] || {};
        this._drawClusterLabelCore({
          levelPos: levelIndex,
          cluster: c,
          alpha,
          colorRgb: this._clusterColorRgb(levelIndex, Number(c.cluster_id || i)),
        });
      }
    }

    _drawClusterLabelsBlended(lo, hi, t) {
      if (lo === hi) {
        this._drawClusterLabelsSingle(lo, 1);
        return;
      }

      const pair = this.stablePairMap[`${lo}-${hi}`] || null;
      if (!pair) {
        this._drawClusterLabelsSingle(lo, 1 - t);
        this._drawClusterLabelsSingle(hi, t);
        return;
      }

      const loLvl = this.levels[lo];
      const hiLvl = this.levels[hi];
      if (!loLvl || !hiLvl) {
        this._drawClusterLabelsSingle(lo, 1 - t);
        this._drawClusterLabelsSingle(hi, t);
        return;
      }

      const processedHi = Object.create(null);
      const loClusters = Array.isArray(loLvl.clusters) ? loLvl.clusters : [];
      const hiClusters = Array.isArray(hiLvl.clusters) ? hiLvl.clusters : [];

      for (let i = 0; i < loClusters.length; i += 1) {
        const lc = loClusters[i] || {};
        const loId = String(Number(lc.cluster_id || 0));
        const mappedHiId = pair.loToHi ? pair.loToHi[loId] : undefined;

        if (mappedHiId === undefined) {
          this._drawClusterLabelCore({
            levelPos: lo,
            cluster: lc,
            alpha: 1 - t,
            colorRgb: this._clusterColorRgb(lo, Number(lc.cluster_id || 0)),
          });
          continue;
        }

        const hc = (hiLvl._byId || {})[String(mappedHiId)] || null;
        if (!hc) {
          this._drawClusterLabelCore({
            levelPos: lo,
            cluster: lc,
            alpha: 1 - t,
            colorRgb: this._clusterColorRgb(lo, Number(lc.cluster_id || 0)),
          });
          continue;
        }

        processedHi[String(mappedHiId)] = 1;
        const x = Number(lc.centroid_x || 0) * (1 - t) + Number(hc.centroid_x || 0) * t;
        const y = Number(lc.centroid_y || 0) * (1 - t) + Number(hc.centroid_y || 0) * t;
        const xy = this._project(x, y);
        const rgb = this._lerpRgb(
          this._clusterColorRgb(lo, Number(lc.cluster_id || 0)),
          this._clusterColorRgb(hi, Number(hc.cluster_id || 0)),
          t
        );

        const txtLo = String(lc.description || `Cluster ${lc.cluster_id}`);
        const txtHi = String(hc.description || `Cluster ${hc.cluster_id}`);
        const txt = txtLo === txtHi ? txtLo : (t < 0.5 ? txtLo : txtHi);

        this._drawClusterLabelCore({
          levelPos: lo * (1 - t) + hi * t,
          cluster: lc,
          alpha: 0.96,
          colorRgb: rgb,
          text: txt,
          sxOverride: xy[0],
          syOverride: xy[1],
        });
      }

      for (let i = 0; i < hiClusters.length; i += 1) {
        const hc = hiClusters[i] || {};
        const hiId = String(Number(hc.cluster_id || 0));
        if ((pair.hiToLo && pair.hiToLo[hiId] !== undefined) || processedHi[hiId]) continue;
        this._drawClusterLabelCore({
          levelPos: hi,
          cluster: hc,
          alpha: t,
          colorRgb: this._clusterColorRgb(hi, Number(hc.cluster_id || 0)),
        });
      }
    }

    _drawHoverRing() {
      if (this.state.hoverIndex < 0 || this.state.hoverIndex >= this.points.length) return;
      const p = this.points[this.state.hoverIndex];
      const xy = this._project(Number(p.x || 0), Number(p.y || 0));
      const sx = xy[0];
      const sy = xy[1];
      if (sx < -10 || sy < -10 || sx > this.state.w + 10 || sy > this.state.h + 10) return;
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, this.pointRadius + 3.2, 0, Math.PI * 2);
      this.ctx.lineWidth = 1.8;
      this.ctx.strokeStyle = "rgba(15,23,42,0.85)";
      this.ctx.stroke();
    }

    _pickHover(mouseX, mouseY, pickRadius) {
      const pickR = Number.isFinite(Number(pickRadius)) ? Math.max(2, Number(pickRadius)) : 8.5;
      let best = -1;
      let bestD2 = pickR * pickR;
      for (let i = 0; i < this.points.length; i += 1) {
        const p = this.points[i];
        const xy = this._project(Number(p.x || 0), Number(p.y || 0));
        const dx = xy[0] - mouseX;
        const dy = xy[1] - mouseY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      this.state.hoverIndex = best;
    }

    _escapeHtml(x) {
      return String(x ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    _renderFadedTerm(text, maxChars, fadeChars) {
      const raw = String(text || "");
      if (!raw) return "";
      if (raw.length <= maxChars || maxChars <= 1 || fadeChars < 2 || maxChars <= fadeChars) {
        return this._escapeHtml(raw);
      }
      const headLen = Math.max(1, maxChars - fadeChars);
      const head = raw.slice(0, headLen);
      const tail = raw.slice(headLen, maxChars);
      const denom = Math.max(1, tail.length - 1);
      let html = `<span>${this._escapeHtml(head)}</span>`;
      for (let i = 0; i < tail.length; i += 1) {
        const opacity = Math.max(0, 1 - (i / denom));
        if (opacity <= 0) {
          html += `<span class="atlas-fade-char atlas-fade-stop" style="opacity:0;">${this._escapeHtml(tail[i])}</span>`;
          break;
        }
        html += `<span class="atlas-fade-char" style="opacity:${opacity.toFixed(3)};">${this._escapeHtml(tail[i])}</span>`;
      }
      return html;
    }

    _normalizeTermItem(item) {
      if (!item) return null;
      if (typeof item === "string") {
        const text = item.trim();
        return text ? { text, score: null } : null;
      }
      if (typeof item !== "object") return null;
      const text = String(item.text ?? item.term ?? item.description ?? "").trim();
      if (!text) return null;
      const score = Number(item.score);
      return { text, score: Number.isFinite(score) ? score : null };
    }

    _extractTerms(meta, key, fallbackKey, maxItems = 3) {
      let raw = meta && typeof meta === "object" ? meta[key] : null;
      if (!Array.isArray(raw) && fallbackKey) {
        raw = meta && typeof meta === "object" ? meta[fallbackKey] : null;
      }
      if (!Array.isArray(raw)) return [];
      const limit = maxItems === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(1, safeInt(maxItems, 3));
      const out = [];
      for (let i = 0; i < raw.length; i += 1) {
        const row = this._normalizeTermItem(raw[i]);
        if (row) out.push(row);
        if (out.length >= limit) break;
      }
      return out;
    }

    _formatScore(score) {
      if (score === null || score === undefined || Number.isNaN(Number(score))) return "";
      return `(${Number(score).toFixed(2)})`;
    }

    _renderTermList(items) {
      const safe = Array.isArray(items) ? items : [];
      const rows = [];
      if (safe.length === 0) {
        rows.push('<li class="atlas-exp-item"><span class="atlas-exp-term">N/A</span><span class="atlas-exp-score"></span></li>');
      } else {
        safe.slice(0, 3).forEach((item) => {
          const text = String(item.text || "");
          const term = this._escapeHtml(text);
          const score = this._escapeHtml(this._formatScore(item.score));
          const termHtml = this._renderFadedTerm(text, 44, 12);
          rows.push(`<li class="atlas-exp-item"><span class="atlas-exp-term" title="${term}">${termHtml}</span><span class="atlas-exp-score">${score}</span></li>`);
        });
      }
      while (rows.length < 3) {
        rows.push('<li class="atlas-exp-item atlas-exp-item-empty"><span class="atlas-exp-term">_</span><span class="atlas-exp-score"></span></li>');
      }
      return rows.join("");
    }

    _resolveImageSource(item) {
      if (!item) return "";

      if (typeof item === "string") {
        const s = item.trim();
        if (!s) return "";
        if (s.startsWith("data:image/") || s.startsWith("http://") || s.startsWith("https://") || s.startsWith("/")) {
          return s;
        }
        if (this.imageSrcCache[s]) return this.imageSrcCache[s];
        const rec = this.imageStore[s];
        if (rec && rec.data_b64) {
          const src = `data:${rec.mime};base64,${rec.data_b64}`;
          this.imageSrcCache[s] = src;
          return src;
        }
        return s;
      }

      if (typeof item !== "object") return "";
      const direct = String(item.src || item.image || item.image_url || item.data_uri || item.data_url || "").trim();
      if (direct) return direct;

      const ref = item.image_ref ?? item.imageRef ?? item.ref ?? item.row_index;
      if (ref === null || ref === undefined) return "";
      const key = String(ref);
      if (this.imageSrcCache[key]) return this.imageSrcCache[key];
      const rec = this.imageStore[key];
      if (!rec || !rec.data_b64) return "";
      const src = `data:${rec.mime};base64,${rec.data_b64}`;
      this.imageSrcCache[key] = src;
      return src;
    }

    _renderTopImages(images) {
      const safe = Array.isArray(images) ? images.slice(0, 4) : [];
      const cells = [];
      for (let i = 0; i < 4; i += 1) {
        const src = this._resolveImageSource(safe[i]);
        if (src) {
          cells.push(`<div class="atlas-thumb" title="Top image #${i + 1}"><img src="${this._escapeHtml(src)}" alt="top-${i + 1}"/></div>`);
        } else {
          cells.push('<div class="atlas-thumb"><div class="atlas-thumb-empty">-</div></div>');
        }
      }
      return cells.join("");
    }

    _showTooltip(mouseX, mouseY) {
      if (this.state.hoverIndex < 0 || this.state.hoverIndex >= this.points.length) {
        this.tooltipEl.classList.remove("is-visible");
        return;
      }

      const p = this.points[this.state.hoverIndex];
      const meta = p && typeof p.metadata === "object" ? p.metadata : {};
      const descriptionRaw = String(meta.vlmgrid_explanation || p.description || "N/A");
      const clipTerms = this._extractTerms(meta, "top_explanations_clipdissect", "clip_dissect_explanations");
      const invertTerms = this._extractTerms(meta, "top_explanations_invert", "invert_explanations");
      const topImagesHtml = this._renderTopImages(meta.top_activating_images);

      this.tooltipEl.innerHTML = [
        '<article class="atlas-tooltip-card">',
        '  <div class="atlas-card-head">',
        `    <div class="atlas-card-title">Concept #${this._escapeHtml(p.concept_id)}</div>`,
        `    <div class="atlas-card-subtitle" title="${this._escapeHtml(descriptionRaw)}">${this._renderFadedTerm(descriptionRaw, 52, 12)}</div>`,
        "  </div>",
        '  <div class="atlas-exp-grid">',
        '    <section class="atlas-exp-block">',
        '      <div class="atlas-exp-title">INVERT</div>',
        `      <ul class="atlas-exp-list">${this._renderTermList(invertTerms)}</ul>`,
        "    </section>",
        '    <section class="atlas-exp-block">',
        '      <div class="atlas-exp-title">CLIP-Dissect</div>',
        `      <ul class="atlas-exp-list">${this._renderTermList(clipTerms)}</ul>`,
        "    </section>",
        "  </div>",
        '  <section class="atlas-top-images">',
        '    <div class="atlas-top-images-label">Top Activating Images</div>',
        `    <div class="atlas-top-images-row">${topImagesHtml}</div>`,
        "  </section>",
        "</article>",
      ].join("");

      const rect = this.root.getBoundingClientRect();
      const tw = this.tooltipEl.offsetWidth || 320;
      const th = this.tooltipEl.offsetHeight || 180;
      let tx = mouseX + 14;
      let ty = mouseY + 14;
      if (tx + tw > rect.width - 8) tx = mouseX - tw - 14;
      if (ty + th > rect.height - 8) ty = mouseY - th - 14;
      tx = Math.max(8, tx);
      ty = Math.max(8, ty);
      this.tooltipEl.style.left = `${tx}px`;
      this.tooltipEl.style.top = `${ty}px`;
      this.tooltipEl.classList.add("is-visible");
    }

    _render() {
      this.ctx.clearRect(0, 0, this.state.w, this.state.h);

      const blend = this._levelBlend();
      this._drawPoints(blend.lo, 1 - blend.t);
      if (blend.hi !== blend.lo) this._drawPoints(blend.hi, blend.t);
      if (this.state.showClusterLabels) {
        this._drawClusterLabelsBlended(blend.lo, blend.hi, blend.t);
      }
      this._drawHoverRing();

      const activeLevel = blend.t < 0.5 ? blend.lo : blend.hi;
      const activeClusters = Number((this.levels[activeLevel] || {}).n_clusters || 0);
      this.statusEl.textContent = `zoom ${this.state.zoom.toFixed(2)}x | level ${activeLevel + 1}/${this.levels.length} | clusters ${activeClusters}`;

      this._showTooltip(this.state.mouseX, this.state.mouseY);
    }
  }

  async function loadAtlasIfNeeded() {
    if (!dom.atlasRoot) return;

    const model = appState.model || "clip";
    if (appState.atlasModel && appState.atlasModel !== model) {
      if (appState.atlasViewer) {
        appState.atlasViewer.destroy();
        appState.atlasViewer = null;
      }
      appState.atlas = null;
      appState.atlasModel = null;
    }

    if (appState.atlas && appState.atlasViewer && appState.atlasModel === model) {
      clearLoadingState();
      if (dom.atlasError) dom.atlasError.hidden = true;
      appState.atlasViewer.notifyResize();
      return;
    }
    if (appState.atlasLoading) return;

    appState.atlasLoading = true;
    setLoadingStage("download", 0, 0);

    try {
      const urls = atlasUrlCandidates(model);
      if (!urls.length) {
        throw new Error(`No atlas URL configured for model "${model}".`);
      }

      let payloadText = null;
      const failures = [];
      for (let i = 0; i < urls.length; i += 1) {
        const url = urls[i];
        try {
          payloadText = await fetchAtlasPayload(url, setLoadingStage);
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${url}: ${message}`);
        }
      }

      if (payloadText == null) {
        throw new Error(
          `Failed to load atlas for model "${model}". Tried:\n${failures.join("\n")}`
        );
      }

      setLoadingStage("parse", 0, 0);
      const raw = JSON.parse(payloadText);
      setLoadingStage("normalize", 0, 0);
      const atlas = normalizeAtlas(raw);
      appState.atlas = atlas;
      appState.atlasModel = model;

      if (appState.atlasViewer) {
        appState.atlasViewer.destroy();
        appState.atlasViewer = null;
      }

      setLoadingStage("render", 0, 0);
      appState.atlasViewer = new AtlasViewer(dom.atlasRoot, atlas);
      if (dom.atlasError) {
        dom.atlasError.hidden = true;
        dom.atlasError.textContent = "";
      }
      clearLoadingState();
    } catch (err) {
      console.error(err);
      setErrorState(err instanceof Error ? err.message : String(err));
    } finally {
      appState.atlasLoading = false;
    }
  }

  async function loadGlobalIfNeeded() {
    if (!dom.globalRoot) return;
    const model = String(appState.model || "");
    if (!model) return;
    if (appState.globalLoading) return;

    const selected = currentGlobalTarget();
    if (!selected) {
      setStep("target");
      return;
    }
    if (!selected.gexpUrl) {
      setGlobalErrorState("Selected target does not have a .gexp file.");
      return;
    }

    const renderKey = `${model}:${selected.key}`;
    if (renderKey === appState.globalRenderKey) {
      clearGlobalLoadingState();
      if (dom.globalError) {
        dom.globalError.hidden = true;
        dom.globalError.textContent = "";
      }
      return;
    }

    appState.globalLoading = true;
    setGlobalLoadingStage("download", 0, 0);
    if (dom.globalRoot) dom.globalRoot.innerHTML = "";

    try {
      const url = String(selected.gexpUrl || "");
      let payload = appState.globalPayloadByUrl[url] || null;
      if (!payload) {
        const payloadText = await fetchGlobalPayload(url, setGlobalLoadingStage);
        setGlobalLoadingStage("parse", 0, 0);
        const raw = JSON.parse(payloadText);
        payload = normalizeGlobalPayload(raw);
        appState.globalPayloadByUrl[url] = payload;
      }
      setGlobalLoadingStage("render", 0, 0);
      dom.globalRoot.innerHTML = renderGlobalViewer(payload, selected);
      setupGlobalConceptHover(dom.globalRoot);
      appState.globalRenderKey = renderKey;
      if (dom.globalError) {
        dom.globalError.hidden = true;
        dom.globalError.textContent = "";
      }
      clearGlobalLoadingState();
    } catch (err) {
      console.error(err);
      setGlobalErrorState(err instanceof Error ? err.message : String(err));
    } finally {
      appState.globalLoading = false;
    }
  }

  function bindEvents() {
    dom.modelCards.forEach((card) => {
      card.addEventListener("click", () => {
        const nextModel = normalizeChoice(card.getAttribute("data-model"), VALID_MODELS);
        if (!nextModel) return;
        appState.model = nextModel;
        appState.method = null;
        appState.globalTargetKey = null;
        appState.globalRenderKey = null;
        updateSelectionSummary();
        setStep("method");
      });
    });

    dom.methodCards.forEach((card) => {
      card.addEventListener("click", () => {
        appState.method = normalizeMethodKey(card.getAttribute("data-method")) || "atlas";
        appState.globalRenderKey = null;
        updateSelectionSummary();
        if (appState.method === "global") {
          setStep("target");
        } else {
          setStep("atlas");
        }
      });
    });

    if (dom.globalTargetGrid) {
      dom.globalTargetGrid.addEventListener("click", (ev) => {
        const btn = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest("[data-target-key]")
          : null;
        if (!btn) return;
        const key = String(btn.getAttribute("data-target-key") || "").trim();
        if (!key) return;
        appState.globalTargetKey = key;
        appState.globalRenderKey = null;
        updateSelectionSummary();
        renderGlobalTargetCards(currentGlobalTargets());
        setStep("atlas");
      });
    }

    dom.goButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = btn.getAttribute("data-go");
        if (!step) return;
        if (step === "model") {
          appState.model = null;
          appState.method = null;
          appState.globalTargetKey = null;
          appState.globalRenderKey = null;
        } else if (step === "method") {
          appState.method = null;
          appState.globalTargetKey = null;
          appState.globalRenderKey = null;
        } else if (step === "target") {
          appState.globalRenderKey = null;
        }
        updateSelectionSummary();
        setStep(step);
      });
    });

    if (dom.resetViewBtn) {
      dom.resetViewBtn.addEventListener("click", () => {
        if (appState.method === "atlas" && appState.atlasViewer) appState.atlasViewer.resetView();
      });
    }

    if (dom.atlasRoot) {
      const panel = dom.atlasRoot.closest(".atlas-panel");
      if (panel) {
        panel.addEventListener("wheel", (ev) => {
          if (appState.step !== "atlas") return;
          ev.preventDefault();
        }, { passive: false });
      }
    }

    window.addEventListener("popstate", () => {
      const nextStep = applyUrlState();
      updateSelectionSummary();
      setStep(nextStep, { syncUrl: false });
    });
  }

  bindEvents();
  const initialStep = applyUrlState();
  updateSelectionSummary();
  setStep(initialStep, { syncUrl: true });
})();
