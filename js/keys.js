/* keys.js — the playable instrument behind the KEYS tab and the XY pad.
 *
 * WHY THIS EXISTS
 * The KEYS tab used to just retrigger whichever sample slot was selected at
 * sixteen pitches, which mostly sounded like a sample being abused. This gives
 * the tab real instruments instead: an electric piano, a soft pad, a pluck and
 * a bass. They are SYNTHESISED (built out of maths by Tone.js) rather than
 * loaded from audio files, so they cost no download and are always available.
 *
 * TWO THINGS KEEP IT SOUNDING RIGHT
 *   1. The pads are laid out in a musical scale, not in semitone order. Only
 *      notes that belong together are reachable, so wrong notes are not on the
 *      keyboard at all.
 *   2. "IN TIME" (the FIT button) delays each note you play until the next
 *      sixteenth-note tick of the sequencer, so late fingers still land on the
 *      grid with the drums.
 *
 * Everything runs into `meter`, the same point the samplers use, so the master
 * volume, the level meter and the punch-in FX all apply to it too.
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var VOICES = ["e.piano", "pad", "pluck", "bass"];
	var voiceName = "e.piano";
	var inTime = false;
	var built = {};          // voiceName -> Tone instrument
	var out = null;          // shared output gain
	var lead = null, leadFilt = null, leadOn = false;

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "tip"); } }

	function dest() {
		// prefer the shared bus so FX + meter apply; fall back to the speakers
		return (window.meter && window.Tone) ? window.meter : (window.Tone ? Tone.Master : null);
	}

	function output() {
		if (out || !window.Tone) { return out; }
		try {
			out = new Tone.Gain(0.55);
			out.connect(dest());
		} catch (e) { out = null; }
		return out;
	}

	/* ---------- the voices ---------- */

	function make(name) {
		if (built[name]) { return built[name]; }
		if (!window.Tone || !output()) { return null; }
		var v = null;
		try {
			if (name === "e.piano") {
				// two-operator FM: the classic bell-and-wood electric piano
				v = new Tone.PolySynth(6, Tone.FMSynth);
				v.set({
					harmonicity: 3.01, modulationIndex: 13,
					oscillator: { type: "sine" },
					envelope: { attack: 0.002, decay: 1.5, sustain: 0.06, release: 1.3 },
					modulation: { type: "square" },
					modulationEnvelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.2 }
				});
				v.volume.value = -8;
			} else if (name === "pad") {
				v = new Tone.PolySynth(6, Tone.Synth);
				v.set({
					oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
					envelope: { attack: 0.35, decay: 0.6, sustain: 0.75, release: 1.8 }
				});
				v.volume.value = -18;
			} else if (name === "pluck") {
				v = new Tone.PolySynth(6, Tone.Synth);
				v.set({
					oscillator: { type: "triangle" },
					envelope: { attack: 0.001, decay: 0.28, sustain: 0.02, release: 0.35 }
				});
				v.volume.value = -10;
			} else {
				v = new Tone.PolySynth(3, Tone.MonoSynth);
				v.set({
					oscillator: { type: "sawtooth" },
					filter: { Q: 2, type: "lowpass", rolloff: -24 },
					envelope: { attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.5 },
					filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3,
						release: 0.4, baseFrequency: 90, octaves: 2.4 }
				});
				v.volume.value = -8;
			}
			v.connect(output());
			built[name] = v;
		} catch (e) { v = null; }
		return v;
	}

	/* ---------- which note does a pad play ---------- */

	// Pad 0-15 -> a note name. If the user has picked a scale we honour it. If
	// they are still on "classic" (the hardware's fixed chromatic layout, which
	// is easy to play a clashing note on) the keyboard quietly uses a minor
	// pentatonic instead — five notes that sit well over almost any beat.
	var SAFE = [0, 3, 5, 7, 10];
	var NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

	function midiName(m) {
		m = Math.max(12, Math.min(108, Math.round(m)));
		return NAMES[m % 12] + (Math.floor(m / 12) - 1);
	}

	function note(pad) {
		var S = window.PO33 && PO33.scale;
		if (S && S.enabled && S.enabled()) { return S.note(pad); }
		var root = 48;                                  // C3, a comfortable middle
		var deg = pad % SAFE.length;
		var oct = Math.floor(pad / SAFE.length);
		return midiName(root + oct * 12 + SAFE[deg]);
	}

	function layout() {
		var S = window.PO33 && PO33.scale;
		if (S && S.enabled && S.enabled()) { return S.label(); }
		return "C minor pentatonic";
	}

	/* ---------- timing ---------- */

	// How long to wait so this note lands on the next sixteenth of the beat.
	// Returns 0 when IN TIME is off or the sequencer isn't running.
	function delayToGrid() {
		if (!inTime || !window.Tone || Tone.Transport.state !== "started") { return 0; }
		try {
			var step = Tone.Time("16n").toSeconds();
			var pos = Tone.Transport.seconds;
			var wait = step - (pos % step);
			return (wait < 0.012 || wait > step) ? 0 : wait;   // already on the line
		} catch (e) { return 0; }
	}

	var held = {};   // pad -> note name, so release hits the right note

	function down(pad, vel) {
		var v = make(voiceName);
		if (!v) { return null; }
		var n = note(pad);
		var wait = delayToGrid();
		try {
			if (wait > 0) {
				// quantised notes get a fixed eighth-note length: predictable,
				// and always finishes before the next one is due
				var len = Tone.Time("8n").toSeconds();
				v.triggerAttackRelease(n, len, Tone.now() + wait, vel || 0.8);
			} else {
				held[pad] = n;
				v.triggerAttack(n, Tone.now(), vel || 0.8);
			}
		} catch (e) {}
		return n;
	}

	function up(pad) {
		var v = built[voiceName];
		var n = held[pad];
		delete held[pad];
		if (!v || !n) { return; }
		try { v.triggerRelease(n, Tone.now()); } catch (e) {}
	}

	function allOff() {
		Object.keys(held).forEach(function (p) { up(+p); });
		Object.keys(built).forEach(function (k) {
			try { built[k].releaseAll ? built[k].releaseAll() : null; } catch (e) {}
		});
	}

	/* ---------- the XY pad's synth mode ---------- */

	// A single sliding lead voice. Left-to-right picks the note (snapped to the
	// same scale as the pads, so it can't land on a wrong one); up-and-down
	// opens the tone from muffled to bright.
	function leadRig() {
		if (lead || !window.Tone || !output()) { return lead; }
		try {
			leadFilt = new Tone.Filter(800, "lowpass");
			leadFilt.Q.value = 3;
			lead = new Tone.MonoSynth({
				oscillator: { type: "sawtooth" },
				envelope: { attack: 0.02, decay: 0.2, sustain: 0.85, release: 0.25 },
				filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 1, release: 0.3,
					baseFrequency: 200, octaves: 3 }
			});
			lead.volume.value = -14;
			lead.chain(leadFilt, output());
		} catch (e) { lead = null; }
		return lead;
	}

	function xyNote(nx) {
		// two octaves of the current layout spread across the pad's width
		var pad = Math.max(0, Math.min(15, Math.round(nx * 15)));
		return note(pad);
	}

	function xySynth(nx, ny, on) {
		var L = leadRig();
		if (!L) { return; }
		try {
			if (!on) {
				if (leadOn) { L.triggerRelease(Tone.now()); leadOn = false; }
				return;
			}
			var n = xyNote(nx);
			var cutoff = 260 * Math.pow(28, Math.max(0, Math.min(1, ny)));   // 260Hz..7kHz
			leadFilt.frequency.rampTo(cutoff, 0.04);
			if (!leadOn) { L.triggerAttack(n, Tone.now(), 0.8); leadOn = true; }
			else { L.setNote(n, Tone.now()); }
		} catch (e) {}
	}

	/* ---------- public API ---------- */

	window.PO33.keys = {
		voices: function () { return VOICES.slice(); },
		voice: function () { return voiceName; },
		setVoice: function (n) {
			if (VOICES.indexOf(n) === -1) { return voiceName; }
			allOff();
			voiceName = n;
			make(n);
			flash("keys: " + n, "tip");
			return voiceName;
		},
		nextVoice: function () {
			return this.setVoice(VOICES[(VOICES.indexOf(voiceName) + 1) % VOICES.length]);
		},
		fit: function () { return inTime; },
		setFit: function (on) {
			inTime = !!on;
			flash(inTime ? "in time: on — notes snap to the beat"
				: "in time: off — notes play the instant you touch", inTime ? "warn" : "tip");
			return inTime;
		},
		toggleFit: function () { return this.setFit(!inTime); },
		note: note,
		layout: layout,
		down: down,
		up: up,
		allOff: allOff,
		xy: xySynth
	};
})();
