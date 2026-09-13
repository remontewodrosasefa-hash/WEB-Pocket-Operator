# CLAUDE.md

Guidance for Claude Code (or any assistant) working in this repository. Read
this before making changes — it exists so a new session doesn't have to
rediscover the same traps and decisions.

## What this is

A browser recreation of Teenage Engineering's **PO-33 K.O!** pocket sampler:
16 pads, 16-step sequencer, one grid of buttons that means something
different depending on mode (SOUND / WRITE / PATTERN / hold-FX). Plain
HTML/CSS/JS, no build step, no framework. Originally a General Assembly
pre-work project by James Benson, being extended since.

Hosted at `https://remontewodrosasefa-hash.github.io/WEB-Pocket-Operator/`.
Git remote: `origin` → that GitHub repo, branch `main`.

**Always use absolute paths.** The shell's cwd defaults to
`/Users/remontewodros/Downloads/po-33-master`, which is stale — the real
project lives at
`/Users/remontewodros/Downloads/Plattenfix Webflow (1)/WEB-Pocket-Operator/`.

## Core architecture

- **Tone.js r12**, old API (`.toMaster()`, `Tone.Sampler`, `Tone.Players`,
  `Tone.Sequence`, `Tone.PitchShift`). `js/Tone.js` is the readable source
  (817KB); `js/Tone.min.js` is what actually ships (254KB, terser output) —
  `index.html` and `sw.js` must both point at the minified file or the
  saving is real but not deployed (this drifted once; see Known traps).
- **`js/po33.js`** is the sequencer engine and touches the DOM **only by
  `id`** — this is what makes restyling/reskinning safe without breaking
  behavior. It owns `newChannelArr` (the pattern data), `channelSettingsArr`,
  `playSound`, `editPattern`, transport state (`play`, `state`, `mode`,
  `view`).
- **Melodic slots 1–8** = one `Tone.Sampler` pitched chromatically across 16
  pads. **Drum slots 9–16** = `Tone.Players`, 16 independent pad buffers per
  slot. A pattern step's `notePitch` is a **0–15 pad index**, not a fixed
  note — this is what lets scale/key changes transpose a melodic part
  instead of breaking it.
- **`js/scale.js`** (v19) is the key/scale system for melodic slots and the
  keyboard — `window.melodicNote(pad)` maps a pad index to a real note.
- Each JS file is a self-contained IIFE that exposes one namespace under
  `window.PO33` (e.g. `PO33.chops`, `PO33.undo`, `PO33.ai`) or
  `window.PO33Lib` / `window.PO33Guide`. Modules poll for their dependencies
  on a `setInterval` at boot rather than assuming load order beyond the
  `<script>` tag sequence in `index.html`.

## Persistence — what lives where

**localStorage** (`po33.*`, all synchronous, all small):
`po33.slots`, `po33.drumpads`, `po33.session`, `po33.projects`,
`po33.currentProject`, `po33.folders`, `po33.scale`, `po33.lfo`,
`po33.haptics`, `po33.metro`, `po33.chanstate`, `po33.keys.track`,
`po33.fxlane`, `po33.scene.xp`, `po33.coached`,
`po33.ai.{unlocked,key,provider,model,models.<provider>}`.
`po33_settings` (underscore, legacy) is write-only — nothing reads it, it's
dead code that's never been cleaned up.

**IndexedDB**, database name `po33`, two object stores:
- `rec` (opened at version 1, in `studio.js`) — user recordings, stored as
  `{ blob, seconds }` WAV blobs, restored into the library on boot.
- `chop` (opened at version 2, in `chopstore.js` — bumping the version
  runs `onupgradeneeded` and adds this store *alongside* `rec` without
  touching it) — chopped/sliced pad audio, also WAV blobs. This store
  exists because chopping builds AudioBuffers in memory with nothing on
  disk; without it, chops looked persisted (pattern data survived a reload)
  but the audio didn't, and steps pointed at silent pads.

**Golden rule for any new persisted feature: one writer per fact.** The
`po33.slots` bug (see below) was two modules both owning "which sample is
in which slot." If you're tempted to snapshot something into a second
place "just in case," don't — pick the one owner and have everything else
read from it.

## Boot sequence

Order matters and is deliberately serialized, not just script-tag order:
`library.js` waits ~1200ms after its own init before calling
`restoreSlots()`/`fillDefaults()`, specifically so `po33.js` finishes
building its Tone nodes first. It exposes `PO33Lib.ready()` (a promise)
for anything that needs to run after slots are restored —
`chopstore.js`'s `boot()` awaits it (falling back to a timeout if
`PO33Lib` never shows up). If you add a module that reads slot contents at
startup, use `PO33Lib.ready()` rather than a fixed timeout; a race here is
exactly how "sample randomly missing on load" bugs happen.

## The two guides — now one

There used to be two separate manuals: a desktop-only `<nav>` sidebar in
`index.html` and a separate flat list in `mobile.js` for the `info` drawer
(the only guide phones ever had). **This is fixed as of v76+.** Content
now lives once, as data, in **`js/guide.js`** (24 numbered sections,
`{g, n, t, b}` — group, number, title, body-html). `mobile.js` renders it
into the `#infoDrawer` accordion, and that drawer is built and usable on
**every** form factor now, not gated to the phone media query. If you edit
the manual, edit `js/guide.js` — do not add guide text anywhere else.

## Full-screen panels — a recurring CSS trap

Several features take the whole LCD screen over by adding a body class and
setting `.lcd { max-height: none }`: `buildOpen` (the `aaa` screen),
`trimOpen`, `projOpen`, `utilOpen`, `lib-lcd`, and `aiOpen` (the assistant).
All of these rules live in `mobile.css` at the **same CSS specificity**
(`body.<class> .lcd`), so whichever is written **later in the file** wins
regardless of which panel is actually open. This has broken twice:

1. A rule capping `.lcd` height on the FX perform tab (so its 4-row grid
   fits) was written after the five panel-expansion rules and silently
   shrank every one of them to ~148px whenever FX happened to be the
   selected tab. Fixed with an explicit `:not(.buildOpen):not(.trimOpen)...`
   guard chain on the FX-tab rule.
2. `#hudArt` (the ambient scene) has a 72px floor that, combined with the
   FX-tab height cap, pushed the sound-name text off the top of the screen.

**If you add a new full-screen panel class, or a new height-capping rule,
you must update the guard chain** in `mobile.css` (search for
`:not(.buildOpen)`) and the matching `PANEL_OPEN` regex in `js/ux.js`
(used to close the first-run coach card early). There's a regression test
for this: `tests/run.js` → *"a full-screen panel fills the screen on every
perform tab."*

## The AI assistant (`js/ai.js`, `js/listen.js`, `js/aiapply.js`)

Hidden behind UTIL → "open assistant" → a name+code gate, then a
bring-your-own-API-key screen (Claude or Gemini). **The gate hides the
feature, it does not secure it** — this is a static site, so the gate
code and any embedded key are readable via View Source. What actually
caps cost is that there is no shared key: each user's key lives only in
their own browser and is sent only to their own provider.

Design rule that governs all three files: **local code measures, the
model talks.** Audio is never uploaded for analysis — `listen.js` measures
real properties (length, onsets, tempo via two independent methods, lead-in
silence, crest factor, brightness) directly from the `AudioBuffer` already
in memory, and those numbers go into the prompt. The model reasons about
exact numbers, never about a WAV it can't actually hear.

If the model proposes a pattern change, it must reply with a fenced
` ```json ` block matching a schema (`aiapply.js` `SCHEMA_DOC`). Every
value is bounds-checked and **rejected outright if invalid — never
clamped** (clamping "step 21" to "step 16" silently makes an edit nobody
asked for). A proposal is previewed and requires an explicit tap to apply;
applying marks one `PO33.undo.markWorld()` so the whole thing reverts in
one press. A slot listed as chopped is never a valid write target — same
rule the `aaa` beat-generator already follows, for the same reason (a chop
is the user's own arrangement of their own sample; overwriting it destroys
work the pattern data can't reconstruct).

Model lists are fetched live from each provider (`PROVIDERS[x].list()`)
and cached in `po33.ai.models.<provider>`, with the hardcoded arrays used
only as a fallback before the first successful fetch. **Do not hardcode
specific model version strings as the only option** — providers retire
them without warning and a hardcoded-only list goes stale within days.

## Testing

`npm test` (from repo root) → `cd tests && npm install && node run.js`.
32 integration tests, no mocks, driving real headless Chrome via
`puppeteer-core` against a `python3 -m http.server` instance, with real
CDP touch input. Tests read actual `AudioBuffer`s to verify sample
identity (see `MAKE_SIGNATURE_BUFFER`/`READ_PADS` in `tests/run.js`) rather
than trusting that a reference didn't change.

Run a single test: `cd tests && node run.js <substring-of-test-name>`.

**Tap helper history — do not "improve" it again without re-reading this.**
`tap(page, sel)` in `run.js` is a thin wrapper over
`elementHandle.tap()`. Two attempts to make it smarter both made things
worse and are recorded in a comment right above the function:
- Retrying on "Node is detached from document" **double-taps** — the node
  usually detaches *because* the first tap already landed and triggered a
  re-render, so the retry is a second, unwanted tap. On a toggle (a
  sequencer step) that reads as on-then-off.
- Tapping by `boundingBox()` coordinates instead of the handle fails
  against panels that re-layout between the measurement and the dispatch
  (the MIX chain editor) — failed 6/6 runs when tried.

If a test is flaky, check whether some panel is re-rendering on an
interval first (see next item) before touching the harness.

**Perf panels should never repaint on a timer unconditionally.** The MIX
tab (`perf.js` `renderMute()`) used to fully rebuild its DOM every 700ms
regardless of whether anything had changed, which both wasted work and
created a real race (a tap could land on a button that had just been
replaced). It's now gated on a signature string (`muteSig()`) — repaint
only if what would be displayed actually changed. Follow this pattern for
any future polling repaint.

## Licensing / do-not-redistribute (see README.md for full detail)

- `PO ALL/` — Teenage Engineering factory samples, **gitignored**, personal
  use only, never redistribute.
- `samples/` — the processed/committed copies actually used by the app;
  this is what ships.
- Sprout Lands, Farm RPG, Mushroom raw art packs — gitignored; only
  extracted sprites under `game/sprites/` are committed, with credit in
  README.
- "PO-33", "Pocket Operator", "K.O!", "Teenage Engineering" are trademarks
  — a real risk if this is ever published under those names commercially;
  currently framed as a fan recreation/homage.

## Working conventions on this project (from prior sessions)

- **Mobile-first, always.** The user plays this on a phone; desktop is
  secondary. When a feature has both a phone and desktop surface, build
  and verify the phone one first, screenshot it at ~390×844, before
  touching desktop styling.
- **Never declare visual work done without a screenshot AND measured
  geometry.** Use `puppeteer-core` from `tests/node_modules`, remove
  `#powerOverlay` to get past the audio gate, screenshot, then assert
  actual pixel numbers (e.g. `labelRect.bottom - nextRect.top < 0`).
  Eyeballing has been wrong here more than once — overlapping transport
  labels, a clipped FX row, pad dots that read backwards until measured.
- Bump **both** `js/boot.js` `APP_VERSION` and `sw.js` `VERSION`
  (`po33-v<n>`) together on any shipped change, and re-run `npm test`
  before considering a change finished.
- `js/build.js` is internally called `aaa` (renamed from "BUILD") — an
  intentionally unreleased/experimental beat generator, reached by a
  triple-tap on the empty part of the LCD (`#hudArt`), deliberately **not**
  documented in the guide and **not** on a labelled button. Don't add it
  to `js/guide.js` or give it a normal button without being asked.

## Deferred / partially-scoped ideas (ask before starting)

- **Hum-to-melody**: pitch-detection pipeline (YIN, framed analysis →
  scale-snap → write to pattern) is scoped but not built. The blocker
  (a real key/scale system) is resolved — `js/scale.js` v19 exists. See
  memory file `po33-hum-to-midi.md` for the build plan.
- **Autotune on recordings**: scoped as an offline "tune to key" step in
  the trim panel, reusing `scale.js` — roughly a day of work, not started.
  `PitchShift` artifacts are acceptable for beat-making, not clean vocal
  correction.
- **Perform-lane editing gaps** (identified, not yet fixed unless asked):
  UTIL's "clear pattern" does not clear the fx lane (only the keyboard
  lane); the MIX tab has no row for the keyboard/fx lanes, only the 16
  sample slots; the fx lane has no undo coverage; neither lane supports
  deleting a single step, only whole-lane clear.
