# PO-33 Knock Out! — browser edition

A playable recreation of Teenage Engineering's **Pocket Operator PO-33 K.O!**, a
credit-card-sized sampler / drum machine / step sequencer.

Everything the hardware does happens through one grid of 16 buttons: those same
buttons pick sounds, place steps in a 16-step pattern, set the tempo and the
master volume, and — while you hold **FX** — become live punch-in effects. You
build a loop, chain loops into a song, and it plays back forever while you jam on
top. This version keeps that one-grid workflow and the lo-fi character, then adds
what a computer makes easy: a status readout so you always know what mode you're
in, a browsable **sample library**, and (soon) saveable projects.

Originally built by [James Benson](https://github.com/jjbenson85) as a 21-day
General Assembly pre-work project; being extended from there.

## Technologies used
* HTML / CSS
* JavaScript — jQuery, Tone.js

## Run it on a Mac

It must be served over HTTP (opening `index.html` directly blocks the audio files). Pick one:

- **Easiest:** double-click `start.command` in Finder. It serves the folder on
  `http://localhost:5000` and opens your browser. Keep the Terminal window open
  while you play; press `Ctrl+C` to stop.
- **Terminal:** `npm start` (uses `npx serve`) or `python3 -m http.server 5000`,
  then open `http://localhost:5000`.

When the page loads, click **Power on** once. Browsers keep Web Audio muted until
you interact with the page, so nothing will make sound before that.

## Testing on a phone

The app is a **PWA** (installable, offline-capable). To test it on a phone you
need the page on a URL the phone can reach **over HTTPS** — the service worker,
"Add to Home Screen" and the microphone all require a secure context, and
`http://<your-mac-ip>:5000` is *not* one.

| Option | What you get | Command |
|---|---|---|
| **Free static host** (recommended) | A real `https://` URL, installable, shareable | drop the folder on Netlify Drop / GitHub Pages / Cloudflare Pages / Vercel |
| **Quick tunnel** | Temporary `https://` URL to your local server | `npm start` then `npx --yes localtunnel --port 5000` (or `cloudflared tunnel --url http://localhost:5000`, or `ngrok http 5000`) |
| **Android + USB** | `localhost` forwarded to the phone (counts as secure) | Chrome `chrome://inspect` → Port forwarding → `5000` |

So: **you don't have to host it to try it** (use a tunnel), but for a PWA that
installs cleanly and that other people can open, host it on any free static host —
it's all plain files, no build step.

**iOS notes:** install via Share → Add to Home Screen. Tab-audio capture
(`getDisplayMedia`) does not exist on iOS — mic recording works in Safari 14.3+.

### Keyboard

Number pads 1&ndash;16 = `1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V`.
`Return` = Play, `5` = Sound, `6` = Pattern, `7` = BPM, `8` = FX, `9` = Write.

### Sounds & the library

The default engine samples live in `wav/` (melodic 1&ndash;4, drum kits 9&ndash;12).

The **Library** panel on the right browses the sample packs under `samples/`
(generated from the local `PO ALL/` folder — Pocket Operator factory content,
kept for personal use, do not redistribute). Pick a pack, press ▶ to preview a
sample, then **→ slot** to load it into any of the 16 slots: 1&ndash;8 become
melodic (played chromatically), 9&ndash;16 become drum pads. Slot assignments are
remembered in `localStorage`.

To rebuild `samples.json` after changing `PO ALL/`, re-run the generator step
(see `scripts/` / project notes).

### Po-33: Drum Machine and Melodic Sequencer
![image](https://user-images.githubusercontent.com/34242042/64187853-3b1aa280-ce69-11e9-8d52-31c8f9daf53a.png)

You can find a hosted version here ----> [Live Site](http://jjbenson.co.uk/po-33/)


### Project overview

This project was created as part of the pre-work for the General Assembly Web Development Immersive course.

It is a clone of the Teenage Engineering Pocket Operator 33 Knock Out!

[PO-33 Review](https://www.soundonsound.com/reviews/teenage-engineering-po-33-ko-po-35-speak)

[Offical PO-33 Guide](https://teenage.engineering/guides/po-33/en)

[PO-33 Introduction Video](https://www.youtube.com/watch?v=T1841FR_eE8&vl=en)

I aim to update this project to use better techniques and make it easier to use!

## Controls — the same as the hardware

Every function key works the PO-33 way: **hold it and press a pad**, and let
go to return. Anything shown in a PO-33 tutorial or the
[official guide](https://teenage.engineering/guides/po-33/en) works as shown.
If you only have one thumb free, **tap** SOUND or PATTERN instead and it stays
on until you tap it again.

| Hold | + press | Does |
|---|---|---|
| SOUND | pad | pick a sound (1&ndash;8 melodic, 9&ndash;16 drum) |
| PATTERN | pads | pick / chain patterns |
| BPM | *(tap alone)* | cycle 80 / 120 / 140 |
| BPM | sliders · pad | swing / tempo · master volume |
| WRITE | *(tap alone)* | write mode: pads are the 16 steps |
| WRITE | pads, while playing | punch notes in |
| WRITE | sliders, while playing | record the moves onto the steps |
| FX | pad | punch-in effect (saved to the pattern if WRITE is on) |
| FX | 16 | clear saved effects |
| RECORD | hold a pad | sample into that slot while held (drum slots are sliced 16 ways) |
| RECORD | PATTERN | clear this pattern |
| RECORD | SOUND, twice | delete this sound |
| WRITE + PATTERN | pad | copy this pattern there |
| WRITE + SOUND | pad | copy this sound there |

Pads sound the moment your finger lands, several at once.

## Added in the browser edition

**Foundations**
* Power-on screen that unlocks Web Audio · rebuilt clean flex/grid layout
* **LCD HUD** (`js/studio.js`) — live mode / sound / pattern / step readout,
  transient button feedback, "recommended next" hints, Ethiopian screen motifs
* **Library dock** (`js/library.js`) — browse the packs under `samples/`,
  preview, load onto the selected slot; per-pad drum kits; `fill 4/8/surprise`
* **Recorder** (`js/studio.js`) — mic or browser-tab audio onto a slot,
  persisted in IndexedDB; `.wav` and **MP3** export (encoder bundled, works offline)
* **PWA** — installable, offline after first load; **mobile drawer build** with
  scale-to-fit, the two knobs replaced by three sliders (A / B / master)

**Sound design (Tier 1)**
* **Waveform trim editor** (`js/trim.js`) — FX → TRIM shows the waveform with
  drag handles; per-step and channel-wide; **auto** measures the sound
  (`js/listen.js`), cuts the silence off both ends and suggests the tempo
* **Auto-slice** (`js/slice.js`) — chop a sample 4 / 8 / 16 ways across a drum
  slot's pads, optionally lay out across the steps + match tempo
* **Per-step parameter locks + accent** (`js/locks.js`) — hold a lit step to
  latch it, move a slider to lock note / volume / cutoff / res / trim to that
  step; accent & ghost render on the step bar

**Melodic engine**
* **Key / scale / octave** (`js/scale.js`) — melodic slots play through a
  chosen scale so the 16 pads span 2–4 octaves; "16-pad classic" keeps the
  original layout. Patterns unchanged (still a 0–15 index per step).

**Performance (Tier 2)**
* **16 punch-in effects**, same set and order as the hardware — loop 16 / 12 /
  short / shorter · unison / low · octave up / down · stutter 4 / 3 · scratch /
  fast · 6/8 quantize · retrigger · reversed · no effect — with their own
  recordable lane per pattern
* **On-screen parameter readout** while dragging any slider
* **Metronome** (Transport-scheduled), **mute / solo** (hold a pad in SOUND),
  **motion recording** (arm, play, sweep a slider), **micro-timing / nudge**
  (±60 ms per step)
* **Perform strip** (`js/perf.js`) — XY pad (TONE filter / SPACE echo+reverb,
  lockable), MIX (mute/solo + chain editor), FX, KEYS (8 synth voices with
  their own track). Starts collapsed so the pads get the room.
* **Hardware button grammar** (`js/hold.js`) — hold-a-key combos, pads on
  touch-down, live hits on the beat you hear
* **Projects** (`js/projects.js`) — save / load / on-screen browser, in
  `localStorage` (survives deploys)
* **Version chip + "update ready"** prompt at the top of the screen
* **In-app guide** (`js/guide.js`, 25 sections) including a hardware combo
  cheat sheet

## Still to do

* **Next big one:** hum → melodic pattern (pitch detection) — now unblocked by
  the scale engine
* **Tier 3:** animated screen art, crop a recorded clip, resample through FX,
  engine lo-fi toggle, expand button-feedback coverage
* **PWA polish:** in-app "Add to Home Screen" hint, landscape tuning
* **Housekeeping:** history still carries `PO ALL/` (~65 MB `.git`) — optional
  `git filter-repo`/BFG + force-push to purge

## Credits

* Pixel art (farm scene): **Farm RPG FREE 16x16 – Tiny Asset Pack**
  (32×32 character frames). Only the used sprites are bundled, in
  `game/sprites/`; the raw pack is not redistributed.
* Tileset: **Summer Plains 32×32** by *Schwarnhild*.
  https://schwarnhild.itch.io/summer-plains-tileset-and-asset-pack-32x32-pixels
* Original PO-33 web clone by [James Benson](https://github.com/jjbenson85).

### Mushroom sprite pack
An animated mushroom character (idle / run / hit) used on the LCD scene and in
the song view's footer. The raw pack lives in `Mushroom/` and is **gitignored**;
only the cropped frames in `game/sprites/mush_*.png` are committed. Check the
pack's own licence on its store page before shipping this anywhere commercial.
