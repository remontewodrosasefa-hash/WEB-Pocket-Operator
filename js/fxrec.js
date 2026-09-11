/* fxrec.js — record the punch-in effects, not just the keyboard.
 *
 * The keyboard could already be recorded into a pattern; the effects could
 * not. Holding LOOP SHORT or REVERSED was purely live — let go and it was
 * gone, and there was no way to keep a move you liked.
 *
 * This gives the effects their own lane, the same shape as the keyboard's:
 * for every pattern, sixteen steps, each holding either nothing or the number
 * of the effect that should be running at that step. Recording writes the
 * effect you're holding onto every step the playhead crosses while you hold
 * it, so a two-bar reverse lands as a two-bar reverse, not a single blip.
 * Playback engages and releases the effect as the lane passes under the head.
 *
 * Exposes window.PO33.fxRec
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var KEY = "po33.fxlane";
	var lane = {};            // pattern -> array of 16 (null | fx number)
	var holding = 0;          // the fx currently held down by a finger
	var playingFx = 0;        // the fx the lane itself has engaged
	var ownArm = false;       // this module's own rec toggle

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "tip"); } }
	function curPattern() { return (typeof window.currentPattern === "number") ? window.currentPattern : 0; }

	function forPattern(pat) {
		if (!lane[pat]) { lane[pat] = new Array(16); }
		return lane[pat];
	}

	function save() {
		try { localStorage.setItem(KEY, JSON.stringify(lane)); } catch (e) {}
	}
	function restore() {
		try {
			var v = JSON.parse(localStorage.getItem(KEY) || "null");
			if (v && typeof v === "object") { lane = v; }
		} catch (e) {}
	}
	restore();

	// Armed by this module's own toggle OR by the device's LIVE REC, the same
	// way the keyboard works — one obvious switch shouldn't do half the job.
	function armed() { return ownArm || window.mode === 11; }

	/* ---------- recording ---------- */

	// called by studio.js when an effect pad goes down / comes up
	function down(n) { holding = n || 0; }
	function up() { holding = 0; }

	// called once per sixteenth by the sequencer: stamp whatever is held
	function stamp(step) {
		if (!armed() || !holding) { return; }
		forPattern(curPattern())[step] = holding;
		save();
	}

	/* ---------- playback ---------- */

	function step(beat) {
		var L = lane[curPattern()];
		var want = (L && L[beat]) || 0;
		// a finger on a pad always beats the lane — you can play over your own
		// recording without fighting it
		if (holding) { return; }
		if (want === playingFx) { return; }
		playingFx = want;
		try {
			if (want) { PO33.fx.punch(want, true); }
			else { PO33.fx.punch(0, false); }
		} catch (e) {}
	}

	/* ---------- editing ---------- */

	function clear(pat) {
		delete lane[pat == null ? curPattern() : pat];
		save();
		try { PO33.fx.punch(0, false); } catch (e) {}
		playingFx = 0;
		flash("fx lane cleared on pattern " + (curPattern() + 1), "warn");
	}

	function info() {
		var L = lane[curPattern()], n = 0;
		if (L) { for (var i = 0; i < 16; i++) { if (L[i]) { n++; } } }
		return { steps: n, armed: armed(), ownArm: ownArm };
	}

	window.PO33.fxRec = {
		down: down, up: up, stamp: stamp, step: step,
		clear: clear, info: info,
		armed: armed,
		lane: function () { return lane[curPattern()] || null; },
		snapshot: function () { try { return JSON.parse(JSON.stringify(lane)); } catch (e) { return null; } },
		load: function (v) { if (v && typeof v === "object") { lane = v; save(); } },
		toggleArm: function () {
			ownArm = !ownArm;
			flash(ownArm ? "fx rec on — hold an effect and it's written in"
				: "fx rec off", ownArm ? "warn" : "tip");
			return armed();
		}
	};
})();
