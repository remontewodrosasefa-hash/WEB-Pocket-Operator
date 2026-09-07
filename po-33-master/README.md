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

* Power-on screen that unlocks Web Audio (needed on Safari/Chrome on macOS)
* Rebuilt device layout — clean fl/grid instead of the old negative-margin hack
  (`replica.css`, layered over `po33.css`)
* **LCD HUD** (`js/studio.js`) — the screen now shows the current mode, selected
  sound + its sample, pattern, tempo/swing/volume and a live 16-step readout
* **Library dock** (`js/library.js`) — browse the sample packs under `samples/`,
  preview, and **click a sample to load it onto the currently selected sound
  slot** (`SOUND` + a number picks the slot). Slots tab shows the full map.
* **Recorder** (`js/studio.js`) — capture the **microphone** or a **browser
  tab's audio** straight onto the selected slot; download the clip as `.wav`
* Rewritten in-page "How to play me" guide
* `start.command` + `npm start` for one-step local serving
* **PWA** — `manifest.webmanifest` + `sw.js`; installable, works offline after
  first load
* **Mobile / touch build** — responsive layout, the two knobs replaced by two
  sliders, touch shims for WRITE long-press and BPM double-tap

## Next steps

* Punch-in FX bank (hold FX → 16 live effects: stutter, reverse, tape-stop,
  delay, bitcrush, filter …) via a bypassed Tone.js master effects chain
* Persist recordings across reloads (IndexedDB) + save/load/export projects
* Per-pad drum kit assignment (16 samples per drum slot, not one)
* Sample trim / length / pitch from the dials

## Not yet implemented (from the original)

Trim sample and change length · change sample volume and pitch with dials ·
record samples.

