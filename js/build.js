/* build.js — the BUILD screen. Triple-press TRIM to open it.
 *
 * WHAT IT IS FOR
 * A beat is made of a few jobs: drums to keep time, bass to hold the bottom,
 * melody to carry the tune. If you don't know which one you're missing or what
 * to put there, you stall. This fills the gaps for you and can lay out a whole
 * multi-bar arrangement.
 *
 * A NOTE ON THE FIRST VERSION, WHICH DIDN'T WORK
 * It refused to touch any slot that already had something on it, and refused to
 * write a variation unless it found a completely empty pattern. The app ships
 * with eight demo patterns and anyone who has used it for an hour has something
 * on every slot — so both buttons silently did nothing. Now it looks for the
 * next FREE slot instead of giving up, falls back to overwriting when it must,
 * says exactly what it did in the panel, and every action is one undo away.
 *
 * Exposes window.PO33.build
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var view, open = false;
	var log = [];                 // what the last action actually did

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	// One snapshot covering patterns, chain and the keyboard track, so undoing
	// a build takes one press no matter how much it touched.
	function mark(label) {
		try {
			if (PO33.undo.markWorld) { PO33.undo.markWorld(label); }
			else { PO33.undo.mark(label, true); }
		} catch (e) {}
	}

	/* ============================================================
	 * THE GENERATOR
	 *
	 * The first version was five fixed arrays of step numbers. It was always
	 * right and always dead: every hit the same volume, every hit exactly on
	 * the grid, the same beat every time you pressed the button.
	 *
	 * Three things separate a beat that sounds programmed from one that sounds
	 * played, and none of them are the notes:
	 *
	 *   DYNAMICS   a hi-hat line where every tick is the same volume reads as a
	 *              machine. Accent the beat, drop the off-beats back, and the
	 *              same notes suddenly have a pulse.
	 *   SWING      straight sixteenths are a grid. Delaying every second one
	 *              turns it into a groove. Boom bap and lo-fi live on this.
	 *   PUSH/DRAG  a snare landing 10ms late is the "behind the beat" feel that
	 *              defines 90s hip-hop. The engine takes a per-step nudge in
	 *              milliseconds, so we can actually do this.
	 *
	 * And one thing about the notes: THE BASS FOLLOWS THE KICK. Bass and kick
	 * written independently fight each other in the low end and turn to mud.
	 * Landing them together is most of what makes a beat sound finished.
	 *
	 * Each style below is a set of rules, not a pattern. Every press rolls
	 * inside the rules, so two builds give two different beats that are both
	 * correct.
	 * ============================================================ */

	function rnd(n) { return Math.floor(Math.random() * n); }
	function chance(p) { return Math.random() < p; }
	function pickOne(a) { return a[rnd(a.length)]; }
	// choose n distinct entries
	function pickSome(a, n) {
		var pool = a.slice(), out = [];
		while (out.length < n && pool.length) { out.push(pool.splice(rnd(pool.length), 1)[0]); }
		return out;
	}
	// small random shift, for volume and timing
	function jitter(v, amt) { return v + (Math.random() * 2 - 1) * amt; }

	var STYLES = {
		"old school": {
			scale: "penta min",
			bpm: [102, 108], swing: 0,
			// Big, plain and confident — 1980s drum machine, nothing hiding.
			kickBase: [0, 8], kickExtra: [[6], [10], [], []],
			snare: [4, 12], snareVel: -5, snareNudge: 0, ghosts: 0,
			hatEvery: 2, hatAccent: -13, hatOff: -19, hatDrop: 0.05,
			clap: true,
			bassMove: [0, 0, 4, 0], melDensity: 0.45, melLate: 0,
			blurb: "straight, loud and simple — Sugarhill and Run-DMC territory"
		},
		"boom bap": {
			scale: "minor",
			bpm: [86, 94], swing: 560,
			// Swung, dusty, snare dragging just behind the beat.
			kickBase: [0], kickExtra: [[3, 10], [6, 10], [3, 11], [10, 14]],
			snare: [4, 12], snareVel: -7, snareNudge: 11, ghosts: 0.55,
			hatEvery: 2, hatAccent: -15, hatOff: -23, hatDrop: 0.18,
			clap: false,
			bassMove: [0, 0, 3, 5], melDensity: 0.5, melLate: 6,
			blurb: "swung and behind the beat — 90s Premier and Pete Rock"
		},
		"trap": {
			scale: "minor",
			bpm: [138, 144], swing: 0,
			kickBase: [0], kickExtra: [[6, 10, 11], [6, 11], [7, 10, 14], [3, 10, 11]],
			snare: [8], snareVel: -5, snareNudge: 0, ghosts: 0,
			hatEvery: 1, hatAccent: -16, hatOff: -24, hatDrop: 0.1,
			clap: false,
			bassMove: [0, 0, 0, 3], melDensity: 0.35, melLate: 0,
			blurb: "fast, sparse, rolling hats"
		},
		"house": {
			scale: "dorian",
			bpm: [122, 126], swing: 0,
			kickBase: [0, 4, 8, 12], kickExtra: [[], [], [], []],
			snare: [4, 12], snareVel: -9, snareNudge: 0, ghosts: 0,
			hatEvery: 2, hatOffbeat: true, hatAccent: -14, hatOff: -20, hatDrop: 0,
			clap: true,
			bassMove: [0, 0, 4, 2], melDensity: 0.55, melLate: 0,
			blurb: "four on the floor, hats on the off-beat"
		},
		"lo-fi": {
			scale: "penta min",
			bpm: [72, 80], swing: 620,
			kickBase: [0], kickExtra: [[9], [10], [6, 9], [9]],
			snare: [4, 12], snareVel: -11, snareNudge: 16, ghosts: 0.35,
			hatEvery: 2, hatAccent: -19, hatOff: -26, hatDrop: 0.3,
			clap: false,
			bassMove: [0, 0, 2, 0], melDensity: 0.4, melLate: 10,
			blurb: "slow, heavily swung, everything dragging"
		}
	};
	var styleName = "boom bap";

	/* ---------- drums ---------- */

	function genKick(S) {
		var steps = S.kickBase.concat(pickOne(S.kickExtra));
		var out = [];
		steps.forEach(function (st) {
			// the "one" is always the loudest thing in the bar
			out.push({ s: st, v: st === 0 ? -4 : jitter(-8, 1.5), n: 0 });
		});
		return out;
	}

	function genSnare(S) {
		var out = [];
		S.snare.forEach(function (st) {
			out.push({ s: st, v: jitter(S.snareVel, 1), n: S.snareNudge });
		});
		// Ghost notes: quiet snare taps between the backbeats. They are what
		// fills the space in a boom bap pattern without adding another part.
		if (S.ghosts > 0) {
			[2, 6, 7, 10, 14, 15].forEach(function (st) {
				if (chance(S.ghosts * 0.4)) {
					out.push({ s: st, v: jitter(-25, 2), n: S.snareNudge + 4 });
				}
			});
		}
		return out;
	}

	function genHat(S) {
		var out = [];
		for (var st = 0; st < 16; st += S.hatEvery) {
			var step = S.hatOffbeat ? st + 2 : st;
			if (step > 15) { continue; }
			if (chance(S.hatDrop)) { continue; }     // a missing hat is a rest, not a mistake
			var onBeat = step % 4 === 0;
			out.push({
				s: step,
				v: jitter(onBeat ? S.hatAccent : S.hatOff, 1.5),
				n: jitter(0, 3)                       // hats breathe a couple of ms either way
			});
		}
		return out;
	}

	function genClap(S) {
		if (!S.clap) { return []; }
		return S.snare.map(function (st) {
			return { s: st, v: jitter(-10, 1), n: S.snareNudge + jitter(3, 2) };
		});
	}

	/* ---------- bass: locked to the kick ---------- */

	function genBass(S, kick) {
		// One note per kick, so the two land together instead of fighting.
		// Pad index picks a note out of the current scale, so it stays in key.
		var sorted = kick.slice().sort(function (a, b) { return a.s - b.s; });
		return sorted.map(function (k, i) {
			return {
				s: k.s,
				pad: S.bassMove[i % S.bassMove.length],
				v: jitter(k.s === 0 ? -8 : -11, 1),
				n: 0
			};
		});
	}

	/* ---------- melody: a phrase, not a scatter ---------- */

	// Rhythms that leave room. Each is a set of steps within one half-bar.
	// Deliberately sparse — two to four notes per half-bar. Over a full kit a
	// melody with a note on every other step is clutter; the gaps are what let
	// the drums be heard. But one note in a whole bar isn't a phrase either,
	// so nothing here is shorter than two.
	var PHRASE_RHYTHMS = [
		[0, 3], [0, 4], [2, 5], [0, 3, 6], [0, 2, 5], [3, 6], [2, 6], [0, 2, 4, 6]
	];

	// Pads 0-4 are the root octave, which is where the bass lives. The melody
	// starts an octave above it so the two occupy different space instead of
	// muddling together in the same register.
	var MEL_LO = 5, MEL_HI = 14;

	function genMelody(S) {
		// A contour: start somewhere, step up and down by small intervals, come
		// back near where you began. Small moves sound like a tune; big jumps
		// sound like an accident.
		var deg = pickOne([MEL_LO, MEL_LO + 2, MEL_LO + 4]);
		var call = pickOne(PHRASE_RHYTHMS);
		var out = [];

		call.forEach(function (st, i) {
			out.push({ s: st, pad: deg, v: jitter(-14, 2), n: S.melLate });
			var move = pickOne([1, 2, -1, -2, 1, -1]);
			deg = Math.max(MEL_LO, Math.min(MEL_HI, deg + move));
			if (i === call.length - 1) { return; }
		});

		// The answer. Call and response: the second half echoes the first and
		// lands back on the note it started from, so the phrase settles instead
		// of hanging in the air.
		if (chance(0.8)) {
			var answer = chance(0.6) ? call : pickOne(PHRASE_RHYTHMS);
			var d2 = Math.max(MEL_LO, out[0].pad - pickOne([0, 1, 2]));
			answer.forEach(function (st, i) {
				if (st + 8 > 15) { return; }
				out.push({ s: st + 8, pad: d2, v: jitter(-15, 2), n: S.melLate });
				d2 = Math.max(MEL_LO, Math.min(MEL_HI, d2 + pickOne([1, -1, -2, 2])));
			});
			if (out.length) { out[out.length - 1].pad = out[0].pad; }
		}
		return out;
	}

	/* ---------- swing + tempo ---------- */

	function applyFeel(S) {
		/* THE SCALE MATTERS MORE THAN ANY OF THIS.
		 *
		 * The device's default "16-pad classic" layout is the original
		 * hardware's fixed note order, and it is not a scale — the pads do not
		 * even run in pitch order. Generating a melody across it produces
		 * something closer to noise than a tune, which is the real reason the
		 * first version's melodies sounded wrong.
		 *
		 * So a build sets a scale if one isn't already chosen. If the user has
		 * picked their own we leave it alone: their key beats ours. */
		try {
			if (PO33.scale && !PO33.scale.enabled()) {
				PO33.scale.set({ scale: S.scale, key: 0 }, true);
			}
		} catch (e) {}

		var bpm = S.bpm[0] + rnd(S.bpm[1] - S.bpm[0] + 1);
		try {
			window.tempo = bpm;
			Tone.Transport.bpm.value = bpm;
		} catch (e) {}
		try {
			window.swing = S.swing;
			Tone.Transport.swing = S.swing / 1000;
			Tone.Transport.swingSubdivision = "16n";
		} catch (e) {}
		return bpm;
	}

	/* ============================================================
	 * Reading and writing patterns
	 * ============================================================ */

	function cur() { return g("currentPattern", 0); }

	function cell(ch, step, patIdx) {
		try { return window.newChannelArr[ch][patIdx == null ? cur() : patIdx][step]; }
		catch (e) { return null; }
	}

	function hasAny(ch, patIdx) {
		for (var i = 0; i < 16; i++) {
			var c = cell(ch, i, patIdx);
			if (c && c.noteOn) { return true; }
		}
		return false;
	}

	function patternEmpty(patIdx) {
		for (var ch = 0; ch < 16; ch++) { if (hasAny(ch, patIdx)) { return false; } }
		return true;
	}

	// A slot is only usable if it actually has a sound in it. Slots 5-8 and
	// 13-16 start empty, so writing to them would be silent.
	function slotLoaded(ch) {
		try { return ch < 8 ? !!window.melodicArr[ch] : !!window.drumArr[ch - 8]; }
		catch (e) { return false; }
	}

	/* Find somewhere to put a part.
	 * First choice: a loaded slot in the right half that is free in this
	 * pattern. If they are all busy we fall back to `pref` and overwrite it,
	 * because doing nothing at all is the worse answer — and undo is one press.
	 */
	/* A slot you chopped a sample onto is YOUR material — the whole point of
	 * chopping is the arrangement of pieces across its pads. BUILD writing a
	 * generic kick pattern over it would throw that away, so chopped slots are
	 * skipped entirely unless there is genuinely nowhere else to go.
	 */
	function isChopped(ch) {
		try { return !!(window.PO33.chops && PO33.chops.isChopped && PO33.chops.isChopped(ch + 1)); }
		catch (e) { return false; }
	}

	function pickSlot(kind, taken, patIdx) {
		var from = kind === "drum" ? 8 : 0, to = kind === "drum" ? 16 : 8;
		var pref = -1, ch, c2;
		// first choice: loaded, free in this pattern, and not something you chopped
		for (ch = from; ch < to; ch++) {
			if (!slotLoaded(ch) || isChopped(ch)) { continue; }
			if (pref < 0) { pref = ch; }
			if (taken.indexOf(ch) !== -1) { continue; }
			if (!hasAny(ch, patIdx)) { return { ch: ch, fresh: true }; }
		}
		// second: any non-chopped loaded slot, even if it has something on it
		for (c2 = from; c2 < to; c2++) {
			if (slotLoaded(c2) && !isChopped(c2) && taken.indexOf(c2) === -1) {
				return { ch: c2, fresh: false };
			}
		}
		// last resort: everything is chopped, so take a free one anyway rather
		// than silently doing nothing
		for (c2 = from; c2 < to; c2++) {
			if (slotLoaded(c2) && taken.indexOf(c2) === -1 && !hasAny(c2, patIdx)) {
				return { ch: c2, fresh: true };
			}
		}
		return pref >= 0 ? { ch: pref, fresh: false } : null;
	}

	function clearSlot(ch, patIdx) {
		for (var i = 0; i < 16; i++) {
			var c = cell(ch, i, patIdx);
			if (c) { c.noteOn = 0; }
		}
	}

	// Write one step, mirroring what editPattern does when it turns a step on,
	// so a built step behaves exactly like one you tapped in by hand.
	function setStep(ch, step, pitch, vol, patIdx, nudge) {
		var c = cell(ch, step, patIdx), cs;
		try { cs = window.channelSettingsArr[ch]; } catch (e) { return; }
		if (!c || !cs) { return; }
		c.noteOn = 1;
		// per-step micro-timing, in milliseconds. This is what lets a snare sit
		// a fraction behind the beat instead of dead on the grid.
		c.nudge = Math.max(-60, Math.min(60, Math.round(nudge || 0)));
		c.notePitch = pitch == null ? 0 : pitch;
		c.fxPitch = cs.fxPitch;
		c.fxVolume = vol == null ? cs.fxVolume : vol;
		c.fxTrim = cs.fxTrim;
		c.fxLength = cs.fxLength;
		c.fxFilter = cs.fxFilter;
		c.fxFilterType = cs.fxFilterType;
		c.fxFilterFreq = cs.fxFilterFreq;
		c.fxResonance = cs.fxResonance;
		c.fxFilterRes = cs.fxFilterRes;
	}

	function persist() {
		try { window.PO33.session.save(); } catch (e) {}
	}

	/* ============================================================
	 * What this pattern has
	 * ============================================================ */

	function state(patIdx) {
		var drums = false, bass = false, mel = false;
		for (var d = 8; d < 16; d++) { if (hasAny(d, patIdx)) { drums = true; break; } }
		for (var m = 0; m < 8; m++) {
			if (!hasAny(m, patIdx)) { continue; }
			// low average pad index reads as bass, higher as melody
			var sum = 0, n = 0;
			for (var i = 0; i < 16; i++) {
				var c = cell(m, i, patIdx);
				if (c && c.noteOn) { sum += (c.notePitch || 0); n++; }
			}
			if (n && sum / n <= 5) { bass = true; } else { mel = true; }
		}
		var kt = null;
		try { kt = PO33.keys.track(); } catch (e) {}
		if (kt) { for (var k = 0; k < 16; k++) { if (kt[k]) { mel = true; break; } } }
		return { drums: drums, bass: bass, melody: mel };
	}

	/* ============================================================
	 * The parts
	 * ============================================================ */

	// write a generated list of {s, pad, v, n} into one slot
	function layHits(ch, hits, patIdx) {
		hits.forEach(function (h) {
			setStep(ch, h.s, h.pad || 0,
				Math.max(-32, Math.min(-2, Math.round(h.v))), patIdx, h.n);
		});
	}

	function putDrums(patIdx, opts) {
		opts = opts || {};
		var S = STYLES[styleName], taken = [], out = [];
		var kick = opts.kick || genKick(S);
		var parts = [["kick", kick], ["snare", genSnare(S)], ["hat", genHat(S)]];
		var clap = genClap(S);
		if (clap.length) { parts.push(["clap", clap]); }
		if (opts.noKick) { parts.shift(); }

		parts.forEach(function (pair) {
			var pick = pickSlot("drum", taken, patIdx);
			if (!pick) { return; }
			taken.push(pick.ch);
			if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
			layHits(pick.ch, pair[1], patIdx);
			out.push(pair[0] + " → slot " + (pick.ch + 1) + (pick.fresh ? "" : " (replaced)"));
		});
		return { log: out, kick: kick };
	}

	function putBass(patIdx, kick) {
		var pick = pickSlot("melodic", [], patIdx);
		if (!pick) { return null; }
		if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
		var S = STYLES[styleName];
		layHits(pick.ch, genBass(S, kick || genKick(S)), patIdx);
		return { ch: pick.ch, txt: "bass → slot " + (pick.ch + 1) + " (follows the kick)" +
			(pick.fresh ? "" : " (replaced)") };
	}

	function putMelody(patIdx, avoid) {
		var pick = pickSlot("melodic", avoid || [], patIdx);
		if (!pick) { return null; }
		if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
		layHits(pick.ch, genMelody(STYLES[styleName]), patIdx);
		return { ch: pick.ch, txt: "melody → slot " + (pick.ch + 1) + (pick.fresh ? "" : " (replaced)") };
	}

	/* ============================================================
	 * Patterns and arrangement
	 * ============================================================ */

	// Prefer empty patterns; if there are none, take the ones after this and
	// say so. Refusing to act is the worse outcome, and undo covers it.
	function findPatterns(n) {
		var out = [], reused = false, q;
		for (q = 0; q < 16 && out.length < n; q++) {
			if (q !== cur() && patternEmpty(q)) { out.push(q); }
		}
		// Nothing empty left: walk forward from the current pattern, skipping
		// anything already taken. The old loop could hand back the SAME index
		// twice on a second press (it only nudged once past a collision), which
		// is why pressing build repeatedly produced patterns that overwrote
		// each other.
		var next = cur();
		var guard = 0;
		while (out.length < n && guard++ < 64) {
			next = (next + 1) % 16;
			if (next === cur() || out.indexOf(next) !== -1) { continue; }
			out.push(next);
			reused = true;
		}
		return { list: out, reused: reused };
	}

	function copyPattern(from, to) {
		for (var ch = 0; ch < 16; ch++) {
			for (var s = 0; s < 16; s++) {
				var src = cell(ch, s, from), dst = cell(ch, s, to);
				if (!src || !dst) { continue; }
				Object.keys(src).forEach(function (k) { dst[k] = src[k]; });
			}
		}
	}

	function clearPatternAt(idx) {
		for (var ch = 0; ch < 16; ch++) { clearSlot(ch, idx); }
		try { PO33.keys.clearPattern(idx); } catch (e) {}
	}

	// A variation is this bar with the last quarter stripped back and a busy
	// fill on the snare. Repetition with one bar that breaks is what makes a
	// loop feel like a song rather than a loop.
	function makeVariation(from, to) {
		copyPattern(from, to);
		var snare = -1;
		for (var ch = 8; ch < 16; ch++) { if (hasAny(ch, to)) { snare = ch; break; } }
		for (var c2 = 0; c2 < 16; c2++) {
			if (c2 === snare) { continue; }
			for (var s = 12; s < 16; s++) {
				var c = cell(c2, s, to);
				if (c) { c.noteOn = 0; }
			}
		}
		if (snare >= 0) {
			// a fill that builds: each hit a touch louder than the last
			[12, 13, 14, 15].forEach(function (s, i) {
				setStep(snare, s, 0, -16 + i * 3, to, i * 2);
			});
		}
	}

	function setChain(list) {
		try {
			window.patternChain = list.slice();
			window.patternCount = 0;
			return true;
		} catch (e) { return false; }
	}

	/* ============================================================
	 * Actions
	 * ============================================================ */

	function fillGaps(replace) {
		mark("build");
		log = [];
		var st = replace ? { drums: false, bass: false, melody: false } : state();
		if (replace) {
			clearPatternAt(cur());
			log.push("cleared pattern " + (cur() + 1));
		}
		var avoid = [], kick = null;
		if (!st.drums) {
			var dres = putDrums();
			dres.log.forEach(function (t) { log.push(t); });
			kick = dres.kick;
			log.push("feel: " + applyFeel(STYLES[styleName]) + " BPM" +
				(STYLES[styleName].swing ? ", swing " + Math.round(STYLES[styleName].swing / 10) + "%" : ""));
		}
		if (!st.bass) {
			var bres = putBass(null, kick);
			if (bres) { avoid.push(bres.ch); log.push(bres.txt); }
		}
		if (!st.melody) {
			var mres = putMelody(null, avoid);
			if (mres) { log.push(mres.txt); }
		}
		persist();
		if (!log.length) {
			log.push("this pattern already has drums, bass and melody — " +
				"use “replace what's here” to start it over");
		} else {
			flash("built — press PLAY", "warn");
		}
		paint();
	}

	function addVariation() {
		mark("build variation");
		log = [];
		var f = findPatterns(1);
		var to = f.list[0];
		if (f.reused) {
			clearPatternAt(to);
			log.push("pattern " + (to + 1) + " was in use — replaced (undo restores it)");
		}
		makeVariation(cur(), to);
		persist();
		log.push("pattern " + (to + 1) + " = pattern " + (cur() + 1) +
			" with the end stripped back and a snare fill");
		flash("variation on pattern " + (to + 1), "warn");
		paint();
		return to;
	}

	/* The whole thing: four bars with different jobs, chained into eight bars
	 * that actually go somewhere. This is the answer to "can it make a whole
	 * beat" — one bar repeating is a loop, this is an arrangement. */
	function buildWholeBeat() {
		mark("build whole beat");
		log = [];
		var f = findPatterns(3);
		var main = cur(), breakdown = f.list[0], fill = f.list[1], intro = f.list[2];

		var S = STYLES[styleName];
		var bpm = applyFeel(S);

		// 1. the main bar — everything, with the bass locked to this kick
		clearPatternAt(main);
		var avoid = [];
		var dres = putDrums(main);
		dres.log.forEach(function (t) { log.push(t); });
		var bres = putBass(main, dres.kick);
		if (bres) { avoid.push(bres.ch); log.push(bres.txt); }
		var mres = putMelody(main, avoid);
		if (mres) { log.push(mres.txt); }
		log.push("feel: " + bpm + " BPM" +
			(S.swing ? ", swing " + Math.round(S.swing / 10) + "%" : ", straight") +
			(S.snareNudge ? ", snare " + S.snareNudge + "ms behind the beat" : ""));
		try { log.push("scale: " + PO33.scale.label()); } catch (e) {}

		// 2. intro — the drums on their own, so the beat arrives
		clearPatternAt(intro);
		copyPattern(main, intro);
		for (var ch = 0; ch < 8; ch++) { clearSlot(ch, intro); }

		// 3. breakdown — everything but the kick, so the track can breathe
		clearPatternAt(breakdown);
		copyPattern(main, breakdown);
		for (var d = 8; d < 16; d++) {
			if (hasAny(d, breakdown)) { clearSlot(d, breakdown); break; }   // drop the kick
		}

		// 4. turnaround — the main bar with a fill at the end and a new melody
		// phrase, so the eighth bar is a real change rather than a copy
		clearPatternAt(fill);
		makeVariation(main, fill);
		if (mres) {
			clearSlot(mres.ch, fill);
			layHits(mres.ch, genMelody(S), fill);
		}

		persist();
		var chain = [intro, main, main, main, breakdown, main, main, fill];
		setChain(chain);

		log.push("pattern " + (intro + 1) + " = intro (drums only)");
		log.push("pattern " + (main + 1) + " = main");
		log.push("pattern " + (breakdown + 1) + " = breakdown (no kick)");
		log.push("pattern " + (fill + 1) + " = turnaround (fill at the end)");
		log.push("chain: " + chain.map(function (n) { return n + 1; }).join(" ") +
			"  — eight bars");
		if (f.reused) { log.push("some patterns were in use and got replaced — undo restores them"); }
		flash("whole beat built — press PLAY", "warn");
		paint();
	}

	/* ============================================================
	 * The panel
	 * ============================================================ */

	function html() {
		var st = state();
		var missing = ["drums", "bass", "melody"].filter(function (k) { return !st[k]; });
		var s = '<div class="uvHead"><span>BUILD</span>' +
			'<button type="button" data-bd="close">&times;</button></div>' +
			'<div id="bdBody">';

		s += '<div class="uvSec"><h4>pattern ' + (cur() + 1) + ' has</h4>' +
			'<div class="uvRow bdHave">' +
			["drums", "bass", "melody"].map(function (k) {
				return "<span class='" + (st[k] ? "roleOk" : "roleGap") + "'>" +
					(st[k] ? "✓ " : "– ") + k + "</span>";
			}).join("") + "</div>";
		s += '<p class="bdNote">' + (missing.length
			? "missing: <b>" + missing.join(", ") + "</b>"
			: "all three jobs are covered.") + "</p>";
		var chopped = [];
		for (var cc = 0; cc < 16; cc++) { if (isChopped(cc)) { chopped.push(cc + 1); } }
		if (chopped.length) {
			s += '<p class="bdNote">slot' + (chopped.length > 1 ? "s" : "") + " <b>" +
				chopped.join(", ") + "</b> " + (chopped.length > 1 ? "hold" : "holds") +
				" chopped audio &mdash; left alone.</p>";
		}
		s += "</div>";

		s += '<div class="uvSec"><h4>style</h4><div class="uvRow">' +
			Object.keys(STYLES).map(function (k) {
				return '<button type="button" data-bd="style" data-v="' + k + '"' +
					(k === styleName ? ' class="on"' : "") + ">" + k + "</button>";
			}).join("") + "</div>" +
			'<p class="bdNote">' + STYLES[styleName].blurb + " &mdash; " +
				STYLES[styleName].bpm[0] + "&ndash;" + STYLES[styleName].bpm[1] + " BPM" +
				(STYLES[styleName].swing
					? ", swing " + Math.round(STYLES[styleName].swing / 10) + "%"
					: ", straight") + ".</p></div>";

		s += '<div class="uvSec"><h4>make a whole beat</h4><div class="uvRow">' +
			'<button type="button" data-bd="whole" class="bdBig">build a whole beat</button>' +
			"</div><div class='uvRow'>" +
			'<button type="button" data-bd="whole">roll a different one</button>' +
			"</div>" +
			'<p class="bdNote">four bars &mdash; intro, main, breakdown, turnaround &mdash; ' +
			"chained into eight. this is the one to press if you just want something " +
			"playing.</p></div>";

		s += '<div class="uvSec"><h4>or fill this bar only</h4><div class="uvRow">' +
			'<button type="button" data-bd="gaps">fill what\'s missing</button>' +
			'<button type="button" data-bd="replace">replace what\'s here</button>' +
			"</div><div class='uvRow'>" +
			'<button type="button" data-bd="vary">+ variation bar</button>' +
			'<button type="button" data-bd="varychain">+ variation &amp; chain</button>' +
			"</div>" +
			'<p class="bdNote"><b>fill what\'s missing</b> leaves your work alone and only ' +
			"adds the jobs that are empty. <b>replace what's here</b> wipes this bar first. " +
			"if a slot is busy it uses the next free one.</p></div>";

		if (log.length) {
			s += '<div class="uvSec bdLog"><h4>what just happened</h4><ul>' +
				log.map(function (l) { return "<li>" + l + "</li>"; }).join("") +
				"</ul></div>";
		}

		s += '<div class="uvSec"><h4>if you don\'t like it</h4><div class="uvRow">' +
			'<button type="button" data-bd="undo">undo the last build</button>' +
			"</div></div>";

		return s + "</div>";
	}

	function paint() {
		if (!view) { return; }
		var body = view.querySelector("#bdBody");
		var top = body ? body.scrollTop : 0;
		view.innerHTML = html();
		var nb = view.querySelector("#bdBody");
		if (nb) { nb.scrollTop = top; }
	}

	function act(a, el) {
		switch (a) {
			case "close": hide(); break;
			case "style":
				styleName = el.getAttribute("data-v");
				flash(styleName + " · " + applyFeel(STYLES[styleName]) + " BPM", "tip");
				paint();
				break;
			case "whole":   buildWholeBeat(); break;
			case "gaps":    fillGaps(false); break;
			case "replace": fillGaps(true); break;
			case "vary":    addVariation(); break;
			case "varychain":
				var v = addVariation();
				var base = cur();
				setChain([base, base, base, v]);
				log.push("chain: " + [base, base, base, v]
					.map(function (n) { return n + 1; }).join(" "));
				paint();
				break;
			case "undo":
				try { PO33.undo.undo(); } catch (e) {}
				persist();
				log = ["undone"];
				paint();
				break;
		}
	}

	/* ---------- mount ---------- */

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || view) { return !!hud; }
		view = document.createElement("div");
		view.id = "buildView";
		view.innerHTML = html();
		hud.appendChild(view);
		view.addEventListener("click", function (e) {
			var t = e.target.closest("[data-bd]");
			if (!t || t.disabled) { return; }
			e.stopPropagation();
			act(t.getAttribute("data-bd"), t);
		});
		return true;
	}

	function show() {
		build();
		open = true;
		log = [];
		document.body.classList.add("buildOpen");
		paint();
	}
	function hide() {
		open = false;
		document.body.classList.remove("buildOpen");
	}
	function toggle() { if (open) { hide(); } else { show(); } }

	window.PO33.build = { show: show, hide: hide, toggle: toggle };

	/* ---------- triple-press TRIM ----------
	 * One press is trim, as always. Three quick presses open BUILD. Listening
	 * in the capture phase lets us count before trim.js reacts, and we close
	 * trim on the way in so the two panels never stack. */
	function wireTriple() {
		var b = document.getElementById("btnTrim");
		if (!b) { return false; }
		if (b.dataset.bdWired) { return true; }
		b.dataset.bdWired = "1";
		var n = 0, t = null;
		b.addEventListener("click", function () {
			n++;
			clearTimeout(t);
			t = setTimeout(function () { n = 0; }, 650);
			if (n >= 3) {
				n = 0;
				clearTimeout(t);
				try { PO33.trim.close(); } catch (e) {}
				show();
			}
		}, true);
		return true;
	}

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			var a = build(), c = wireTriple();
			if ((a && c) || ++tries > 100) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
