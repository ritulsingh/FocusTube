// FocusTube — a tiny local server for a distraction-free, single-topic YouTube learning page.
// No dependencies. Needs Node 18+.
//
//   node server.js                         -> no-key mode (uses YouTube's public web search)
//   YT_API_KEY=xxxx node server.js         -> official YouTube Data API v3 mode
//
// Then open http://localhost:5173

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "127.0.0.1"; // set HOST=0.0.0.0 to share on your Wi-Fi
const API_KEY = (process.env.YT_API_KEY || "").trim();
const MIN_SECONDS = 181; // anything 3 min or shorter is treated as a Short and dropped

const cache = new Map(); // simple 15-minute cache so repeat searches are instant
const CACHE_MS = 15 * 60 * 1000;

// ---------- helpers ----------
const text = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join("") : "");

function hmsToSeconds(s) {
  if (!s) return 0;
  return s.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
}

function isoToSeconds(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function timeAgo(dateStr) {
  const s = (Date.now() - new Date(dateStr).getTime()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600]];
  for (const [u, sec] of units) {
    const n = Math.floor(s / sec);
    if (n >= 1) return `${n} ${u}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

// ---------- no-key mode: YouTube's own web search endpoint ----------
async function searchWeb(query, cont) {
  const body = {
    context: { client: { clientName: "WEB", clientVersion: "2.20241101.00.00", hl: "en" } },
  };
  if (cont) body.continuation = cont;
  else {
    body.query = query;
    body.params = "EgIQAQ=="; // "Videos only" filter (no channels, playlists, shelves)
  }
  const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 FocusTube" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`YouTube search failed (HTTP ${res.status})`);
  const json = await res.json();

  const raw = [];
  let next = null;
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) return void raw.push(o.videoRenderer);
    if (o.reelShelfRenderer || o.shelfRenderer) return; // skip Shorts shelves & "People also watched"
    if (o.chipCloudRenderer) return; // filter chips carry their own (wrong) tokens
    const tok = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (tok) next = tok; // the real "next page" token
    for (const k in o) walk(o[k]);
  })(json);

  const videos = [];
  for (const v of raw) {
    const url = v.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "";
    const badges = JSON.stringify(v.badges || []).toLowerCase();
    if (url.startsWith("/shorts")) continue;
    if (!v.lengthText || v.upcomingEventData) continue; // live streams / premieres
    if (badges.includes("live") || badges.includes("members only")) continue;
    const owner = v.ownerText?.runs?.[0] || v.longBylineText?.runs?.[0] || {};
    videos.push({
      id: v.videoId,
      title: text(v.title),
      channel: owner.text || "",
      channelId: owner.navigationEndpoint?.browseEndpoint?.browseId || owner.text || "",
      seconds: hmsToSeconds(text(v.lengthText)),
      duration: text(v.lengthText),
      views: text(v.shortViewCountText) || text(v.viewCountText),
      published: text(v.publishedTimeText),
      description: (v.detailedMetadataSnippets || []).map((d) => text(d.snippetText)).join(" "),
    });
  }
  return { videos, next };
}

// ---------- API-key mode: official YouTube Data API v3 ----------
async function searchApi(query, pageToken) {
  const q = new URLSearchParams({
    part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "50", q: query, key: API_KEY,
  });
  if (pageToken) q.set("pageToken", pageToken);
  const s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`)).json();
  if (s.error) throw new Error(`YouTube API: ${s.error.message}`);
  const ids = (s.items || []).map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return { videos: [], next: null };
  const d = await (
    await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
      part: "snippet,contentDetails,statistics", id: ids.join(","), key: API_KEY,
    })}`)
  ).json();
  if (d.error) throw new Error(`YouTube API: ${d.error.message}`);
  const videos = (d.items || [])
    .filter((v) => v.snippet.liveBroadcastContent === "none")
    .map((v) => {
      const secs = isoToSeconds(v.contentDetails.duration);
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
      const views = Number(v.statistics.viewCount || 0);
      return {
        id: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        seconds: secs,
        duration: (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`,
        views: views ? `${Intl.NumberFormat("en", { notation: "compact" }).format(views)} views` : "",
        published: timeAgo(v.snippet.publishedAt),
        description: v.snippet.description || "",
      };
    });
  return { videos, next: s.nextPageToken || null };
}

async function search(query, cont) {
  const key = `${API_KEY ? "api" : "web"}|${query}|${cont || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.data;
  const data = API_KEY ? await searchApi(query, cont) : await searchWeb(query, cont);
  data.videos = data.videos.filter((v) => v.seconds >= MIN_SECONDS); // no Shorts, ever
  cache.set(key, { t: Date.now(), data });
  return data;
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
      const cont = url.searchParams.get("cont") || "";
      if (!q && !cont) throw new Error("Missing topic");
      const data = await search(q, cont);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...data, mode: API_KEY ? "api" : "no-key" }));
    }
    // Static files from ./public (only these three, nothing else on disk is reachable)
    const files = { "/": "index.html", "/index.html": "index.html", "/style.css": "style.css", "/app.js": "app.js" };
    const types = { html: "text/html", css: "text/css", js: "text/javascript" };
    if (files[url.pathname]) {
      const name = files[url.pathname];
      res.writeHead(200, { "content-type": `${types[name.split(".").pop()]}; charset=utf-8`, "cache-control": "no-cache" });
      return fs.createReadStream(path.join(__dirname, "public", name)).pipe(res);
    }
    res.writeHead(404).end("Not found");
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  FocusTube is running → http://localhost:${PORT}`);
  console.log(`  Mode: ${API_KEY ? "YouTube Data API (key found)" : "no-key (public web search)"}\n`);
});
