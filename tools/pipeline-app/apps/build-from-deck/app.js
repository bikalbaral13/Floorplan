/* Build from Deck — the pipeline's app, shown as tabs in the editor (pipeline.run { pipeline: "build-from-deck", code }).
   The user uploads the deck, answers the questions and approves each step; script stages run on the runner
   (tools/runner/worker.mjs) through jobs/<STAGE>.json; Claude writes the judgement files (curated brief, trace,
   resolve) into steps/ through the connector. Everything lives in R2 under Projects/<CODE>/ — this page only reads
   it (pipeline.read / list / url) and queues jobs (pipeline.job). Store: answers/main (the user's answers).
   0.2: five stages, each one skill — S1 Brief (Deck Reader) · S2 Plan (Floorplan Tracer) · S3 Objects (Object
   Resolver) · S4 Fit-out (Floorplan Improver) · S5 3D (Floorplan Renderer). Every stage tab opens with its live
   progress card: stages/<Sn>/progress.json (the runner, from the scripts' @@progress lines) + agent-progress.json
   (Claude, during its own steps), checked every 3 s while the stage runs. The user approves each stage in the
   editor's step bar; the runner refuses a stage until the one before it is approved (run.json). */
(function () {
  "use strict";
  var P = window.pipeline;
  var DIR = P.dir || "3-build/build-from-deck/";
  var STEPS = DIR + "steps/";
  var TABS = [
    { id: "brief", label: "S1 Brief" }, { id: "plan", label: "S2 Plan" },
    { id: "objects", label: "S3 Objects" }, { id: "fitout", label: "S4 Fit-out" }, { id: "3d", label: "S5 3D" },
    { id: "runner", label: "Runner" },
  ];
  // the five stages: which tab shows them, the skill, and the step-bar step the user approves
  var GROUPS = [
    { id: "S1", tab: "brief", title: "Read", skill: "Deck Reader", gate: "brief" },
    { id: "S2", tab: "plan", title: "Design", skill: "live on the canvas", gate: "plan" },
    { id: "S3", tab: "3d", title: "3D", skill: "in the editor", gate: "3d" },
  ];
  // what each script stage needs before it can run, and who makes it
  var ROOM = "S5_COMPOSE/" + P.project + ".room.canvas.json";
  var STAGES = {
    S1_INTAKE: { group: "S1", step: "INTAKE", title: "Read the deck", needs: [] },
    S1_PANELS: { group: "S1", step: "PANELS", title: "Cut the image's panels (image decks)", needs: [{ file: "S1_INTAKE/panels.json", who: "Claude" }] },
    S1_DRAFT: { group: "S1", step: "DRAFT", title: "Draft the brief", needs: [{ file: "S1_INTAKE/deck.json", who: "S1 intake" }] },
    S1_FINALIZE: { group: "S1", step: "FINALIZE", title: "Finalize the brief", needs: [{ file: "S2_BRIEF/roombrief.draft.json", who: "S1 draft" }, { file: "S2_BRIEF/roombrief.curated.json", who: "Claude" }] },
  };
  var crops = [], usage = null, jobs = {}, files = new Set(), answers = {}, questions = null, decks = [], chosenDeck = null, active = "brief";
  var pOpen = {}, progress = {}, agentProg = {}, runDoc = null, checked = {}, lastPoll = 0;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var readJson = function (rel) { return P.read(rel).then(function (t) { return JSON.parse(t); }, function () { return null; }); };

  // ── the stage tree (0.6): one panel, every stage a node like the Library tree; its row shows state, what is
  // happening and the percent; open it for its sub-steps. No top tabs: the step bar's "open step" (PIPELINE_UI.tab)
  // and the first stage not yet approved open their node by themselves.
  function node(id) { return document.querySelector('details.node[data-panel="' + id + '"]'); }
  function isOpen(id) { var n = node(id); return !!(n && n.open); }
  function show(id) {
    active = id;
    var n = node(id);
    if (n) { n.open = true; setTimeout(function () { n.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50); }
    document.querySelectorAll("details.node").forEach(function (d) { d.classList.toggle("cur", d === n); });
    refresh();
  }
  document.querySelectorAll("details.node").forEach(function (d) {
    var k = "bfd.node." + d.dataset.panel;
    try { var v = localStorage.getItem(k); if (v != null) d.open = v === "1"; } catch (e) {}
    d.addEventListener("toggle", function () { try { localStorage.setItem(k, d.open ? "1" : "0"); } catch (e) {} if (d.open) refresh(); });
  });
  // the stage the run is on: the first whose gate the user has not approved
  var focused = false;
  function focusCurrent() {
    if (focused || !runDoc) return;
    focused = true;
    var g = GROUPS.filter(function (x) { return !approvedAt(x.gate); })[0] || GROUPS[GROUPS.length - 1];
    show(g.tab);
  }
  window.PIPELINE_UI = { tab: show };

  // ── R2 state ──
  function loadFiles() {
    return P.list(STEPS).then(function (l) { files = new Set(l); }, function () { files = new Set(); });
  }
  function loadJobs() {
    var ks = Object.keys(STAGES);
    return Promise.all(ks.map(function (s) { return readJson(DIR + "jobs/" + s + ".json"); })).then(function (js) {
      js.forEach(function (j, i) { if (j) jobs[ks[i]] = j; else delete jobs[ks[i]]; });
    });
  }
  function loadDecks() {
    return P.list("inputs/decks/").then(function (l) {
      decks = l.filter(function (f) { return /\.(pptx|pdf|png|jpe?g|webp)$/i.test(f); }).sort();
      if (!chosenDeck || decks.indexOf(chosenDeck) < 0) chosenDeck = decks[decks.length - 1] || null;
    }, function () { decks = []; });
  }

  // ── a stage card: status, log, Run ──
  function argsFor(stage) {
    if (stage === "S1_INTAKE") return chosenDeck ? { deck: "inputs/decks/" + chosenDeck } : null;
    if (stage === "S1_DRAFT") {
      if (!questions || !answers.room) return null;
      var q = (questions.questions || []).filter(function (x) { return x.key === "room"; })[0];
      var r = q && q.room_ids && q.room_ids[answers.room];
      return r ? { project: r.project, room: r.room } : null;
    }
    if (stage === "S1_PANELS") {   // crop only the floorplan the user chose
      var rq = questions && (questions.questions || []).filter(function (x) { return x.key === "room"; })[0];
      var rr = rq && rq.room_ids && answers.room && rq.room_ids[answers.room];
      return rr && rr.board ? { board: rr.board } : questions && (questions.projects || []).length > 1 ? null : {};
    }
    return {};
  }
  function missing(stage) {
    return STAGES[stage].needs.filter(function (n) { return !files.has(n.file); });
  }
  function renderStage(el) {
    var s = el.dataset.stage, j = jobs[s], miss = missing(s), args = argsFor(s);
    var st = j ? j.status : "not run";
    var cls = st === "done" ? "ok" : st === "failed" ? "bad" : st === "queued" || st === "running" ? "warn" : "";
    var why = miss.length ? "waiting for " + miss.map(function (m) { return m.who + " (" + m.file.split("/").pop() + ")"; }).join(", ")
      : args === null ? (s === "S1_INTAKE" ? "upload or choose a deck" : "answer the Questions first") : "";
    var busy = st === "queued" || st === "running";
    var stale = st === "queued" && Date.now() - Date.parse(j.queued) > 60000;
    el.innerHTML = '<div class="head"><span class="name">' + esc(s) + " · " + esc(STAGES[s].title) + '</span><span class="pill ' + cls + '">' + esc(st) + "</span>" +
      '<button type="button" data-run="' + s + '"' + (busy || why ? " disabled" : "") + ">" + (j ? "Run again" : "Run") + "</button>" +
      (why ? '<span class="muted">' + esc(why) + "</span>" : "") + (stale ? '<span class="pill warn">no runner has picked it up — is it running?</span>' : "") + "</div>" +
      (j && j.error ? '<div class="next" style="color:#b91c1c">' + esc(j.error) + "</div>" : "") +
      (j && /not approved on this runner/.test(j.error || "") ? '<div class="approve-hint"><b>The runner needs your approval for the new release.</b> On the runner machine run <code>node tools/runner/worker.mjs approve ' + esc(j.pipeline || "build-from-deck") + '</code>, type <b>yes</b> at the end (the last line must say "approved …"), then Run again.</div>' : "") +
      (j && j.next && st === "done" ? '<div class="next">Next: ' + esc(j.next) + "</div>" : "") +
      (j && j.log ? "<details" + (st === "failed" ? " open" : "") + "><summary class=\"muted\">log</summary><pre>" + esc(String(j.log).split("\n").slice(-40).join("\n")) + "</pre></details>" : "");
  }
  document.addEventListener("click", function (e) {
    var ra = e.target.closest && e.target.closest("[data-reapprove]");
    if (ra) {
      var g = GROUPS.filter(function (x) { return x.id === ra.dataset.reapprove; })[0];
      ra.disabled = true;
      P.emit("reapprove", { stage: g.id, gate: g.gate, at: new Date().toISOString() });
      P.notify(g.id + " " + g.title + " re-approved", "success");
      setTimeout(function () { loadProgress(true).then(refresh); }, 1500);
      return;
    }
    var b = e.target.closest && e.target.closest("[data-run]");
    if (!b) return;
    var s = b.dataset.run;
    b.disabled = true;
    P.job(s, argsFor(s) || {}).then(function () { jobs[s] = { status: "queued", queued: new Date().toISOString() }; refresh(); }, function (err) { alert("Could not queue " + s + ": " + (err && err.message || err)); b.disabled = false; });
  });

  // ── deck tab ──
  var drop = $("#drop"), fileIn = $("#file");
  // Host v1 editors upload any size straight to R2; an older editor only takes ~4 MB through its server.
  var ANY_SIZE = ((P.host && P.host.capabilities) || []).indexOf("upload-any-size") >= 0;
  var OLD_MAX = 4 * 1024 * 1024;
  var WHY = {
    cors: "the storage bucket does not accept uploads from this site yet (its CORS rule). Claude can check with session.doctor and give you an upload link meanwhile.",
    token: "this browser has no library token (Preferences ▸ Cloud Library). Or ask Claude for an upload link.",
    expired: "the upload permission expired — ask Claude for a new upload link.",
  };
  function upload(f) {
    if (!/\.(pptx|pdf|png|jpe?g|webp)$/i.test(f.name)) { $("#upload-state").textContent = "Only .pptx, .pdf or an image (.png .jpg .webp)"; return; }
    if (!ANY_SIZE && f.size > OLD_MAX) {
      $("#upload-state").textContent = f.name + " is " + (f.size / 1e6).toFixed(1) + " MB — this editor version takes 4 MB at most. Ask Claude for an upload link (project.upload_link).";
      try { P.emit("deck_too_large", { name: f.name, bytes: f.size, limit: OLD_MAX }); } catch (e) {}
      return;
    }
    var mb = (f.size / 1e6).toFixed(1);
    $("#upload-state").textContent = "Uploading " + f.name + " (" + mb + " MB)…";
    P.assets.upload(f, { name: f.name, target: "inputs/decks", type: f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : /\.png$/i.test(f.name) ? "image/png" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : /\.webp$/i.test(f.name) ? "image/webp" : "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
      onProgress: function (n, t) { $("#upload-state").textContent = "Uploading " + f.name + " — " + Math.round(n / (t || 1) * 100) + "% of " + mb + " MB"; } })
      .then(function (r) {
        $("#upload-state").textContent = "Saved to " + (r.key || "inputs/decks/");
        chosenDeck = String(r.key || "").split("/").pop() || chosenDeck;
        P.emit("deck_uploaded", { key: r.key, name: f.name, bytes: f.size });
        return loadDecks().then(refresh);
      }, function (err) {
        var code = err && err.code, msg = String(err && err.message || err);
        $("#upload-state").textContent = "Upload failed: " + (WHY[code] || msg);
        try { P.emit("deck_upload_failed", { name: f.name, bytes: f.size, reason: code || "", error: msg }); } catch (e) {}
      });
  }
  fileIn.addEventListener("change", function () { if (fileIn.files[0]) upload(fileIn.files[0]); });
  ["dragover", "dragenter"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (f) upload(f); });
  $("#decks").addEventListener("change", function (e) { if (e.target.name === "deck") { chosenDeck = e.target.value; refresh(); } });
  function renderDeck() {
    $("#decks").innerHTML = decks.length ? decks.map(function (d) {
      return '<label><input type="radio" name="deck" value="' + esc(d) + '"' + (d === chosenDeck ? " checked" : "") + "> " + esc(d) + "</label>";
    }).join("") : '<div class="empty">No deck uploaded yet.</div>';
    var pics = [].concat(Array.from(files).filter(function (f) { return /^S1_INTAKE\/pages\/.+\.png$/.test(f); }).sort());
    if (!pics.length) pics = Array.from(files).filter(function (f) { return /^S1_INTAKE\/images\//.test(f); }).sort().slice(0, 24);
    if ($("#pages")) $("#pages").innerHTML = pics.map(function (f) { var u = P.url(STEPS + f); return '<a href="' + u + '" target="_blank"><img src="' + u + '"><span>' + esc(f.split("/").pop()) + "</span></a>"; }).join("");
  }

  // ── questions tab ──
  // the main input beside the questions (what the floorplan / room options refer to), and the crops filed in inputs/
  function renderSource() {
    var pages = Array.from(files).filter(function (f) { return /^S1_INTAKE\/pages\/.+\.png$/.test(f); }).sort();
    $("#qsource").innerHTML = pages.length ? pages.slice(0, 6).map(function (f) { var u = P.url(STEPS + f); return '<a href="' + u + '" target="_blank"><img src="' + u + '"><span>' + esc(chosenDeck || f.split("/").pop()) + "</span></a>"; }).join("") : "";
    $("#crops").innerHTML = crops.length ? '<h3>3 · Cropped into inputs/images/ (' + crops.length + ')</h3>' + crops.map(function (f) {
      var u = P.url("inputs/images/" + f), parts = f.split("/");
      return '<a href="' + u + '" target="_blank" title="' + esc(f) + '"><img src="' + u + '"><span>' + esc(parts.slice(-2).join(" / ").replace(/\.png$/, "")) + "</span></a>";
    }).join("") : "";
  }
  function renderQuestions() {
    renderSource();
    var form = $("#qform");
    if (!questions) { form.innerHTML = '<div class="empty">The questions appear after S1 reads the deck.</div>'; $("#qsave").disabled = true; return; }
    if (form.dataset.for === JSON.stringify(questions.questions)) return;   // keep what the user is typing
    form.dataset.for = JSON.stringify(questions.questions);
    $("#qsave").disabled = false;
    form.innerHTML = (questions.questions || []).map(function (q) {
      var v = answers[q.key] != null ? answers[q.key] : q.default != null ? q.default : "";
      var input = q.type === "select" ? '<select name="' + esc(q.key) + '">' + (q.options || []).map(function (o) { return "<option" + (o === v ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>"
        : q.type === "number" ? '<input type="number" name="' + esc(q.key) + '" value="' + esc(v) + '">'
        : '<input type="text" name="' + esc(q.key) + '" value="' + esc(v) + '">';
      return "<label>" + esc(q.label) + input + (q.why ? '<span class="why">' + esc(q.why) + "</span>" : "") + "</label>";
    }).join("");
  }
  $("#qsave").addEventListener("click", function () {
    var data = {};
    new FormData($("#qform")).forEach(function (v, k) { data[k] = v; });
    (questions.questions || []).forEach(function (q) { if (q.type === "number" && data[q.key] !== "") data[q.key] = Number(data[q.key]); });
    data.saved = new Date().toISOString();
    P.db.doc("answers/main").set(data).then(function () {
      answers = data; $("#qstate").textContent = "Saved — Claude can continue.";
      P.emit("answers", data); refresh();
    }, function (err) { $("#qstate").textContent = "Not saved: " + (err && err.message || err); });
  });

  // ── result tabs ──
  function table(rows, cols) {
    if (!rows || !rows.length) return '<div class="empty">Nothing yet.</div>';
    return "<table><tr>" + cols.map(function (c) { return "<th>" + esc(c[0]) + "</th>"; }).join("") + "</tr>" +
      rows.map(function (r) { return "<tr>" + cols.map(function (c) { var v = c[1](r); return "<td>" + esc(typeof v === "object" ? JSON.stringify(v) : v) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
  }
  function imgs(prefix, rx) {
    var fs = Array.from(files).filter(function (f) { return f.indexOf(prefix) === 0 && rx.test(f); }).sort();
    return fs.length ? fs.map(function (f) { var u = P.url(STEPS + f); return '<a href="' + u + '" target="_blank"><img src="' + u + '"><span>' + esc(f.split("/").pop()) + "</span></a>"; }).join("") : '<div class="empty">Nothing yet.</div>';
  }
  // ── S2 Plan: four sub-steps on the live canvas, each with the user's input saved in the store (s2/<key>) ──
  // Claude puts the plan crop on the canvas as an overlay, traces walls / doors / windows, then the objects; after
  // each the user says "looks right" or asks for changes here. Claude reads the docs (pipeline.events, type "s2").
  var S2 = {
    order: ["UNDERLAY", "SCALE", "WALLS", "WALLS_OK", "OBJECTS", "OBJECTS_OK", "MATERIALS", "MATERIALS_OK", "MORE", "APPROVE"],
    kinds: { UNDERLAY: "agent", SCALE: "user", WALLS: "agent", WALLS_OK: "user", OBJECTS: "agent", OBJECTS_OK: "user", MATERIALS: "agent", MATERIALS_OK: "user", MORE: "user", APPROVE: "user" },
    titles: { UNDERLAY: "Claude puts the plan on the canvas as an overlay", SCALE: "Scale reference and north bearing", WALLS: "Claude traces walls, doors and windows",
      WALLS_OK: "Check the walls, doors and windows", OBJECTS: "Claude places the library objects", OBJECTS_OK: "Check the objects",
      MATERIALS: "Claude binds the materials and finishes", MATERIALS_OK: "Check the materials", MORE: "Lighting, new objects, improvements", APPROVE: "The user approves the design" },
    weights: { UNDERLAY: 10, WALLS: 30, OBJECTS: 30, MATERIALS: 20, MORE: 10 },
    docs: { SCALE: "s2/scale", WALLS_OK: "s2/walls", OBJECTS_OK: "s2/objects", MATERIALS_OK: "s2/materials", MORE: "s2/more" },
  };
  var docs = {};
  // ── S3 3D: the editor's own export (window.pipeline.export3d) — the live 3D scene → output/<CODE>.glb + snapshots ──
  var S3 = { order: ["EXPORT", "APPROVE"], kinds: { EXPORT: "app", APPROVE: "user" }, titles: { EXPORT: "Export the 3D model (GLB + snapshots)", APPROVE: "The user approves the 3D" }, weights: { EXPORT: 1 }, docs: {} };
  var outFiles = [], exporting = false;
  var CAN_3D = ((P.host && P.host.capabilities) || []).indexOf("export-3d") >= 0 && typeof P.export3d === "function";
  function renderExport() {
    var el = $("#s3-export"); if (!el) return;
    var has = outFiles.some(function (f) { return /\.glb$/i.test(f); });
    el.innerHTML = CAN_3D
      ? '<div class="row"><button type="button" class="primary" id="s3-go"' + (exporting ? " disabled" : "") + ">" + (exporting ? "Exporting…" : has ? "Export again" : "Export 3D") + '</button><span class="muted">from the canvas open in the editor — open <code>5-final.canvas.json</code> first (S2 · 5)</span></div>'
      : '<div class="empty">This editor cannot export 3D yet (no "export-3d" host capability) — reload the editor after it updates.</div>';
    var shots = outFiles.filter(function (f) { return /\.png$/i.test(f); });
    $("#model").innerHTML = shots.map(function (f) { var u = P.url(DIR + "output/" + f); return '<a href="' + u + '" target="_blank"><img src="' + u + '"><span>' + esc(f) + "</span></a>"; }).join("");
    $("#s3-files").innerHTML = outFiles.filter(function (f) { return /\.(glb|gltf)$/i.test(f); }).map(function (f) { return '<a class="filelink" href="' + P.url(DIR + "output/" + f) + '" target="_blank" download>⬇ ' + esc(f) + "</a>"; }).join("");
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#s3-go")) return;
    exporting = true; renderExport();
    P.export3d(DIR + "output/", { name: P.project, snapshots: ["isometric", "top", "front"] }).then(function (r) {
      P.notify("3D exported — " + r.meshes + " meshes, " + Math.round(r.triangles) + " triangles", "success");
      P.emit("s3", { export: r });
    }, function (err) { P.notify("3D export failed: " + (err && err.message || err), "error"); })
      .then(function () { exporting = false; return P.list(DIR + "output/").then(function (l) { outFiles = l; }, function () {}); }).then(refresh);
  });
  // every S2 sub-step leaves its own canvas: steps/S2_PLAN/<n>-<name>.canvas.json (Claude writes it and loads it live);
  // a new one opens on the canvas by itself, and "Show on canvas" reopens any of them
  var S2_CANVAS = [
    { el: "#s2-c1", file: "S2_PLAN/1-overlay.canvas.json", title: "overlay, scaled and turned to north" },
    { el: "#s2-c2", file: "S2_PLAN/2-walls.canvas.json", title: "walls, doors and windows" },
    { el: "#s2-c3", file: "S2_PLAN/3-objects.canvas.json", title: "walls + library objects" },
    { el: "#s2-c4", file: "S2_PLAN/4-materials.canvas.json", title: "with materials and finishes" },
    { el: "#s2-c5", file: "S2_PLAN/5-final.canvas.json", title: "the final design (S3 exports this)" },
  ];
  var seenCanvas = null;
  function renderCanvases() {
    var have = S2_CANVAS.filter(function (c) { return files.has(c.file); }).map(function (c) { return c.file; });
    if (seenCanvas === null) seenCanvas = have.slice();
    have.forEach(function (f) { if (seenCanvas.indexOf(f) < 0) { seenCanvas.push(f); P.openCanvas(STEPS + f).catch(function () {}); P.notify("New canvas: " + f.split("/").pop(), "info"); } });
    S2_CANVAS.forEach(function (c) {
      var el = $(c.el); if (!el) return;
      var on = files.has(c.file);
      el.innerHTML = '<div class="canvasrow"><span class="pill ' + (on ? "ok" : "") + '">' + (on ? "canvas ready" : "no canvas yet") + "</span><code>" + esc(c.file.split("/").pop()) + "</code>" +
        '<span class="muted">' + esc(c.title) + "</span>" + '<button type="button" data-canvas="' + esc(c.file) + '"' + (on ? "" : " disabled") + ">Show on canvas</button></div>";
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-canvas]");
    if (b) P.openCanvas(STEPS + b.dataset.canvas).then(function () { P.notify("Opened " + b.dataset.canvas.split("/").pop(), "success"); }, function (err) { P.notify("Could not open: " + (err && err.message || err), "error"); });
  });
  var FORMS = {
    "s2/scale": { el: "#s2-scale", save: "Save scale and north", fields: [
      { key: "ref_kind", label: "Scale from", type: "select", options: ["Door width", "Printed dimension", "Other"], default: "Door width" },
      { key: "ref_what", label: "Which one (e.g. 'entrance door', 'the 18' 11\" wall')", type: "text", default: "entrance door" },
      { key: "ref_mm", label: "Its real size (mm)", type: "number", default: 900, why: "a standard door leaf is 900 mm; a printed 18' 11\" is 5766 mm" },
      { key: "north_deg", label: "North bearing (degrees, clockwise from page-up)", type: "number", default: 0, why: "0 = north points up the page" }] },
    "s2/walls": { el: "#s2-walls", ok: "Looks right", save: "Request changes", fields: [
      { key: "note", label: "Improvements to the walls, doors and windows", type: "textarea", default: "", why: "e.g. 'the east wall is 150 thick', 'add a window on the south wall'" }] },
    "s2/objects": { el: "#s2-objects", ok: "Looks right", save: "Request changes", fields: [
      { key: "note", label: "Improvements to the objects", type: "textarea", default: "", why: "e.g. 'the sofa faces the window', 'move the rug 300 north'" }] },
    "s2/materials": { el: "#s2-materials", ok: "Looks right", save: "Request changes", fields: [
      { key: "note", label: "Changes to the materials and finishes", type: "textarea", default: "", why: "e.g. 'lighter oak for the floor', 'the teal only on the TV wall'" },
      { key: "add_materials", label: "Do you want to add new materials?", type: "select", options: ["No", "Yes"], default: "No" },
      { key: "materials_note", label: "Which materials (optional)", type: "textarea", default: "" }] },
    "s2/more": { el: "#s2-more", save: "Save", fields: [
      { key: "add_objects", label: "Do you want to add new objects?", type: "select", options: ["No", "Yes"], default: "No" },
      { key: "objects_note", label: "Which objects (optional)", type: "textarea", default: "" },
      { key: "improve", label: "Do you want to make any other improvements?", type: "textarea", default: "" }] },
  };
  function fieldHtml(f, v) {
    var name = ' name="' + esc(f.key) + '"';
    var input = f.type === "select" ? "<select" + name + ">" + f.options.map(function (o) { return "<option" + (String(o) === String(v) ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>"
      : f.type === "textarea" ? '<textarea rows="3"' + name + ">" + esc(v) + "</textarea>"
      : '<input type="' + (f.type === "number" ? "number" : "text") + '"' + name + ' value="' + esc(v) + '">';
    return "<label>" + esc(f.label) + input + (f.why ? '<span class="why">' + esc(f.why) + "</span>" : "") + "</label>";
  }
  function formState(d) { return d && d.saved ? (d.ok ? "Marked as looking right · " : "Saved · ") + String(d.saved).slice(0, 16).replace("T", " ") : ""; }
  function renderForms() {
    Object.keys(FORMS).forEach(function (key) {
      var F = FORMS[key], el = $(F.el), d = docs[key] || {};
      if (!el) return;
      if (el.dataset.ready) { el.querySelector(".fstate").textContent = formState(d); return; }
      el.dataset.ready = "1";
      el.innerHTML = '<form class="form">' + F.fields.map(function (f) { return fieldHtml(f, d[f.key] != null ? d[f.key] : f.default); }).join("") + "</form>" +
        '<div class="row">' + (F.ok ? '<button type="button" class="primary" data-ok>' + esc(F.ok) + "</button>" : "") +
        '<button type="button"' + (F.ok ? "" : ' class="primary"') + " data-save>" + esc(F.save) + '</button><span class="fstate muted">' + esc(formState(d)) + "</span></div>";
      el.addEventListener("click", function (e) {
        var ok = e.target.closest("[data-ok]"), sv = e.target.closest("[data-save]");
        if (!ok && !sv) return;
        var data = {};
        new FormData(el.querySelector("form")).forEach(function (v, k) { data[k] = v; });
        F.fields.forEach(function (f) { if (f.type === "number" && data[f.key] !== "") data[f.key] = Number(data[f.key]); });
        data.ok = !!ok; data.saved = new Date().toISOString();
        P.db.doc(key).set(data).then(function () { docs[key] = data; P.emit("s2", { doc: key, data: data }); P.notify(ok ? "Marked as looking right" : "Saved — Claude will pick it up", "success"); refresh(); },
          function (err) { el.querySelector(".fstate").textContent = "Not saved: " + (err && err.message || err); });
      });
    });
  }
  function renderBrief() {
    var f = files.has("S2_BRIEF/roombrief.json") ? "S2_BRIEF/roombrief.json" : files.has("S2_BRIEF/roombrief.draft.json") ? "S2_BRIEF/roombrief.draft.json" : null;
    if (!f) { $("#brief").innerHTML = '<div class="empty">No brief yet.</div>'; return; }
    readJson(STEPS + f).then(function (b) {
      var items = (b && b.items) || [];
      $("#brief").innerHTML = '<p class="muted">' + esc(f.split("/").pop()) + " · " + items.length + " items</p>" +
        table(items, [["id", function (i) { return i.id || i.specId || ""; }], ["category", function (i) { return i.category || ""; }], ["zone", function (i) { return i.zone || ""; }],
          ["what", function (i) { return i.name || i.title || (i.text || "").split("\n")[0] || (i.object && i.object.kind) || ""; }], ["slides", function (i) { return (i.slides || []).join(", "); }]]);
    });
  }
  // ── Objects: the review UI (review.html — the "Reception Selections" page) in a frame. app.js builds its data from
  // the project (roombrief + resolve + catalog, any earlier review) and answers its bp-host/* requests from R2.
  // Sign-off writes steps/S4_RESOLVE/review.json; S4_CHECK applies it (tools/review_apply.py) before checking.
  var REVIEW = { frame: null, sig: null, data: null };
  var REVIEW_PATH = STEPS + "S4_RESOLVE/review.json", DRAFT_PATH = STEPS + "S4_RESOLVE/review.draft.json";
  function hash(t) { var h1 = 5381, h2 = 52711; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; } return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).slice(0, 16); }
  var TRADE = { floor: "Floor", ceiling: "Ceiling", joinery: "Joinery", "wall-finish": "Wall finishes", wall: "Walls", partition: "Partition", furniture: "Furniture",
    "soft-furnishing": "Soft furnishing", lighting: "Lighting", planting: "Planting", entourage: "People and entourage", services: "Services and fittings", other: "Other" };
  function human(k) {
    var mm = /_mm$/.test(k); k = k.replace(/_mm$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return k.charAt(0).toUpperCase() + k.slice(1) + (mm ? " (mm)" : "");
  }
  function fieldOf(k, v) {
    var t = typeof v === "boolean" ? "bool" : typeof v === "number" ? "number"
      : /^#[0-9a-f]{6}$/i.test(v) ? "colour" : /^#[0-9a-f]{6}(\s*,\s*#[0-9a-f]{6})+$/i.test(v) ? "colours"
      : /material|finish/i.test(k) || /\.json$/.test(String(v)) ? "material" : "text";
    return { key: k, label: human(k), value: v, type: t, locked: false, deck: v };
  }
  function nameOf(it) {
    if (it.name) return it.name;
    var h = String((it.object && it.object.hint) || "").replace(/^NEW:\s*/i, "").split(/[,;(]/)[0].trim();
    var k = String((it.object && it.object.kind) || it.id).replace(/[-_]+/g, " ");
    var n = h || k;
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  function buildReview() {
    return Promise.all([readJson(STEPS + "S2_BRIEF/roombrief.json"), readJson(STEPS + "S4_RESOLVE/resolve.json"), readJson(STEPS + "S4_RESOLVE/catalog.json"), readJson(REVIEW_PATH)]).then(function (a) {
      var brief = a[0], res = a[1] || { bindings: [] }, cat = a[2] || { objects: [], materials: [] }, prev = (a[3] && a[3].items) || {};
      if (!brief) return null;
      var by = {}; (res.bindings || []).forEach(function (b) { by[b.item] = b; });
      var images = {}, cats = [];
      var items = brief.items.map(function (it) {
        var b = by[it.id] || {}, bp = b.params || {}, pv = prev[it.id] || null;
        var pipe = b.pipeline || { object: b.status === "render-only" ? "render-only" : b.object || "new", material: bp.materialPath || null, status: b.status || "new-object", source: "resolve" };
        var cur = pv && pv.library ? { object: pv.library.object, material: pv.library.material } : { object: pipe.object, material: pipe.material };
        (it.refImages || []).forEach(function (f) { images[f] = P.url(STEPS + "S1_INTAKE/" + f); });
        if (cats.indexOf(it.category) < 0) cats.push(it.category);
        return { id: it.id, name: nameOf(it), category: it.category, zone: it.zone, slides: it.slides || [], note: it.note || "",
          object: it.object || {}, productUrls: it.productUrls || [], refImages: it.refImages || [],
          fields: Object.keys(it.params || {}).map(function (k) { return fieldOf(k, it.params[k]); }),
          omit: b.status === "omitted", review: pv ? { decision: pv.decision, comment: pv.comment || "" } : null,
          library: { object: pipe.object, material: pipe.material, status: pipe.status, note: b.gap || b.note || "", source: "resolve", matches: [], materialMatches: [], pipeline: pipe, current: cur } };
      });
      var zones = {}; (brief.zones || []).forEach(function (z) { zones[z.id] = { label: z.label, points: z.points_px || z.points || [] }; });
      var pl = brief.plan || {};
      var objects = (cat.objects || []).map(function (o) { return { path: o.path, title: String(o.title || o.id || o.path).split(" — ")[0], trade: "other" }; });
      var materials = (cat.materials || []).map(function (m) { return { path: m.path.replace(/^Materials\//, ""), title: String(m.title || m.id).split(" — ").pop(), category: m.category || "" }; });
      var data = { schema: "roombrief.review-page/1", code: P.project, project: brief.project || "", room: brief.room || "", generated: new Date().toISOString(),
        precedence: brief.precedence || "", heights: brief.heights_mm || {}, zones: zones,
        plan: pl.file && pl.px ? { src: P.url(STEPS + "S1_INTAKE/" + pl.file), box: pl.room_view_px || [0, 0, pl.px[0], pl.px[1]], full: pl.px } : null,
        images: images, items: items, simulateModels: false,
        suggest: { kinds: items.map(function (i) { return i.object.kind; }).filter(Boolean), materials: materials.map(function (m) { return m.path; }) },
        categories: cats.map(function (c) { return { id: c, label: TRADE[c] || human(c) }; }),
        library: { objects: objects, materials: materials, special: { "new": "None fits: needs a new library object", "render-only": "Render only (not placed on the plan)" }, tradeLabels: TRADE, source: "catalog.json" },
        applyCmd: "Sign off here; S4_CHECK applies the decisions", previous: null, compose: null,
        host: { decisionsPath: REVIEW_PATH, draftPath: DRAFT_PATH, composeGatePath: STEPS + "S5_COMPOSE/compose-gate.json" } };
      data.briefSha = hash(JSON.stringify(brief.items) + JSON.stringify(res.bindings || []));
      return data;
    });
  }
  function counts(dec, n) {
    var c = { approve: 0, changed: 0, question: 0, omit: 0 };
    Object.keys(dec.items || {}).forEach(function (k) { var d = dec.items[k].decision; if (c[d] != null) c[d]++; });
    c.pending = n - c.approve - c.changed - c.question - c.omit; return c;
  }
  // the review page's host: bp-host/* requests answered from R2 through window.pipeline
  window.addEventListener("message", function (e) {
    var f = REVIEW.frame; if (!f || e.source !== f.contentWindow) return;
    var m = e.data || {}, w = f.contentWindow;
    var reply = function (o) { w.postMessage(Object.assign({ type: "bp-host/response", id: m.id }, o), "*"); };
    var fail = function (err) { reply({ ok: false, error: String(err && err.message || err) }); };
    if (m.type === "bp-review/want-data" && REVIEW.data) w.postMessage({ type: "bp-review/data", data: REVIEW.data }, "*");
    else if (m.type === "bp-host/hello") w.postMessage({ type: "bp-host/ready", v: 1, capabilities: ["library.read", "library.write", "pipeline.run"], user: { name: "" } }, "*");
    else if (m.type === "bp-host/request") {
      var a = m.args || {};
      if (m.op === "library.read") P.read(a.path).then(function (t) { reply({ ok: true, content: t }); }, fail);
      else if (m.op === "library.write") P.write(a.path, a.content).then(function () { reply({ ok: true }); }, fail);
      else if (m.op === "pipeline.run" && a.step === "review.apply") {
        readJson(REVIEW_PATH).then(function (dec) {
          if (!dec) throw new Error("review.json was not saved");
          var c = counts(dec, REVIEW.data.items.length), status = c.pending || c.question ? "open" : "approved";
          P.emit("review", { status: status, reviewer: dec.reviewer, counts: c, path: REVIEW_PATH });
          P.notify(status === "approved" ? "Objects signed off by " + (dec.reviewer || "the reviewer") + ": S4_CHECK applies them" : "Objects review saved: " + c.pending + " to review, " + c.question + " questions", status === "approved" ? "success" : "info");
          reply({ ok: true, result: { status: status, reviewer: dec.reviewer, counts: c } });
        }).catch(fail);
      } else if (m.op === "pipeline.run" && a.step === "compose") P.job("S4_PLACE", {}).then(function () { reply({ ok: true, result: { queued: "S4_PLACE" } }); }, fail);
      else reply({ ok: false, error: "not offered here: " + m.op });
    }
  });
  function renderObjects() {
    var el = $("#objects");
    if (!files.has("S4_RESOLVE/resolve.json")) { REVIEW.sig = null; el.innerHTML = '<div class="empty">Claude writes resolve.json after the catalog snapshot; the review opens here then.</div>'; return; }
    var sig = [files.has("S4_RESOLVE/catalog.json"), files.has("S2_BRIEF/roombrief.json")].join();
    if (REVIEW.sig === sig && REVIEW.frame && el.contains(REVIEW.frame)) return;
    REVIEW.sig = sig;
    buildReview().then(function (d) {
      if (!d) { el.innerHTML = '<div class="empty">No room brief yet.</div>'; return; }
      REVIEW.data = d;
      var f = document.createElement("iframe");
      f.className = "review"; f.title = "Objects review"; f.src = "review.html";
      el.innerHTML = ""; el.appendChild(f); REVIEW.frame = f;
    }, function (err) { el.innerHTML = '<div class="empty">Could not build the review: ' + esc(err && err.message || err) + "</div>"; });
  }
  function renderRoom() {
    var f = "S5_COMPOSE/" + P.project + ".room.canvas.json";
    $("#room").innerHTML = files.has(f)
      ? '<p>Room canvas: <a target="_blank" href="' + P.url(STEPS + f) + '">' + esc(f.split("/").pop()) + '</a> — also in <code>output/</code>. Open it in the editor: Files ▸ Import JSON (or ask Claude to load it).</p>' +
        (files.has("S5_COMPOSE/compose.report.txt") ? '<p><a target="_blank" href="' + P.url(STEPS + "S5_COMPOSE/compose.report.txt") + '">compose report</a></p>' : "")
      : '<div class="empty">No room canvas yet.</div>';
  }
  function renderJobs() {
    var rows = Object.keys(STAGES).filter(function (s) { return jobs[s]; }).map(function (s) { return Object.assign({ stage: s }, jobs[s]); });
    $("#jobs").innerHTML = table(rows, [["stage", function (j) { return j.stage; }], ["status", function (j) { return j.status; }], ["queued", function (j) { return (j.queued || "").slice(0, 19).replace("T", " "); }],
      ["finished", function (j) { return (j.finished || "").slice(0, 19).replace("T", " "); }], ["by", function (j) { return j.by || ""; }], ["error", function (j) { return j.error || ""; }]]);
    var list = Object.keys(jobs).map(function (k) { return jobs[k]; });
    var run = list.filter(function (j) { return j.status === "running"; })[0];
    var stale = list.some(function (j) { return j.status === "queued" && Date.now() - Date.parse(j.queued) > 60000; });
    var pill = $("#runner-pill");
    pill.className = "pill " + (run ? "warn" : stale ? "bad" : "ok");
    pill.textContent = run ? "runner: " + run.stage + " running" : stale ? "runner: offline?" : "runner: idle";
    renderUsage();
  }
  // usage.json (tools/runner/usage.mjs): runner time + Claude tokens per stage, cost in INR with the markup
  function hms(s) { if (s == null) return "–"; s = Math.round(s); return s >= 60 ? Math.floor(s / 60) + " min " + (s % 60) + " s" : s + " s"; }
  function num(n) { return Number(n || 0).toLocaleString("en-IN"); }
  function rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function renderUsage() {
    var el = $("#usage");
    if (!usage) { el.innerHTML = '<div class="empty">No usage yet — Claude writes usage.json after the stages run.</div>'; return; }
    var r = usage.rates || {}, p = r.usd_per_mtok || {}, k = (r.usd_inr || 0) * (1 + (r.markup || 0));
    var rate = function (usd) { return rupees(usd * k) + "/M"; };
    // one row per pipeline stage (S1…S5) with its jobs indented under it; a flat job list for older usage.json
    var rows = [];
    (usage.groups && usage.groups.length ? usage.groups : []).forEach(function (g) {
      rows.push({ stage: g.id + " " + g.title, seconds: g.seconds, elapsed: g.elapsed, tokens: g.tokens, inr: g.inr, group: true });
      usage.stages.filter(function (s) { return g.jobs.indexOf(s.stage) >= 0; }).forEach(function (s) { rows.push(Object.assign({}, s, { stage: "   " + s.stage, job: true })); });
    });
    if (!rows.length) rows = usage.stages.slice();
    rows.push({ stage: "TOTAL", seconds: usage.total.seconds, elapsed: (usage.groups || []).reduce(function (a, g) { return a + (g.elapsed || 0); }, 0) || null, tokens: { total: usage.total.tokens }, inr: usage.total.inr, total: true });
    el.innerHTML = table(rows, [["stage", function (s) { return s.stage; }], ["runner time", function (s) { return hms(s.seconds); }],
      ["elapsed (to approval)", function (s) { return s.job ? "" : hms(s.elapsed); }],
      ["input", function (s) { return s.total ? "" : num(s.tokens.input); }], ["output", function (s) { return s.total ? "" : num(s.tokens.output); }],
      ["cache write", function (s) { return s.total ? "" : num(s.tokens.cache_write); }], ["cache read", function (s) { return s.total ? "" : num(s.tokens.cache_read); }],
      ["tokens", function (s) { return num(s.tokens.total); }], ["cost (INR)", function (s) { return rupees(s.inr); }]]) +
      '<p class="muted">Runner time = the scripts on the runner. Elapsed = the stage\u2019s first job queued \u2192 your last approval of it (includes Claude\u2019s steps and your review). Rate (' + esc(r.model || "") + ', incl. ' + Math.round((r.markup || 0) * 100) + '% extra, $1 = ₹' + esc(r.usd_inr) + '): input ' + rate(p.input) + ' · output ' + rate(p.output) +
      ' · cache write ' + rate(p.cache_write) + ' · cache read ' + rate(p.cache_read) + ' tokens. Runner scripts use no tokens; a job\u2019s tokens are Claude\u2019s work from queuing it until the next job was queued. Updated ' + esc(String(usage.at || "").slice(0, 16).replace("T", " ")) + '.</p>';
    el.querySelectorAll("tr").forEach(function (tr, i) { var r0 = rows[i - 1]; if (r0 && (r0.group || r0.total)) tr.style.fontWeight = "600"; if (r0 && r0.job) tr.style.color = "#64748b"; });
  }

  // ── live progress: one card at the top of each stage tab ──
  // Steps come from the skill (progress.json order/weights/kinds, written by the runner); script steps from the
  // runner, agent steps from agent-progress.json (Claude), user steps from the answers and the step-bar approvals.
  // an approval = the step bar's Approve step, or the user's Re-approve click on a stale stage in this app (the step
  // bar only approves its CURRENT step, so a stage re-run after the bar moved on is re-approved here)
  function isApproval(e, gate) { return e.step === gate && e.type === "approve" || e.type === "ui" && e.note === "reapprove" && e.data && e.data.gate === gate; }
  function approvedAt(gate) {
    var ev = ((runDoc && runDoc.events) || []).filter(function (e) { return isApproval(e, gate); });
    return ev.length ? Math.max.apply(null, ev.map(function (e) { return e.at; })) : null;
  }
  function stageView(g) {
    var pr = progress[g.id] || null, ag = agentProg[g.id] || null;
    var flow = g.id === "S2" && !(pr && pr.order) ? S2 : g.id === "S3" ? S3 : null;
    var order = (flow && flow.order) || (pr && pr.order) || Object.keys(STAGES).filter(function (k) { return STAGES[k].group === g.id; }).map(function (k) { return STAGES[k].step; });
    var kinds = (flow && flow.kinds) || (pr && pr.kinds) || {}, weights = (flow && flow.weights) || (pr && pr.weights) || {}, titles = (flow && flow.titles) || (pr && pr.titles) || {};
    var lastScript = null;
    Object.keys(STAGES).forEach(function (k) { var j = jobs[k]; if (STAGES[k].group === g.id && j && j.finished && (!lastScript || j.finished > lastScript)) lastScript = j.finished; });
    var okAt = approvedAt(g.gate), stale = okAt && lastScript && Date.parse(lastScript) > okAt + 1000;
    var steps = order.map(function (id) {
      var s = (pr && pr.steps && pr.steps[id]) || null, kind = kinds[id] || "script", st = { id: id, kind: kind, title: titles[id] || id, state: "todo", pct: 0, msg: "", secs: null };
      if (s) { st.state = s.state === "running" ? "running" : s.state === "failed" ? "failed" : "done"; st.pct = s.pct || 0; st.msg = s.msg || ""; st.secs = s.secs; st.started = s.started; }
      if (kind === "agent" && ag && ag.step === id) { st.state = ag.done ? "done" : "running"; st.pct = ag.done ? 100 : (ag.pct || 0); st.msg = ag.msg || ""; st.started = ag.started; }
      if (kind === "app") { var out = outFiles.filter(function (f) { return /\.glb$/i.test(f); }); st.state = out.length ? "done" : "todo"; st.pct = out.length ? 100 : 0; st.msg = out.length ? out[0] : "not exported yet"; return st; }
      var dk = flow && flow.docs[id], dd = dk && docs[dk];
      if (kind === "user" && dk) {
        st.state = dd && dd.saved ? "done" : "wait"; st.msg = dd && dd.saved ? (dd.ok ? "looks right" : "saved" + (dd.note ? ": " + dd.note : "")) : "waiting";
      } else if (kind === "user") {
        var isApprove = /APPROVE/.test(id);
        st.state = isApprove ? (okAt && !stale ? "done" : "wait") : (answers.saved ? "done" : questions ? "wait" : "todo");
        st.msg = isApprove ? (okAt && !stale ? "approved " + new Date(okAt).toLocaleString() : stale ? "re-run after approval: approve again" : "waiting for your approval in the step bar") : (answers.saved ? "answers saved" : "waiting for your answers");
      }
      return st;
    });
    // agent steps before a finished script step are done; a "wait" before anything that has not run is just todo
    var seenDone = false;
    // agent steps before the one Claude reports now are done
    if (ag && ag.step) { var ai = order.indexOf(ag.step); steps.forEach(function (x, i) { if (i < ai && x.kind === "agent" && x.state === "todo") { x.state = "done"; x.pct = 100; } }); }
    for (var i = steps.length - 1; i >= 0; i--) { if (steps[i].state === "done" || steps[i].state === "running") seenDone = true; else if (seenDone && steps[i].kind === "agent") { steps[i].state = "done"; steps[i].pct = 100; } }
    var total = 0, got = 0;
    steps.forEach(function (st) { var w = weights[st.id] != null ? weights[st.id] : (st.kind === "user" ? 0 : 1); total += w; got += w * (st.state === "done" ? 100 : st.state === "running" || st.state === "failed" ? st.pct : 0) / 100; });
    var pct = total ? Math.round(100 * got / total) : 0;
    var running = steps.filter(function (s) { return s.state === "running"; })[0];
    var failed = steps.filter(function (s) { return s.state === "failed"; })[0];
    var waiting = steps.filter(function (s) { return s.state === "wait"; })[0];
    var state = failed ? "failed" : running ? "running" : okAt && !stale ? "approved" : stale ? "stale" : waiting ? "waiting" : pct > 0 ? "paused" : "not started";
    var eta = null;
    if (running && running.started && running.pct >= 5 && running.pct < 100) { var el = (Date.now() - Date.parse(running.started)) / 1000; eta = Math.round(el * (100 - running.pct) / running.pct); }
    var log = ((pr && pr.log) || []).concat(ag && ag.log ? ag.log : ag && ag.msg ? [{ t: ag.at, step: ag.step, msg: ag.msg }] : []).sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); });
    var beat = pr && (pr.heartbeat || pr.updated);
    return { g: g, pr: pr, steps: steps, pct: pct, state: state, running: running, failed: failed, eta: eta, log: log, beat: beat, stale: stale };
  }
  var ICON = { done: "✓", running: "▸", failed: "✕", wait: "⏸", todo: "·" };
  function ago(t) { if (!t) return "–"; var s = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 1000)); return s < 60 ? s + " s ago" : Math.round(s / 60) + " min ago"; }
  function hm(t) { return t ? String(new Date(t).toLocaleTimeString()) : ""; }
  function renderProgress(g) {
    var els = document.querySelectorAll('.progress[data-group="' + g.id + '"]');
    if (!els.length) return;
    var v = stageView(g);
    els.forEach(function (el) { paint(el, g, v); });
  }
  function paint(el, g, v) {
    var cls = v.state === "failed" ? "bad" : v.state === "running" ? "warn" : v.state === "approved" ? "ok" : v.state === "stale" ? "bad" : "";
    var every = v.state === "running" ? 3 : 15;
    var silent = v.state === "running" && v.beat && Date.now() - Date.parse(v.beat) > 60000;
    var open = el.querySelector("details.log") ? el.querySelector("details.log").open : v.state === "running" || v.state === "failed";
    var now = v.failed ? "failed in " + v.failed.title : v.running ? v.running.title + (v.running.msg ? " — " + v.running.msg : "") : (v.steps.filter(function (s) { return s.state === "wait"; })[0] || {}).title || (v.state === "approved" ? "approved" : "");
    if (pOpen[g.id] == null) pOpen[g.id] = false;
    var was = el.querySelector(":scope > details"); if (was) pOpen[g.id] = was.open;
    el.innerHTML = '<details' + (pOpen[g.id] ? " open" : "") + '><summary><div class="phead"><b>' + esc(g.id + " " + g.title) + '</b><span class="muted">' + esc(g.skill + (v.pr && v.pr.skill ? " " + v.pr.skill.split("@")[1] : "")) + "</span>" +
      '<span class="pill ' + cls + '">' + esc(v.state) + "</span>" + (now ? '<span class="nowr" title="' + esc(now) + '">' + esc(now) + "</span>" : "") + "<span class=\"pct\">" + v.pct + " %</span></div>" +
      '<div class="bar"><i style="width:' + v.pct + '%" class="' + cls + '"></i></div></summary><div class="body">' +
      (v.eta != null ? '<div class="muted">~' + esc(hms(v.eta)) + " left in this step</div>" : "") +
      (v.running ? '<div class="now">' + esc(v.running.title) + (v.running.msg ? " — " + esc(v.running.msg) : "") + " · " + v.running.pct + " %</div>" : "") +
      (v.failed ? '<div class="now bad">Failed in ' + esc(v.failed.title) + ": " + esc(v.failed.msg) + "</div>" : "") +
      (silent ? '<div class="now bad">Runner not responding (no heartbeat for ' + esc(ago(v.beat)) + ") — is node tools/runner/worker.mjs running?</div>" : "") +
      (v.stale ? '<div class="now bad">This stage was re-run after you approved it — check it and approve again. <button type="button" class="primary" data-reapprove="' + esc(g.id) + '">Re-approve ' + esc(g.id + " " + g.title) + "</button></div>" : "") +
      '<ol class="steps">' + v.steps.map(function (st) {
        return '<li class="' + st.state + '"><span class="ic">' + ICON[st.state] + '</span><span class="t">' + esc(st.title) + (st.kind === "agent" ? ' <em>(Claude)</em>' : st.kind === "user" ? " <em>(you)</em>" : "") + "</span>" +
          '<span class="m">' + esc(st.state === "running" ? st.pct + " %" : st.msg) + "</span>" + (st.secs != null ? '<span class="s">' + esc(hms(st.secs)) + "</span>" : "") + "</li>";
      }).join("") + "</ol>" +
      "<details class=\"log\"" + (open ? " open" : "") + "><summary class=\"muted\">log · " + v.log.length + " lines</summary><pre>" +
      esc(v.log.slice(-40).map(function (l) { return hm(l.t) + "  " + (l.step ? "[" + l.step + "] " : "") + l.msg; }).join("\n") || "(nothing yet)") + "</pre></details>" +
      '<div class="foot muted">last update ' + esc(ago(v.pr && v.pr.updated)) + " · checking every " + every + " s</div></div></details>";
    paintSubs(g, v);
    var head = document.querySelector('.nodehead[data-group="' + g.id + '"]');
    if (head) head.innerHTML = '<span class="caret"></span><b>' + esc(g.id + " " + g.title) + '</b><span class="muted">' + esc(g.skill) + "</span>" +
      '<span class="pill ' + cls + '">' + esc(v.state) + "</span>" + (now ? '<span class="nowr" title="' + esc(now) + '">' + esc(now) + "</span>" : '<span class="nowr"></span>') +
      '<span class="pct">' + v.pct + ' %</span><span class="hbar"><i style="width:' + v.pct + '%" class="' + cls + '"></i></span>';
  }
  // each sub-step header shows its own percent and what is happening, from the stage's steps it covers (data-steps)
  function paintSubs(g, v) {
    document.querySelectorAll('details.node[data-panel="' + g.tab + '"] details.sub[data-steps]').forEach(function (d) {
      var ids = d.dataset.steps.split(" "), sts = v.steps.filter(function (s) { return ids.indexOf(s.id) >= 0; });
      var out = d.querySelector(".sstat");
      if (!sts.length || !out) return;
      var pct = Math.round(sts.reduce(function (a, s) { return a + (s.state === "done" ? 100 : s.state === "running" || s.state === "failed" ? s.pct : 0); }, 0) / sts.length);
      var f = sts.filter(function (s) { return s.state === "failed"; })[0], r = sts.filter(function (s) { return s.state === "running"; })[0], w = sts.filter(function (s) { return s.state === "wait"; })[0];
      var all = sts.every(function (s) { return s.state === "done"; });
      var cls = f ? "bad" : r ? "run" : w ? "wait" : all ? "ok" : "";
      var msg = f ? "failed: " + (f.msg || f.title) : r ? r.title + (r.msg ? " — " + r.msg : "") : w ? (w.msg || "waiting") + (w.kind === "user" ? " (you)" : "") : all ? "done" : "not started";
      out.className = "sstat " + cls;
      out.title = msg;
      out.innerHTML = "<span>" + esc(msg) + "</span><b>" + (all ? "✓" : pct + " %") + "</b>";
    });
  }
  function loadProgress(force) {
    var now = Date.now();
    return Promise.all(GROUPS.map(function (g) {
      var running = progress[g.id] && progress[g.id].state === "running" || agentProg[g.id] && !agentProg[g.id].done;
      var every = isOpen(g.tab) || running ? 3000 : 15000;
      if (!force && checked[g.id] && now - checked[g.id] < every - 200) return null;
      checked[g.id] = now;
      return Promise.all([readJson(DIR + "stages/" + g.id + "/progress.json"), readJson(DIR + "stages/" + g.id + "/agent-progress.json")]).then(function (a) { progress[g.id] = a[0]; agentProg[g.id] = a[1]; });
    })).then(function () { return readJson(DIR + "run.json").then(function (r) { runDoc = r; }); });
  }

  function refresh() {
    GROUPS.forEach(renderProgress);
    document.querySelectorAll(".stage[data-stage]").forEach(renderStage);
    renderDeck(); renderQuestions(); renderJobs();
    var rn = $("#runner-now"); if (rn) { var q = Object.keys(jobs).filter(function (k) { return jobs[k].status === "queued" || jobs[k].status === "running"; }); rn.textContent = q.length ? q.length + " job(s) waiting / running" : "idle"; }
    if (isOpen("brief")) renderBrief();
    if (isOpen("objects")) renderObjects();
    if (isOpen("fitout")) renderRoom();
    if (isOpen("plan")) {
      renderForms(); renderCanvases();
      $("#s2-walls-img").innerHTML = imgs("S2_PLAN/", /walls[^/]*\.png$/);
      $("#s2-objects-img").innerHTML = imgs("S2_PLAN/", /objects[^/]*\.png$/);
    }
    if (isOpen("3d")) renderExport();
  }

  function poll() {
    return Promise.all([loadJobs(), loadFiles(), loadProgress(), readJson(DIR + "usage.json").then(function (u) { usage = u; })]).then(function () {
      // re-read every poll: Claude may rewrite the questions (an image's floorplans and rooms appear after it marks them)
      var loads = [P.list(DIR + "output/").then(function (l) { outFiles = l; }, function () { outFiles = []; }), P.list("inputs/images/").then(function (l) { crops = l.filter(function (f) { return /\.(png|jpe?g|webp)$/i.test(f); }).sort(); }, function () { crops = []; })];
      if (files.has("S1_INTAKE/questions.json")) loads.push(readJson(STEPS + "S1_INTAKE/questions.json").then(function (q) { if (q) questions = q; }));
      return Promise.all(loads);
    }).then(function () { refresh(); focusCurrent(); }, function () {});
  }

  // foldable sub-steps: each <details class="sub"> remembers open / closed in this browser
  document.querySelectorAll("details.sub").forEach(function (d) {
    var k = "bfd.sub2." + d.dataset.sub;   // folded by default; remembers the user's choice
    try { var v = localStorage.getItem(k); if (v != null) d.open = v === "1"; } catch (e) {}
    d.addEventListener("toggle", function () { try { localStorage.setItem(k, d.open ? "1" : "0"); } catch (e) {} });
  });

  $("#code").textContent = P.project || "";
  Object.keys(FORMS).forEach(function (key) { P.db.doc(key).onSnapshot(function (snap) { docs[key] = snap.exists ? snap.data() || {} : {}; refresh(); }); });
  P.db.doc("answers/main").onSnapshot(function (snap) { answers = snap.exists ? snap.data() || {} : {}; if (answers.saved) $("#qstate").textContent = "Saved " + String(answers.saved).slice(0, 16).replace("T", " "); refresh(); });
  show("brief"); focused = false;
  setInterval(function () { GROUPS.forEach(renderProgress); }, 1000);   // the "x s ago" and ETA tick between polls
  Promise.all([loadDecks(), poll()]).then(function () { setInterval(poll, 3000); setInterval(loadDecks, 15000); });
})();
