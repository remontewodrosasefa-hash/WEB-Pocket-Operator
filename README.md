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

## Things that work!

### Play
Play Patterns, Chain Patterns, Play sounds live when playback is stopped. Play sounds with keyboard (Number keys = 1234,qwer,asdf,zxcv);

### Edit
In PRF mode select a pitch or sample, in EDT mode add that sound to the pattern.

### Copy Patterns
In Pattern Select mode, press Write to enter Pattern Copy mode. Select a Pattern to copy (Slots with patterns are shown with lit LEDs). Paste the pattern by selecting a new Pattern Slot.

### Select Sounds
Press the Sound button then select a sound using the number keys. (Available sounds are shown with lit LEDs.) Melodic sounds play a note. Drum sounds will cycle all samples in that kit when pressed repeatedly.

Exit Sound mode by pressing Sound again.

Melodic sounds (Nos.1-8) can be played in a scale.

Drum sounds (Nos. 9-16) play different Samples for each number button.


### Record Patterns
Whilst playing, hold down write button for 3 seconds. Sounds played will be recorded into the pattern.

### Change Tempo and Swing
Press the BPM button. The dials control Tempo and Swing.
Numbers 1 to 16 control master volume.

Double tap BPM to cycle around the preset Tempos

### Filter Sounds
When in PRF mode cycle through fx modes to FLT. The dials apply different filters. The sounds can be added to Patterns in Edit mode.


## Added in the browser edition

**Foundations**
* Power-on screen that unlocks Web Audio · rebuilt clean flex/grid layout
* **LCD HUD** (`js/studio.js`) — live mode / sound / pattern / step readout,
  transient button feedback, "recommended next" hints, Ethiopian screen motifs
* **Library dock** (`js/library.js`) — browse the packs under `samples/`,
  preview, load onto the selected slot; per-pad drum kits; `fill 4/8/surprise`
* **Recorder** (`js/studio.js`) — mic or browser-tab audio onto a slot,
  persisted in IndexedDB; `.wav` and **MP3** export
* **PWA** — installable, offline after first load; **mobile drawer build** with
  scale-to-fit, the two knobs replaced by three sliders (A / B / master)

**Sound design (Tier 1)**
* **Waveform trim editor** (`js/trim.js`) — FX → TRIM shows the waveform with
  drag handles; per-step and channel-wide; drum trim fixed in the sequencer
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
* **16 punch-in effects** — crush · lo-fi · filter down/up · delay · stutter ·
  pitch up/down · reverb · wide 6/9 · phaser · tape stop · roll · ping-pong ·
  wobble · kill (bypassed master chain, built on first FX hold)
* **On-screen parameter readout** while dragging any slider
* **Metronome** (Transport-scheduled), **mute / solo** (hold a pad in SOUND),
  **motion recording** (arm, play, sweep a slider), **micro-timing / nudge**
  (±60 ms per step), **LFO** → master filter (rate / depth / wave)
* **Projects** (`js/projects.js`) — save / load / on-screen browser, in
  `localStorage` (survives deploys)
* **Version chip + "update ready"** prompt at the top of the screen
* **4-tab in-app guide** (play / make music / sound design / utilities) with a
  full "let's make a song" walkthrough

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
