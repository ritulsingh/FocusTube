/* ---------- Topics ---------- */
const PRESETS = [
  { id: "resolve", name: "Video editing in DaVinci Resolve", query: "davinci resolve tutorial", must: ["davinci"], mode: "title", blurb: "Editing, cutting, timeline, workflow", icon: "🎬", hue: 22 },
  { id: "resolve-color", name: "Color grading in DaVinci Resolve", query: "davinci resolve color grading", must: ["davinci", "color|colour|grade|grading|lut"], mode: "all", blurb: "Nodes, LUTs, skin tones, looks", icon: "🎨", hue: 290 },
  { id: "resolve-fusion", name: "Fusion & motion graphics (Resolve)", query: "davinci resolve fusion tutorial", must: ["davinci|fusion", "fusion|motion|title|animation|vfx"], mode: "all", blurb: "Titles, VFX, animation in Fusion", icon: "✨", hue: 200 },
  { id: "resolve-audio", name: "Audio in DaVinci Resolve (Fairlight)", query: "davinci resolve fairlight audio", must: ["davinci|fairlight", "audio|fairlight|sound|voice"], mode: "all", blurb: "Voice cleanup, mixing, sound design", icon: "🎧", hue: 150 },
];
const STOP = new Set("a an the in on of for to with and or how learn learning tutorial tutorials course full beginner beginners basics guide using use my your complete easy step by from 101 class".split(" "));
const NOISE = ["#shorts", "reaction", "unboxing", "giveaway", "meme"];

/* ---------- icons ---------- */
const IC = {
  play: `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
  plus: `<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  check: `<svg class="ic" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>`,
  x: `<svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};

/* ---------- tiny storage helpers (never break if storage is blocked) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("ft:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ft:" + k, JSON.stringify(v)); } catch {} },
};
let myTopics = store.get("myTopics", []);
let watched = store.get("watched", {});        // videoId -> true
let progress = store.get("progress", {});      // videoId -> {t, d}
let hiddenCh = store.get("hiddenChannels", {}); // topicId -> [channelId]
let courses = store.get("courses", {});        // topicId -> [video, ...] in your order
let notes = store.get("notes", {});            // videoId -> [{t, text}]
let recent = store.get("recent", []);          // [{topicId, v}] most recent first

/* ---------- state ---------- */
let topic = null, videos = [], seen = new Set(), next = null, sub = "", loading = false, current = null, reqId = 0;
let view = "explore";        // "explore" | "course"
let playingFrom = "explore"; // which list "Play next" walks through
const filt = { len: "any", hideWatched: false };
let calm = store.get("calm", true), shown = 6;   // calm mode is on by default
let session = store.get("activeSession", null);  // the running focus session, if any
let sessions = store.get("sessions", []);        // finished sessions, newest first
const $ = (id) => document.getElementById(id);
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
};
const hm = (sec) => { if (sec > 0 && sec < 60) return "<1m"; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const allTopics = () => [...PRESETS, ...myTopics];
const look = (t) => {
  if (t.icon) return { icon: t.icon, hue: t.hue };
  let h = 0; for (const c of t.name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { icon: `<b>${esc(t.name.trim()[0].toUpperCase())}</b>`, hue: h };
};
const iconTile = (t, cls = "t-icon") => { const l = look(t); return `<div class="${cls}" style="--h:${l.hue}">${l.icon}</div>`; };
const pctOf = (id) => { const p = progress[id]; return p && p.d ? Math.min(100, (p.t / p.d) * 100) : 0; };
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/* ---------- the topic filter: the heart of "never off-topic" ---------- */
function onTopic(v) {
  const title = norm(v.title);
  const hay = topic.mode === "title" ? title : title + " " + norm(v.description);
  const mustOk = topic.must.every((term) => term.split("|").some((alt) => alt.trim() && hay.includes(norm(alt.trim()))));
  const noisy = NOISE.some((w) => title.includes(w));
  const blocked = (hiddenCh[topic.id] || []).includes(v.channelId);
  return mustOk && !noisy && !blocked;
}
function lengthOk(v) {
  const s = v.seconds, f = filt.len;
  return f === "any" || (f === "short" && s <= 1200) || (f === "long" && s > 1200) || (f === "course" && s >= 3600);
}
const visible = () => videos.filter((v) => onTopic(v) && lengthOk(v) && !(filt.hideWatched && watched[v.id]));
function ruleText(t) {
  const words = t.must.map((m) => m.split("|").map((w) => `<b>${esc(w)}</b>`).join(" or ")).join(", plus ");
  return `Only videos that mention ${words} in the ${t.mode === "title" ? "title" : "title or description"}. No Shorts.`;
}

/* ---------- my course (saved, ordered list per topic) ---------- */
const course = () => (topic ? (courses[topic.id] = courses[topic.id] || []) : []);
const inCourse = (id) => course().some((v) => v.id === id);
const slim = (v) => ({ id: v.id, title: v.title, channel: v.channel, channelId: v.channelId, seconds: v.seconds, duration: v.duration, views: v.views, published: v.published });
function saveCourses() { store.set("courses", courses); }
function toggleCourse(v) {
  if (inCourse(v.id)) courses[topic.id] = course().filter((x) => x.id !== v.id);
  else course().push(slim(v));
  saveCourses(); render(); renderNow();
}
function moveInCourse(id, dir) {
  const list = course(), i = list.findIndex((v) => v.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveCourses(); render();
}

/* ---------- views ---------- */
function showPicker() {
  topic = null; closePlayer();
  $("pickerView").classList.remove("hidden"); $("topicView").classList.add("hidden");
  $("topicPill").classList.add("hidden"); $("changeTopic").classList.add("hidden");
  document.title = "FocusTube";
  store.set("lastTopic", null);
  renderPicker();
  window.scrollTo(0, 0);
}
function renderPicker() {
  const card = (t, mine) => {
    const c = courses[t.id] || [], done = c.filter((v) => watched[v.id]).length;
    const sub = c.length ? `My course: ${done} of ${c.length} done` : t.blurb || "Must mention: " + t.must.join(", ");
    return `<button class="topic-card" data-id="${esc(t.id)}">
      ${iconTile(t)}
      <div><div class="t">${esc(t.name)}</div><div class="s">${esc(sub)}</div>
        ${c.length ? `<div class="mini-bar"><span style="width:${(done / c.length) * 100}%"></span></div>` : ""}</div>
      ${mine ? `<span class="x" data-del="${esc(t.id)}" title="Remove topic">${IC.x}</span>` : ""}</button>`;
  };
  $("presetCards").innerHTML = PRESETS.map((t) => card(t)).join("");
  $("myCards").innerHTML = myTopics.map((t) => card(t, true)).join("");
  $("myTopicsBlock").classList.toggle("hidden", !myTopics.length);
  renderStats();

  // Continue learning: the most recent video you didn't finish
  const r = recent.find((x) => !watched[x.v.id] && allTopics().some((t) => t.id === x.topicId));
  $("continueBlock").classList.toggle("hidden", !r);
  if (r) {
    const t = allTopics().find((t) => t.id === r.topicId), p = progress[r.v.id] || {};
    $("continueCard").innerHTML = `<button class="continue-card" data-topic="${esc(t.id)}" data-vid="${r.v.id}">
      <div class="thumb"><img src="${thumb(r.v.id)}" alt=""><span class="badge dur">${esc(r.v.duration)}</span>
        <span class="progress" style="width:${pctOf(r.v.id)}%"></span></div>
      <div><div class="c-topic">${esc(t.name)}</div><div class="c-title">${esc(r.v.title)}</div>
        <div class="hint">${p.t ? `Stopped at ${clock(p.t)} · ${hm(Math.max(0, (p.d || r.v.seconds) - p.t))} left` : esc(r.v.channel)}</div></div>
      <span class="btn primary">${IC.play.replace("<svg", '<svg class="ic" style="fill:currentColor;stroke:none"')} Resume</span></button>`;
  }
}
function openTopic(t) {
  topic = t; store.set("lastTopic", t.id);
  $("pickerView").classList.add("hidden"); $("topicView").classList.remove("hidden");
  const l = look(t);
  $("topicPill").innerHTML = `<span class="dot" style="background:hsl(${l.hue} 90% 55% / .2)">${l.icon}</span><span class="lbl">Learning</span><b>${esc(t.name)}</b>`;
  $("topicPill").classList.remove("hidden"); $("changeTopic").classList.remove("hidden");
  $("topicIcon").outerHTML = iconTile(t, "t-icon\" id=\"topicIcon");
  $("topicTitle").textContent = t.name;
  $("topicRule").innerHTML = ruleText(t);
  $("strictChip").classList.toggle("active", t.mode === "title");
  $("sub").value = ""; sub = "";
  document.title = `${t.name} · FocusTube`;
  setView(store.get("view:" + t.id, "explore"));
  restart();
  window.scrollTo(0, 0);
}
function setView(v) {
  view = v; if (topic) store.set("view:" + topic.id, v);
  $("tabExplore").classList.toggle("active", v === "explore");
  $("tabCourse").classList.toggle("active", v === "course");
  $("toolbar").classList.toggle("hidden", v === "course");
  $("courseHead").classList.toggle("hidden", v !== "course");
  render();
}

/* ---------- fetching ---------- */
function restart() {
  shown = 6; reqId++; videos = []; seen = new Set(); next = null; loading = false;
  $("error").classList.add("hidden");
  load(true);
}
async function load(first) {
  if (loading) return; loading = true;
  const my = reqId, want = visible().length + 18;
  render();
  try {
    let pages = 0;
    do {
      const qs = new URLSearchParams(first && pages === 0 ? { q: [topic.query, sub].filter(Boolean).join(" ") } : { q: topic.query, cont: next });
      const r = await fetch("/api/search?" + qs);
      const data = await r.json();
      if (my !== reqId) return; // user switched topic mid-load
      if (data.error) throw new Error(data.error);
      for (const v of data.videos) if (!seen.has(v.id)) { seen.add(v.id); videos.push(v); }
      next = data.next; pages++; first = false;
      render();
    } while (next && visible().length < want && pages < 6);
  } catch (e) {
    $("error").textContent = "Couldn't load videos: " + e.message + " (is the server running?)";
    $("error").classList.remove("hidden");
  } finally {
    if (my === reqId) { loading = false; render(); }
  }
}

/* ---------- rendering ---------- */
function card(v, i, inCourseView) {
  const pct = pctOf(v.id), n = (notes[v.id] || []).length, saved = inCourse(v.id);
  const controls = inCourseView
    ? `<span class="course-ctl">
         <button data-move="-1" data-vid="${v.id}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
         <button data-move="1" data-vid="${v.id}" title="Move down" ${i === course().length - 1 ? "disabled" : ""}>↓</button>
         <button data-course="${v.id}" title="Remove from course">Remove</button></span>`
    : `<button class="hide-ch" data-hide="${esc(v.channelId)}" title="Never show this channel in this topic">Hide channel</button>`;
  return `<article class="vid ${current && current.id === v.id ? "playing" : ""}" data-id="${v.id}">
    <div class="thumb"><img loading="lazy" src="${thumb(v.id)}" alt="">
      <div class="play-hint"><span>${IC.play}</span></div>
      ${inCourseView ? `<span class="badge num">${i + 1}</span>`
        : `<button class="save-btn ${saved ? "on" : ""}" data-course="${v.id}" title="${saved ? "In your course (click to remove)" : "Add to my course"}">${saved ? IC.check : IC.plus}</button>`}
      ${watched[v.id] ? `<span class="badge watched">${IC.check}Watched</span>` : ""}
      ${n ? `<span class="badge note-badge">✎ ${n}</span>` : ""}
      <span class="badge dur">${esc(v.duration)}</span>
      ${!watched[v.id] && pct > 2 ? `<span class="progress" style="width:${pct}%"></span>` : ""}
    </div>
    <div class="vid-body">
      <h3 class="title" title="${esc(v.title)}">${esc(v.title)}</h3>
      <div class="meta"><span class="ch">${esc(v.channel)}</span></div>
      <div class="meta"><span>${calm ? "" : esc([v.views, v.published].filter(Boolean).join(" · "))}</span>${controls}</div>
    </div>
  </article>`;
}
const skeletons = (n) => Array.from({ length: n }, () =>
  `<div class="vid skel"><div class="thumb"></div><div class="s-line"></div><div class="s-line short"></div></div>`).join("");

function render() {
  if (!topic) return;
  $("courseCount").textContent = course().length || "";
  if (view === "course") { $("continueRow").classList.add("hidden"); return renderCourse(); }

  const all = visible();
  // Calm mode: a few good picks instead of an endless grid
  const list = calm ? all.slice(0, shown) : all;
  const pending = loading && list.length < (calm ? shown : Infinity);
  $("grid").innerHTML = list.map((v, i) => card(v, i, false)).join("") + (pending ? skeletons(list.length ? (calm ? shown - list.length : 4) : calm ? 6 : 12) : "");
  const off = videos.length - videos.filter(onTopic).length;
  $("status").textContent = loading && !all.length ? "Finding videos…"
    : (calm ? `${list.length} picks. Choose one and start.` : `${all.length} videos`)
      + (off ? ` · ${off} off-topic result${off > 1 ? "s" : ""} filtered out` : "");
  if (!loading && !all.length) $("grid").innerHTML = `<div class="empty">No matching videos yet. Try <b>Load more</b>, turn off <b>Very strict</b>, or use fewer "must mention" words.</div>`;
  const moreHidden = calm && all.length > list.length;
  $("loadMore").textContent = calm ? "Show 6 more" : "Load more videos";
  $("loadMore").classList.toggle("hidden", loading || (!moreHidden && !next));
  renderContinue();
}

function renderContinue() {
  const items = recent.filter((r) => r.topicId === topic.id && !watched[r.v.id] && pctOf(r.v.id) > 2 && (!current || current.id !== r.v.id)).slice(0, 8);
  $("continueRow").classList.toggle("hidden", !items.length || !!sub);
  $("continueList").innerHTML = items.map(({ v }) => {
    const p = progress[v.id];
    return `<button class="mini" data-cont="${v.id}">
      <div class="thumb"><img src="${thumb(v.id)}" alt=""><span class="progress" style="width:${pctOf(v.id)}%"></span></div>
      <div><div class="m-title">${esc(v.title)}</div><div class="m-left">${hm(Math.max(0, p.d - p.t))} left</div></div></button>`;
  }).join("");
}

function renderCourse() {
  const c = course(), done = c.filter((v) => watched[v.id]).length;
  const left = c.filter((v) => !watched[v.id]).reduce((s, v) => s + Math.max(0, v.seconds - ((progress[v.id] || {}).t || 0)), 0);
  $("courseDone").textContent = c.length ? `${done} of ${c.length} done` : "Your course is empty";
  $("courseLeft").textContent = c.length ? (left ? `${hm(left)} left` : "All done 🎉") : "Add videos from Explore to build it.";
  $("courseBar").style.width = c.length ? `${(done / c.length) * 100}%` : "0";
  $("status").textContent = c.length ? "Plays top to bottom. Use ↑ ↓ to reorder." : "";
  $("grid").innerHTML = c.length ? c.map((v, i) => card(v, i, true)).join("")
    : `<div class="empty">Go to <b>Explore</b> and tap <b>+</b> on any video you want to learn from.<br>They'll line up here in order, and you can tick them off as you go.</div>`;
  $("loadMore").classList.add("hidden");
}

/* ---------- player (YouTube IFrame API, privacy-enhanced domain) ---------- */
let player = null, ytReady = null, tick = null;
function loadYT() {
  if (!ytReady) ytReady = new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
  });
  return ytReady;
}
async function play(v, from = view) {
  current = v; playingFrom = from;
  if (session) {
    if (!session.videos.includes(v.id)) session.videos.push(v.id);
    document.body.classList.add("zen-playing"); saveSession();
  }
  recent = [{ topicId: topic.id, v: slim(v) }, ...recent.filter((r) => r.v.id !== v.id)].slice(0, 30); store.set("recent", recent);
  render(); renderNow(); renderNotes();
  $("playerZone").classList.remove("hidden"); $("endcard").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  await loadYT();
  const p = progress[v.id], start = p && !watched[v.id] && p.t > 15 && p.t < p.d - 30 ? Math.floor(p.t) : 0;
  if (player) { player.loadVideoById({ videoId: v.id, startSeconds: start }); return; }
  player = new YT.Player("player", {
    host: "https://www.youtube-nocookie.com", videoId: v.id,
    playerVars: { autoplay: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, start },
    events: { onStateChange: onState, onError: onErr },
  });
}
function renderNow() {
  if (!current) return;
  $("nowTitle").textContent = current.title;
  $("nowMeta").textContent = [current.channel, current.duration, current.views, current.published].filter(Boolean).join(" · ");
  const saved = inCourse(current.id);
  $("nowCourse").innerHTML = saved ? `${IC.check} In my course` : `${IC.plus} Add to course`;
  $("nowCourse").className = "btn small " + (saved ? "saved" : "primary");
}
function onState(e) {
  clearInterval(tick);
  if (e.data === YT.PlayerState.PLAYING) {
    $("endcard").classList.add("hidden");
    tick = setInterval(saveProgress, 5000);
  }
  if (e.data === YT.PlayerState.ENDED) {
    watched[current.id] = true; store.set("watched", watched);
    // Cover YouTube's end screen so it can't suggest anything off-topic.
    const n = nextVideo();
    $("nextTitle").textContent = n ? "Up next: " + n.title
      : playingFrom === "course" ? "You've finished everything in your course 🎉" : "That's the last one loaded. Hit “Load more videos” below.";
    $("playNext").classList.toggle("hidden", !n);
    $("endcard").classList.remove("hidden");
    render();
  }
}
function onErr() {
  // 101/150 = owner disabled embedding; skip it quietly so you never get bounced to youtube.com
  const bad = current; const n = nextVideo(bad);
  videos = videos.filter((v) => v.id !== bad.id);
  recent = recent.filter((r) => r.v.id !== bad.id); store.set("recent", recent);
  render();
  $("status").textContent = `Skipped “${bad.title}” (its owner doesn't allow playing outside YouTube).`;
  if (n) play(n, playingFrom); else closePlayer();
}
function saveProgress() {
  if (!player || !current || !player.getCurrentTime) return;
  progress[current.id] = { t: player.getCurrentTime(), d: player.getDuration() };
  if (progress[current.id].d && progress[current.id].t / progress[current.id].d > 0.92) watched[current.id] = true;
  store.set("progress", progress); store.set("watched", watched);
}
function nextVideo(from = current) {
  const list = playingFrom === "course" ? course() : visible();
  const i = list.findIndex((v) => v.id === from.id);
  return list.slice(i + 1).find((v) => !watched[v.id]) || null;
}
function closePlayer() {
  clearInterval(tick); saveProgress();
  if (player && player.stopVideo) player.stopVideo();
  current = null; $("playerZone").classList.add("hidden"); $("driftCard").classList.add("hidden");
  document.body.classList.remove("zen-playing");
  if (topic) render();
}
const now = () => (player && player.getCurrentTime ? player.getCurrentTime() : 0);

/* ---------- timestamp notes ---------- */
let noteT = 0, wasPlaying = false;
function stampNote() { noteT = now(); $("noteTime").textContent = clock(noteT); }
function renderNotes() {
  if (!current) return;
  const list = notes[current.id] || [];
  $("noteList").innerHTML = list.length
    ? list.map((n, i) => `<li><button class="stamp" data-seek="${n.t}" title="Jump to ${clock(n.t)}">${clock(n.t)}</button>
        <span class="note-text">${esc(n.text)}</span>
        <button class="note-del" data-delnote="${i}" title="Delete note">${IC.x}</button></li>`).join("")
    : `<li class="note-empty">No notes yet.<br>Press <kbd>N</kbd> while watching, type what you learned and hit <kbd>Enter</kbd>. Click a time later to jump back to it.</li>`;
  $("noteCount").textContent = list.length ? `${list.length} note${list.length > 1 ? "s" : ""}` : "";
  $("copyNotes").disabled = !list.length;
  stampNote();
}
function addNote(text) {
  const list = (notes[current.id] = notes[current.id] || []);
  list.push({ t: Math.floor(noteT), text });
  list.sort((a, b) => a.t - b.t);
  if (session) { session.notes++; saveSession(); }
  store.set("notes", notes); renderNotes(); render();
}
async function copyNotes() {
  const v = current, list = notes[v.id] || [];
  const md = `## ${v.title}\nhttps://youtu.be/${v.id}\n\n` +
    list.map((n) => `- [${clock(n.t)}](https://youtu.be/${v.id}?t=${n.t}) ${n.text}`).join("\n") + "\n";
  try { await navigator.clipboard.writeText(md); }
  catch { const t = document.createElement("textarea"); t.value = md; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  $("copyNotes").textContent = "Copied ✓"; setTimeout(() => ($("copyNotes").textContent = "Copy notes"), 1500);
}

/* ---------- events ---------- */
$("presetCards").onclick = $("myCards").onclick = (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); myTopics = myTopics.filter((t) => t.id !== del.dataset.del); store.set("myTopics", myTopics); return renderPicker(); }
  const c = e.target.closest(".topic-card"); if (!c) return;
  openTopic(allTopics().find((t) => t.id === c.dataset.id));
};
$("continueCard").onclick = (e) => {
  const c = e.target.closest("[data-topic]"); if (!c) return;
  const r = recent.find((x) => x.v.id === c.dataset.vid);
  openTopic(allTopics().find((t) => t.id === c.dataset.topic)); play(r.v, "explore");
};
$("continueList").onclick = (e) => {
  const c = e.target.closest("[data-cont]"); if (!c) return;
  play(recent.find((x) => x.v.id === c.dataset.cont).v);
};
$("cName").oninput = () => {
  const words = norm($("cName").value).split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w));
  $("cMust").placeholder = words.length ? words.join(", ") : "auto-filled from the topic";
};
$("customForm").onsubmit = (e) => {
  e.preventDefault();
  const name = $("cName").value.trim(); if (!name) return;
  let must = $("cMust").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!must.length) must = $("cMust").placeholder.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("auto"));
  const t = { id: "my-" + Date.now(), name, query: name, must, mode: $("cMode").value };
  myTopics = [t, ...myTopics.filter((x) => norm(x.name) !== norm(name))]; store.set("myTopics", myTopics);
  $("customForm").reset(); openTopic(t);
};
$("changeTopic").onclick = $("homeBtn").onclick = showPicker;
$("tabExplore").onclick = () => setView("explore");
$("tabCourse").onclick = () => setView("course");

$("grid").onclick = (e) => {
  const find = (id) => videos.find((v) => v.id === id) || course().find((v) => v.id === id);
  const h = e.target.closest("[data-hide]");
  if (h) {
    (hiddenCh[topic.id] = hiddenCh[topic.id] || []).push(h.dataset.hide); store.set("hiddenChannels", hiddenCh);
    return render();
  }
  const c = e.target.closest("[data-course]"); if (c) return toggleCourse(find(c.dataset.course));
  const m = e.target.closest("[data-move]"); if (m) return moveInCourse(m.dataset.vid, Number(m.dataset.move));
  const card = e.target.closest(".vid:not(.skel)"); if (!card) return;
  const v = find(card.dataset.id);
  session ? play(v) : startModal(v); // no session yet? set an intention first
};
$("nowCourse").onclick = () => current && toggleCourse(current);
$("loadMore").onclick = () => {
  if (!calm) return load(false);
  shown += 6;
  if (visible().length < shown && next) load(false); else render();
};
let subTimer; $("sub").oninput = () => { clearTimeout(subTimer); subTimer = setTimeout(() => { sub = $("sub").value.trim(); restart(); }, 500); };
$("lenChips").onclick = (e) => {
  const c = e.target.closest("[data-len]"); if (!c) return;
  filt.len = c.dataset.len;
  document.querySelectorAll("#lenChips .chip").forEach((x) => x.classList.toggle("active", x === c));
  render();
};
$("strictChip").onclick = () => {
  topic.mode = topic.mode === "title" ? "all" : "title";
  $("strictChip").classList.toggle("active", topic.mode === "title");
  $("topicRule").innerHTML = ruleText(topic);
  render(); if (visible().length < 12 && next) load(false);
};
$("watchedChip").onclick = () => { filt.hideWatched = !filt.hideWatched; $("watchedChip").classList.toggle("active", filt.hideWatched); render(); };
$("playNext").onclick = () => { const n = nextVideo(); if (n) play(n, playingFrom); };
$("replay").onclick = () => { $("endcard").classList.add("hidden"); player.seekTo(0); player.playVideo(); };
$("closePlayer").onclick = closePlayer;

// Notes: N (or focusing the box) stamps the time and pauses; Enter saves and resumes.
function beginNote() {
  if (!$("noteInput").value) stampNote();
  if (player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) { wasPlaying = true; player.pauseVideo(); }
}
function endNote() { if (wasPlaying && player) player.playVideo(); wasPlaying = false; }
$("noteInput").onfocus = beginNote;
$("noteTime").onclick = () => { stampNote(); $("noteInput").focus(); };
$("noteForm").onsubmit = (e) => {
  e.preventDefault();
  const text = $("noteInput").value.trim(); if (!text || !current) return;
  addNote(text); $("noteInput").value = ""; $("noteInput").blur();
  endNote();
};
$("noteList").onclick = (e) => {
  const s = e.target.closest("[data-seek]");
  if (s) { player.seekTo(Number(s.dataset.seek), true); player.playVideo(); return; }
  const d = e.target.closest("[data-delnote]");
  if (d) { notes[current.id].splice(Number(d.dataset.delnote), 1); store.set("notes", notes); renderNotes(); render(); }
};
$("copyNotes").onclick = copyNotes;

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (!$("modal").classList.contains("hidden")) { if (e.key === "Escape" && !modalLocked) closeModal(); return; }
  if (e.key === "Escape") {
    if (typing) { e.target.blur(); if (e.target === $("noteInput")) endNote(); return; }
    if (current) closePlayer();
  }
  if (!typing && current && (e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey) {
    e.preventDefault(); beginNote(); $("noteInput").focus();
  }
});
window.addEventListener("beforeunload", saveProgress);

/* =====================================================================
   Focus session: set an intention, focus with a timer, reflect at the end
   ===================================================================== */
const GOAL_IDEAS = {
  resolve: ["edit a talking-head video start to finish", "cut and trim clips fast on the timeline", "export a video for YouTube"],
  "resolve-color": ["colour-correct my footage", "build a node tree for a look", "fix skin tones"],
  "resolve-fusion": ["make an animated title", "track text onto a moving shot", "build a simple lower third"],
  "resolve-audio": ["clean up my voice recording", "mix voice with background music", "remove background noise"],
};
let modalLocked = false, pendingDrift = null, sessionTick = null;

function saveSession() { store.set("activeSession", session); }
function openModal(html, locked = false) {
  modalLocked = locked;
  $("modalCard").innerHTML = html; $("modal").classList.remove("hidden");
  const f = $("modalCard").querySelector("input, textarea"); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() { $("modal").classList.add("hidden"); $("modalCard").innerHTML = ""; modalLocked = false; }
$("modal").onclick = (e) => { if (e.target === $("modal") && !modalLocked) closeModal(); };

function startModal(v) {
  const ideas = GOAL_IDEAS[topic.id] || [`explain the basics of ${topic.name}`];
  const last = store.get("lastMinutes", 25);
  openModal(`
    <h2>Start a focus session</h2>
    <p class="sub">One clear goal turns watching into learning.</p>
    ${v ? `<div class="modal-video"><img src="${thumb(v.id)}" alt=""><span>${esc(v.title)}</span></div>` : ""}
    <form id="mForm">
      <label class="f">After this session I want to be able to…
        <input id="mGoal" type="text" maxlength="140" placeholder="e.g. ${esc(ideas[0])}" autocomplete="off" required />
      </label>
      <div class="examples">${ideas.map((i) => `<button type="button" data-idea="${esc(i)}">${esc(i)}</button>`).join("")}</div>
      <label class="f">How long will you focus?
        <div class="chips" id="mMins">${[25, 45, 60].map((m) => `<button type="button" class="chip ${m === last ? "active" : ""}" data-min="${m}">${m} min</button>`).join("")}</div>
      </label>
      <div class="modal-actions">
        ${v ? `<button type="button" id="mJust" class="btn ghost small left">Just watch, no session</button>` : ""}
        <button type="button" id="mCancel" class="btn">Cancel</button>
        <button type="submit" class="btn primary">Start session</button>
      </div>
    </form>`);
  let mins = last;
  $("mMins").onclick = (e) => {
    const c = e.target.closest("[data-min]"); if (!c) return;
    mins = Number(c.dataset.min);
    $("mMins").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
  };
  $("modalCard").querySelector(".examples").onclick = (e) => {
    const b = e.target.closest("[data-idea]"); if (b) { $("mGoal").value = b.dataset.idea; $("mGoal").focus(); }
  };
  $("mCancel").onclick = closeModal;
  if (v) $("mJust").onclick = () => { closeModal(); play(v); };
  $("mForm").onsubmit = (e) => {
    e.preventDefault();
    const goal = $("mGoal").value.trim(); if (!goal) return;
    store.set("lastMinutes", mins); closeModal();
    session = { id: Date.now(), topicId: topic.id, topicName: topic.name, goal, minutes: mins, focused: 0, drifts: 0, videos: [], notes: 0, start: Date.now() };
    saveSession(); applySessionUI();
    if (v) play(v); else window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

function applySessionUI() {
  const on = !!session;
  document.body.classList.toggle("in-session", on);
  $("sessionBar").classList.toggle("hidden", !on);
  if (!on) { document.body.classList.remove("zen-playing", "paused-session"); clearInterval(sessionTick); sessionTick = null; return; }
  $("sGoal").textContent = session.goal; $("sGoal").title = session.goal;
  updateTimer();
  if (!sessionTick) sessionTick = setInterval(onSecond, 1000);
}
function updateTimer() {
  const total = session.minutes * 60, left = total - session.focused;
  $("sTime").textContent = left >= 0 ? clock(left) : "+" + clock(-left);
  $("sBar").style.width = Math.min(100, (session.focused / total) * 100) + "%";
  $("sDrift").textContent = session.drifts ? `${session.drifts} drift${session.drifts > 1 ? "s" : ""}` : "";
  $("sDrift").classList.toggle("hidden", !session.drifts);
}
// Only time with this tab open (and no dialog up) counts as focused.
function onSecond() {
  if (!session) return;
  const counting = !document.hidden && $("modal").classList.contains("hidden");
  document.body.classList.toggle("paused-session", !counting);
  if (!counting) return;
  session.focused++;
  if (session.focused % 5 === 0) saveSession();
  updateTimer();
  if (session.focused === session.minutes * 60) {
    if (player && player.pauseVideo) player.pauseVideo();
    reflectModal(true);
  }
}

// Leaving the tab mid-session pauses the video and counts a drift.
document.addEventListener("visibilitychange", () => {
  if (!session) return;
  if (document.hidden) {
    session.drifts++; saveSession();
    if (current && player && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
      pendingDrift = now(); player.pauseVideo();
    }
  } else {
    updateTimer();
    if (pendingDrift !== null && current) {
      $("driftText").innerHTML = `You stepped away at <b>${clock(pendingDrift)}</b>.<br>Your goal: ${esc(session.goal)}`;
      $("driftCard").classList.remove("hidden");
    }
    pendingDrift = null;
  }
});
$("driftResume").onclick = () => { $("driftCard").classList.add("hidden"); if (player) player.playVideo(); };

function reflectModal(timeUp) {
  openModal(`
    <div class="big-emoji">${timeUp ? "⏰" : "🧭"}</div>
    <h2>${timeUp ? "Time's up. Nice focus!" : "Wrap up your session"}</h2>
    <p class="sub">Your goal was: <b>${esc(session.goal)}</b></p>
    <form id="rForm">
      <label class="f">Did you get it?
        <div class="chips" id="rGot">
          <button type="button" class="chip" data-got="yes">✅ Yes</button>
          <button type="button" class="chip" data-got="partly">🌗 Partly</button>
          <button type="button" class="chip" data-got="no">🌱 Not yet</button>
        </div>
      </label>
      <label class="f">One thing you can do now that you couldn't before
        <textarea id="rLearned" maxlength="400" placeholder="In your own words. This is what makes it stick."></textarea>
      </label>
      <div class="modal-actions">
        ${timeUp ? `<button type="button" id="rMore" class="btn ghost small left">+10 min, keep going</button>`
          : `<button type="button" id="rBack" class="btn ghost small left">Keep going</button>`}
        <button type="submit" class="btn primary">Save &amp; finish</button>
      </div>
    </form>`, timeUp);
  let got = null;
  $("rGot").onclick = (e) => {
    const c = e.target.closest("[data-got]"); if (!c) return;
    got = c.dataset.got; $("rGot").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
  };
  if (timeUp) $("rMore").onclick = () => { session.minutes += 10; saveSession(); updateTimer(); closeModal(); if (current && player) player.playVideo(); };
  else $("rBack").onclick = closeModal;
  $("rForm").onsubmit = (e) => { e.preventDefault(); finishSession(got, $("rLearned").value.trim()); };
}
function finishSession(got, learned) {
  const s = { ...session, end: Date.now(), got, learned };
  sessions = [s, ...sessions].slice(0, 500); store.set("sessions", sessions);
  session = null; saveSession(); closePlayer(); applySessionUI();
  const icon = { yes: "🎉", partly: "🌗", no: "🌱" }[got] || "✅";
  openModal(`
    <div class="big-emoji">${icon}</div>
    <h2>Session saved</h2>
    <p class="sub">${esc(s.goal)}</p>
    <div class="summary">
      <div><b>${hm(s.focused)}</b><span>focused</span></div>
      <div><b>${s.videos.length}</b><span>video${s.videos.length === 1 ? "" : "s"}</span></div>
      <div><b>${s.notes}</b><span>note${s.notes === 1 ? "" : "s"}</span></div>
      <div><b>${s.drifts}</b><span>drift${s.drifts === 1 ? "" : "s"}</span></div>
    </div>
    ${learned ? `<p class="sub">“${esc(learned)}”</p>` : ""}
    <div class="modal-actions"><button id="sDone" class="btn primary">Done</button></div>`);
  $("sDone").onclick = closeModal;
}
$("startSession").onclick = () => startModal(null);
$("endSession").onclick = () => { if (player && player.pauseVideo && current) player.pauseVideo(); reflectModal(false); };

/* ---------- home: this week's focus + recent reflections ---------- */
function renderStats() {
  const weekAgo = Date.now() - 7 * 864e5;
  const week = sessions.filter((s) => s.start >= weekAgo);
  $("statsBlock").classList.toggle("hidden", !sessions.length);
  if (!sessions.length) return;
  $("stWeek").textContent = hm(week.reduce((a, s) => a + s.focused, 0));
  $("stSessions").textContent = week.length;
  const days = new Set(sessions.map((s) => new Date(s.start).toDateString()));
  let streak = 0, d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  $("stStreak").textContent = streak;
  $("reflections").innerHTML = sessions.filter((s) => s.learned).slice(0, 3).map((s) => `
    <li><span class="r-icon">${{ yes: "✅", partly: "🌗", no: "🌱" }[s.got] || "📝"}</span>
      <div><div class="r-goal">${esc(s.goal)}</div><div class="r-learned">${esc(s.learned)}</div>
      <div class="r-meta">${esc(s.topicName || "")} · ${hm(s.focused)} · ${new Date(s.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div></div></li>`).join("");
}

/* ---------- calm mode ---------- */
function applyCalm() {
  document.body.classList.toggle("calm", calm);
  $("calmChip").classList.toggle("active", calm);
}
$("calmChip").onclick = () => { calm = !calm; store.set("calm", calm); shown = 6; applyCalm(); render(); };

/* ---------- boot: reopen the last topic (or your running session), never a feed ---------- */
applyCalm();
const last = session ? session.topicId : store.get("lastTopic", null), lt = allTopics().find((t) => t.id === last);
if (session && !lt) { session = null; saveSession(); }
lt ? openTopic(lt) : showPicker();
applySessionUI();
