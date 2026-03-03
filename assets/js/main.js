(function () {
  "use strict";

  const MODEL_CONFIG = Object.freeze({
    clip: Object.freeze({
      label: "CLIP RN50",
      atlasUrls: Object.freeze([
        "assets/data/concept_atlas_clip_qwen_gpus_4567.atlas.gz",
      ]),
    }),
    densenet161: Object.freeze({
      label: "DenseNet161",
      atlasUrls: Object.freeze([
        "assets/data/concept_atlas_densenet161_qwen_gpus_4567.atlas.gz",
      ]),
    }),
    resnet18: Object.freeze({
      label: "ResNet18",
      atlasUrls: Object.freeze([
        "assets/data/concept_atlas_resnet18_qwen_gpus_4567.atlas.gz",
      ]),
    }),
  });

  const VALID_MODELS = new Set(Object.keys(MODEL_CONFIG));
  const VALID_METHODS = new Set(["atlas"]);

  const appState = {
    step: "model",
    model: null,
    method: null,
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
    atlasRoot: document.getElementById("atlas-root"),
    atlasLoading: document.getElementById("atlas-loading"),
    atlasError: document.getElementById("atlas-error"),
    resetViewBtn: document.querySelector('[data-action="reset-view"]'),
  };

  function normalizeChoice(value, allowed) {
    const key = String(value || "").trim().toLowerCase();
    if (!key || !allowed.has(key)) return null;
    return key;
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

  function setUiMode(step) {
    const atlasMode = step === "atlas";
    document.body.classList.toggle("mode-atlas", atlasMode);
    document.body.classList.toggle("mode-select", !atlasMode);
    document.body.classList.remove("step-model", "step-method", "step-atlas");
    document.body.classList.add(`step-${step}`);
  }

  function updateUrlState() {
    const params = new URLSearchParams();
    if (appState.model) params.set("model", appState.model);
    if (appState.method) params.set("method", appState.method);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(
      { model: appState.model, method: appState.method, step: appState.step },
      "",
      next
    );
  }

  function applyUrlState() {
    const params = new URLSearchParams(window.location.search || "");
    const model = normalizeChoice(params.get("model"), VALID_MODELS);
    const method = normalizeChoice(params.get("method"), VALID_METHODS);
    appState.model = model;
    appState.method = model ? method : null;
    if (appState.model && appState.method) return "atlas";
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

    if (syncUrl) updateUrlState();
    updateSelectionSummary();

    if (step === "atlas") {
      void loadAtlasIfNeeded();
      window.setTimeout(() => {
        if (appState.step === "atlas" && appState.atlasViewer) {
          appState.atlasViewer.notifyResize();
        }
      }, 520);
    }
  }

  function updateSelectionSummary() {
    if (!dom.selectionSummary) return;
    const model = modelLabel(appState.model);
    const method = appState.method ? String(appState.method).toUpperCase() : "-";
    dom.selectionSummary.textContent = `Model: ${model} | Method: ${method}`;
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

  async function fetchAtlasPayload(url, onStage) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) {
      throw new Error(`Failed to load atlas (${response.status} ${response.statusText})`);
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
        "Your browser does not support gzip streaming for .atlas.gz files. Use a modern Chromium/Firefox, or host an uncompressed .atlas file."
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

  function bindEvents() {
    dom.modelCards.forEach((card) => {
      card.addEventListener("click", () => {
        const nextModel = normalizeChoice(card.getAttribute("data-model"), VALID_MODELS);
        if (!nextModel) return;
        appState.model = nextModel;
        appState.method = null;
        updateSelectionSummary();
        setStep("method");
      });
    });

    dom.methodCards.forEach((card) => {
      card.addEventListener("click", () => {
        appState.method = normalizeChoice(card.getAttribute("data-method"), VALID_METHODS) || "atlas";
        updateSelectionSummary();
        setStep("atlas");
      });
    });

    dom.goButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = btn.getAttribute("data-go");
        if (!step) return;
        if (step === "model") {
          appState.model = null;
          appState.method = null;
        } else if (step === "method") {
          appState.method = null;
        }
        updateSelectionSummary();
        setStep(step);
      });
    });

    if (dom.resetViewBtn) {
      dom.resetViewBtn.addEventListener("click", () => {
        if (appState.atlasViewer) appState.atlasViewer.resetView();
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
