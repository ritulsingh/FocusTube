# FocusTube

A distraction-free YouTube learning page. Pick one topic and you only see videos about it. There's no home feed, no Shorts and no recommendations.

## Files

```
focustube/
├── server.js          # tiny Node server: serves the page + /api/search
├── package.json
└── public/
    ├── index.html     # page layout
    ├── style.css      # all styling (dark/light)
    └── app.js         # topics, filtering, grid, player
```

## Run it

You need Node 18 or newer (`node -v`). There's nothing to install.

```bash
node server.js
```

Then open http://localhost:5173

### Optional: use your own YouTube API key

It works without a key. Behind the scenes it uses the same search that youtube.com uses. If that ever breaks, or you want the official route:

1. Go to Google Cloud Console, create a project and enable **YouTube Data API v3**.
2. Create an API key.
3. Start the server with the key:

```bash
YT_API_KEY=your_key_here node server.js
```

The free quota is about 100 searches a day (each search costs 100 units). Results are cached for 15 minutes.

### Share it on your Wi-Fi (phone, laptop)

```bash
HOST=0.0.0.0 node server.js
```

Then open `http://<your-mac-ip>:5173` on the other device. To put it on the internet, deploy the whole folder to any Node host (Render, Railway, Fly). Use the API key mode there, because the no-key mode may get rate-limited from server IPs.

## Focus sessions

Start every learning block with intent:

1. Tap **Start focus session** on a topic, or just click any video. You'll be asked to write one line, *"After this session I want to be able to…"*, and pick **25, 45 or 60 min**.
2. **Zen mode:** while a video plays, everything else disappears. The top bar becomes a slim session bar with your goal, a timer and a progress line. Press **Esc** to get back to the video list and pick the next one.
3. **Only real focus counts.** The timer runs only while the FocusTube tab is open. If you switch tabs, the video pauses, a *drift* is counted, and you come back to *"You stepped away at 12:34. Back to it?"*
4. **When time's up**, or when you press **End session**, you reflect: *Did you get it?* (Yes, Partly or Not yet) and *one thing you can do now*. You can also add 10 minutes and keep going.
5. You then get a summary (time focused, videos, notes, drifts). The home screen shows **Your focus this week**: time, sessions, a day streak and your latest reflections.

Want to watch without a session? Choose **Just watch, no session** in the start dialog.

## Calm mode (on by default)

The **Calm** chip in the toolbar:
- hides view counts and upload dates (social proof pulls you into browsing),
- shows thumbnails in greyscale until you hover, so clickbait faces and arrows lose their pull,
- shows **6 picks at a time** instead of an endless grid. Tap **Show 6 more** if none fit.

## Build your course

- In **Explore**, tap the **+** on a video's thumbnail, or **+ Add to course** while it's playing.
- Open the **My course** tab to see your videos in order, numbered, with a progress bar (for example "3 of 12 done · 4h 20m left").
- Use **↑ ↓** to reorder and **Remove** to drop a video. When a video ends, **Play next** walks through your course in order.
- Each topic has its own course.
- Videos you started but didn't finish appear under **Continue watching**, and the home screen has a **Resume** card for the last one.

## Take timestamp notes

- While a video plays, press **N**. The video pauses and the note gets the current time.
- Type what you learned and press **Enter**. The note saves and the video resumes. **Esc** cancels.
- Click a time (for example `12:34`) to jump back to that moment.
- **Copy notes** copies them as Markdown, with each time linked to that exact second on YouTube. You can paste them into Notion, Obsidian or a video description.
- Cards show a "3 notes" badge so you can see which videos you've studied.

## How it keeps you on topic

- **Must mention words.** Every video must contain each word. In *Very strict* mode the word has to be in the title. In *Strict* mode it can be in the title or the description. `a|b` means either word is fine.
- **No Shorts.** Shorts URLs and anything 3 minutes or shorter are dropped. Live streams, premieres and members-only videos are also removed.
- **Noise words.** Titles with words like `#shorts`, `reaction`, `unboxing` or `giveaway` are hidden.
- **Hide channel.** Hover a video and click *Hide channel* to block that channel for this topic.
- **The player** runs on `youtube-nocookie.com` with related videos turned off. When a video ends, a solid screen covers YouTube's end-screen suggestions and offers the next video from your topic.
- **Can't be embedded.** If a video's owner blocks playback outside YouTube, it's skipped automatically.

Your focus sessions, course lists, notes, watched videos, progress (it resumes where you left off), custom topics and hidden channels are saved in your browser on this computer. Clearing site data for localhost erases them.

## Change the ready-made topics

Edit the `PRESETS` list at the top of `public/app.js`:

```js
{ id: "resolve", name: "Video editing in DaVinci Resolve", query: "davinci resolve tutorial", must: ["davinci"], mode: "title" }
```

## Known limits

- If you pause a video, YouTube's own player can show a small "More videos" strip. Sites can't remove that from an embedded player. The end screen is covered.
- The no-key mode depends on YouTube's internal search format. If it changes and searches start failing, use the API key mode.
