/* Build from Deck — the pipeline's app, shown as tabs in the editor (pipeline.run { pipeline: "build-from-deck", code }).
   The user uploads the deck, answers the questions and approves each step; script stages run on the runner
   (tools/runner/worker.mjs) through jobs/<STAGE>.json; Claude writes the judgement files (curated brief, trace,
   resolve) into steps/ through the connector. Everything lives in R2 under Projects/<CODE>/ — this page only reads
   it (pipeline.read / list / url) and queues jobs (pipeline.job). Store: answers/main (the user's answers). */
(function () {
  "use strict";
  var P = window.pipeline;
  var DIR = P.dir || "3-build/build-from-deck/";
  var STEPS = DIR + "steps/";
  var TABS = [
    { id: "deck", label: "Deck" }, { id: "questions", label: "Questions" }, { id: "brief", label: "Brief" },
    { id: "plan", label: "Plan" }, { id: "objects", label: "Objects" }, { id: "room", label: "Room" },
    { id: "drawings", label: "Drawings" }, { id: "runner", label: "Runner" },
  ];
  // what each script stage needs before it can run, and who makes it
  var STAGES = {
    S1_INTAKE: { title: "Read the deck", needs: [] },
    S2_DRAFT: { title: "Draft the brief", needs: [{ file: "S1_INTAKE/deck.json", who: "S1" }] },
    S2_FINALIZE: { title: "Finalize the brief", needs: [{ file: "S2_BRIEF/roombrief.draft.json", who: "S2 draft" }, { file: "S2_BRIEF/roombrief.curated.json", who: "Claude" }] },
    S3_GEOMETRY: { title: "Build the plan geometry", needs: [{ file: "S2_BRIEF/roombrief.json", who: "S2" }, { file: "S3_GEOMETRY/trace.px.json", who: "Claude" }] },
    S4_CATALOG: { title: "Snapshot the library", needs: [] },
    S4_CHECK: { title: "Check object bindings", needs: [{ file: "S4_RESOLVE/catalog.json", who: "S4 catalog" }, { file: "S4_RESOLVE/resolve.json", who: "Claude" }] },
    S5_COMPOSE: { title: "Compose the room canvas", needs: [{ file: "S3_GEOMETRY/plan.json", who: "S3" }, { file: "S4_RESOLVE/resolve.json", who: "Claude" }] },
    S6_DRAWINGS: { title: "Draw the drawing set", needs: [{ file: "S5_COMPOSE/" + P.project + ".room.canvas.json", who: "S5" }] },
  };
  var jobs = {}, files = new Set(), answers = {}, questions = null, decks = [], chosenDeck = null, active = "deck";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var readJson = function (rel) { return P.read(rel).then(function (t) { return JSON.parse(t); }, function () { return null; }); };

  // ── tabs (shown in the editor's top bar) ──
  function show(id) {
    active = id;
    document.querySelectorAll("section[data-panel]").forEach(function (s) { s.classList.toggle("on", s.dataset.panel === id); });
    P.setTabs(TABS.map(function (t) { return { id: t.id, label: t.label, count: t.id === "runner" ? Object.keys(jobs).filter(function (k) { return jobs[k].status === "queued" || jobs[k].status === "running"; }).length : 0, amber: t.id === "questions" && questions && !answers.saved }; }), id);
    refresh();
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
      decks = l.filter(function (f) { return /\.(pptx|pdf)$/i.test(f); }).sort();
      if (!chosenDeck || decks.indexOf(chosenDeck) < 0) chosenDeck = decks[decks.length - 1] || null;
    }, function () { decks = []; });
  }

  // ── a stage card: status, log, Run ──
  function argsFor(stage) {
    if (stage === "S1_INTAKE") return chosenDeck ? { deck: "inputs/decks/" + chosenDeck } : null;
    if (stage === "S2_DRAFT") {
      if (!questions || !answers.room) return null;
      var q = (questions.questions || []).filter(function (x) { return x.key === "room"; })[0];
      var r = q && q.room_ids && q.room_ids[answers.room];
      return r ? { project: r.project, room: r.room } : null;
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
      (j && j.next && st === "done" ? '<div class="next">Next: ' + esc(j.next) + "</div>" : "") +
      (j && j.log ? "<details" + (st === "failed" ? " open" : "") + "><summary class=\"muted\">log</summary><pre>" + esc(String(j.log).split("\n").slice(-40).join("\n")) + "</pre></details>" : "");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-run]");
    if (!b) return;
    var s = b.dataset.run;
    b.disabled = true;
    P.job(s, argsFor(s) || {}).then(function () { jobs[s] = { status: "queued", queued: new Date().toISOString() }; refresh(); }, function (err) { alert("Could not queue " + s + ": " + (err && err.message || err)); b.disabled = false; });
  });

  // ── deck tab ──
  var drop = $("#drop"), fileIn = $("#file");
  function upload(f) {
    if (!/\.(pptx|pdf)$/i.test(f.name)) { $("#upload-state").textContent = "Only .pptx or .pdf"; return; }
    $("#upload-state").textContent = "Uploading " + f.name + " (" + (f.size / 1e6).toFixed(1) + " MB)…";
    P.assets.upload(f, { name: f.name, target: "inputs/decks", type: f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation") })
      .then(function (r) {
        $("#upload-state").textContent = "Saved to " + (r.key || "inputs/decks/");
        chosenDeck = String(r.key || "").split("/").pop() || chosenDeck;
        P.emit("deck_uploaded", { key: r.key, name: f.name, bytes: f.size });
        return loadDecks().then(refresh);
      }, function (err) { $("#upload-state").textContent = "Upload failed: " + (err && err.message || err); });
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
    $("#pages").innerHTML = pics.map(function (f) { var u = P.url(STEPS + f); return '<a href="' + u + '" target="_blank"><img src="' + u + '"><span>' + esc(f.split("/").pop()) + "</span></a>"; }).join("");
  }

  // ── questions tab ──
  function renderQuestions() {
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
  function renderObjects() {
    var f = files.has("S4_RESOLVE/resolve.json") ? "S4_RESOLVE/resolve.json" : null;
    if (!f) { $("#objects").innerHTML = '<div class="empty">Claude writes resolve.json after the catalog snapshot.</div>'; return; }
    readJson(STEPS + f).then(function (r) {
      var items = (r && (r.items || r.bindings)) || [];
      $("#objects").innerHTML = table(items, [["item", function (i) { return i.id || i.item || i.specId || ""; }], ["status", function (i) { return i.status || ""; }],
        ["object", function (i) { return i.object || ""; }], ["material", function (i) { return (i.params && i.params.materialPath) || ""; }]]);
    });
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
  }

  function refresh() {
    document.querySelectorAll(".stage[data-stage]").forEach(renderStage);
    renderDeck(); renderQuestions(); renderJobs();
    if (active === "brief") renderBrief();
    if (active === "objects") renderObjects();
    if (active === "room") renderRoom();
    if (active === "plan") $("#plan").innerHTML = imgs("S3_GEOMETRY/", /\.png$/);
    if (active === "drawings") $("#drawings").innerHTML = imgs("S6_DRAWINGS/", /\.png$/) +
      Array.from(files).filter(function (f) { return /^S6_DRAWINGS\/.+\.(pdf|dxf)$/.test(f); }).map(function (f) { return '<a target="_blank" href="' + P.url(STEPS + f) + '"><span>⬇ ' + esc(f.split("/").pop()) + "</span></a>"; }).join("");
  }

  function poll() {
    return Promise.all([loadJobs(), loadFiles()]).then(function () {
      if (!questions && files.has("S1_INTAKE/questions.json")) return readJson(STEPS + "S1_INTAKE/questions.json").then(function (q) { questions = q; });
    }).then(refresh, function () {});
  }

  $("#code").textContent = P.project || "";
  P.db.doc("answers/main").onSnapshot(function (snap) { answers = snap.exists ? snap.data() || {} : {}; if (answers.saved) $("#qstate").textContent = "Saved " + String(answers.saved).slice(0, 16).replace("T", " "); refresh(); });
  show("deck");
  Promise.all([loadDecks(), poll()]).then(function () { setInterval(poll, 3000); setInterval(loadDecks, 15000); });
})();
