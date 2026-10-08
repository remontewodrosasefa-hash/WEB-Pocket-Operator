/* hold.js — the hardware's button grammar: hold a function key, press a pad.
 *
 * Every PO-33 tutorial is written in combos ("hold SOUND, press 5"). The app
 * used to make each function key a toggle, so none of those instructions
 * worked here. Now every key is hold-OR-tap:
 *
 *   hold it and use it   works for exactly as long as it is held (hardware)
 *   tap it               latches, as before, for one-thumb playing
 *
 * BPM follows the hardware: a tap cycles 80 / 120 / 140, a hold opens swing
 * and tempo on the sliders and volume on the pads.
 *
 * Combos, as in the TE manual:
 *   SOUND + pad              pick a sound
 *   PATTERN + pads           pick / chain patterns
 *   BPM + sliders / pad      swing, tempo / master volume
 *   RECORD + hold a pad      sample into that slot until you let go
 *   RECORD + SOUND (twice)   delete the selected sound
 *   RECORD + PATTERN         clear the current pattern
 *   WRITE + pads (playing)   punch notes in
 *   WRITE + sliders (playing) record the moves onto the steps
 *   WRITE + PATTERN + pad    copy this pattern to that one
 *   WRITE + SOUND + pad      copy the selected sound to that slot
 *   FX + pad / FX + 16       handled in studio.js (punch-in / clear saved fx)
 *
 * Pads also fire on finger-DOWN now. They used to wait for the click, which
 * arrives when the finger LIFTS — so every hit was late by however long the
 * finger stayed down, and so was every live-recorded step. WRITE mode keeps
 * the click, because there a press-and-hold latches a step lock.
 *
 * Exposes window.PO33.hold
 */
(function () {
	"use strict";

	var TAP_MS = 280;
	var STATE = { btnSound: 2, btnPattern: 3, btnBPM: 4 };
	var ENTER = { btnSound: "soundButtonFunction", btnPattern: "patternButtonFunction", btnBPM: "tempoButtonFunction" };
	var KEYS = ["btnSound", "btnPattern", "btnBPM", "btnRecord", "btnWrite"];

	var held = {};            // key id -> { at, used, entered, combo, pid }
	var copyArm = null;       // "pattern" | "sound" while WRITE is held
	var motionTimer = null, tempMotion = false;
	var delArmedAt = 0;
	var recPointer = null;    // pointer holding the pad being sampled into
	var ate = {};             // pad n -> its trailing click was already handled on pointerdown

	var HINT = {
		btnSound: "SOUND held · pad = pick a sound · REC first = delete",
		btnPattern: "PATTERN held · pads = pick / chain patterns",
		btnBPM: "BPM held · sliders = swing / tempo · pads = volume",
		btnRecord: "RECORD held · hold a pad to sample into it",
		btnWrite: "WRITE held · pads punch in · sliders record moves"
	};
	var COPY_HINT = {
		pattern: "WRITE + PATTERN · pad = copy this pattern there",
		sound: "WRITE + SOUND · pad = copy this sound there"
	};

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "tip"); } }
	function call(name) {
		var fn = window[name];
		if (typeof fn !== "function") { return undefined; }
		try { return fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { return undefined; }
	}
	function upd() { call("updateDisplay"); }
	function isHeld(id) { return !!held[id]; }
	function useAll() { for (var k in held) { held[k].used = true; } }
	function padNum(el) {
		var m = /^btn([1-9]|1[0-6])$/.exec((el && el.id) || "");
		return m ? +m[1] : 0;
	}
	function save() { try { PO33.session.save(); } catch (e) {} }

	/* ---------- the combos themselves ---------- */

	function deleteSound() {
		var slot = g("selectedChannel", 0) + 1;
		var now = Date.now();
		// the hardware deletes on the first press; one confirm here, because a
		// deleted chop is an afternoon's work that undo cannot bring back
		if (now - delArmedAt > 2500) {
			delArmedAt = now;
			flash("delete SOUND " + slot + "? press SOUND again", "warn");
			return;
		}
		delArmedAt = 0;
		if (window.PO33Lib && PO33Lib.deleteSlot) { PO33Lib.deleteSlot(slot); }
		upd();
	}

	function clearPattern() {
		if (window.PO33 && PO33.clearPattern) { PO33.clearPattern(); }
		upd();
	}

	function copyPattern(dest) {
		var src = g("currentPattern", 0);
		if (dest === src) { flash("that's the pattern you're on — pick another pad", "warn"); return; }
		try { PO33.undo.markWorld("copy pattern"); } catch (e) {}
		try {
			for (var c = 0; c < 16; c++) {
				window.newChannelArr[c][dest] = JSON.parse(JSON.stringify(window.newChannelArr[c][src]));
			}
		} catch (e) { flash("could not copy the pattern", "warn"); return; }
		try { PO33.fxRec.setPattern(dest, PO33.fxRec.getPattern(src)); } catch (e) {}
		try {
			var k = PO33.keys.snapshot();
			if (k) {
				if (k[src]) { k[dest] = k[src]; } else { delete k[dest]; }
				PO33.keys.restore(k);
			}
		} catch (e) {}
		save();
		flash("pattern " + (src + 1) + " copied to " + (dest + 1), "warn");
		upd();
	}

	function copySound(to) {
		var from = g("selectedChannel", 0) + 1;
		if (from === to) { flash("pick a different slot to copy into", "warn"); return; }
		if (window.PO33Lib && PO33Lib.copySlot) { PO33Lib.copySlot(from, to); }
		upd();
	}

	// same as LIVE REC, but only while WRITE is held: a hit overwrites the step
	// under the playhead rather than toggling it off
	function punchIn(btnNum) {
		var ch = g("selectedChannel", 0);
		window.selectedPitch = btnNum;
		try { window.channelSettingsArr[ch].notePitch = btnNum; } catch (e) {}
		call("playSound", ch, btnNum);
		var beat = window.liveStep ? liveStep() : g("beatCount", 0);
		try { PO33.undo.mark("step"); } catch (e) {}
		try {
			var b = window.newChannelArr[ch][g("currentPattern", 0)][beat];
			if (b.noteOn) { b.noteOn = 0; }
		} catch (e) {}
		call("editPattern", ch, beat);
		upd();
	}

	function sampleInto(n, pointerId) {
		var R = window.PO33 && PO33.rec;
		if (!R) { return; }
		if (R.isRecording() || R.isStarting()) { flash("already recording", "warn"); return; }
		recPointer = pointerId;
		R.start(n);
		flash("sampling into SOUND " + n + " — let go to stop", "warn");
	}

	function sampleRelease(pointerId) {
		if (recPointer === null || pointerId !== recPointer) { return; }
		recPointer = null;
		var R = window.PO33 && PO33.rec;
		if (!R) { return; }
		if (R.isRecording()) { R.stop(); return; }
		// let go while the browser was still asking for the mic: keep going
		// rather than keep a zero-length sample, and say how to stop
		if (R.isStarting()) { flash("recording — tap RECORD to stop", "warn"); }
	}

	/* ---------- function keys ---------- */

	function keyDown(id, e) {
		if (e.button) { return; }
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
		e.currentTarget.classList.add("held");
		var h = { at: Date.now(), used: false, entered: false, combo: false, pid: e.pointerId };
		held[id] = h;

		if (id === "btnRecord") { flash(HINT.btnRecord); return; }

		if (id === "btnWrite") {
			// a quick tap toggles WRITE; only a real hold during playback arms
			// the slider recording, so tapping never flickers it on
			clearTimeout(motionTimer);
			motionTimer = setTimeout(function () {
				if (!isHeld("btnWrite") || !g("play", false) || !window.PO33.motion) { return; }
				if (!PO33.motion.isArmed()) { PO33.motion.set(true); tempMotion = true; }
				flash(HINT.btnWrite);
			}, TAP_MS);
			return;
		}

		if (isHeld("btnRecord")) {
			h.combo = true;
			held.btnRecord.used = true;
			if (id === "btnSound") { deleteSound(); }
			else if (id === "btnPattern") { clearPattern(); }
			return;
		}

		if (isHeld("btnWrite") && (id === "btnPattern" || id === "btnSound")) {
			copyArm = id === "btnPattern" ? "pattern" : "sound";
			held.btnWrite.used = true;
		}

		if (g("state", 0) !== STATE[id]) {
			call(ENTER[id]);
			h.entered = true;
		}
		flash(copyArm ? COPY_HINT[copyArm] : HINT[id]);
	}

	function exit(id) {
		if (g("state", 0) === STATE[id]) { call(ENTER[id]); }
	}

	function keyUp(id) {
		var el = document.getElementById(id);
		if (el) { el.classList.remove("held"); }
		var h = held[id];
		if (!h) { return; }
		delete held[id];
		var quick = Date.now() - h.at < TAP_MS;

		if (id === "btnRecord") {
			if (!h.used && quick && window.PO33.rec) { PO33.rec.toggle(); }
			return;
		}

		if (id === "btnWrite") {
			clearTimeout(motionTimer);
			if (tempMotion) { tempMotion = false; PO33.motion.set(false); }
			copyArm = null;
			if (!h.used) { call("writeButtonFunction"); }
			upd();
			return;
		}

		if (h.combo) { return; }
		if ((copyArm === "sound" && id === "btnSound") || (copyArm === "pattern" && id === "btnPattern")) {
			copyArm = null;
		}

		if (id === "btnBPM") {
			if (!h.entered || h.used) { exit(id); return; }
			if (quick) { exit(id); call("cycleTempoPreset"); return; }
			return;   // held and let go untouched: stays open for one-thumb use
		}

		// SOUND / PATTERN: a tap latches; a hold that was used lets go
		if (h.entered && !h.used) { return; }
		exit(id);
	}

	function wireKeys() {
		var ok = true;
		KEYS.forEach(function (id) {
			var el = document.getElementById(id);
			if (!el) { ok = false; return; }
			if (el.dataset.hold) { return; }
			el.dataset.hold = "1";
			el.addEventListener("pointerdown", function (e) { keyDown(id, e); });
			el.addEventListener("pointerup", function () { keyUp(id); });
			el.addEventListener("pointercancel", function () { keyUp(id); });
			el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
		});
		// FX's hold logic lives in studio.js; it only borrows the held look
		var fx = document.getElementById("btnFX");
		if (fx && !fx.dataset.holdLook) {
			fx.dataset.holdLook = "1";
			fx.addEventListener("pointerdown", function () { fx.classList.add("held"); });
			["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
				fx.addEventListener(t, function () { fx.classList.remove("held"); });
			});
			fx.addEventListener("contextmenu", function (e) { e.preventDefault(); });
		}
		return ok;
	}

	/* ---------- pads ---------- */

	function padDown(e) {
		var el = e.target.closest && e.target.closest(".buttonGridItem");
		var n = padNum(el);
		if (!n) { return; }
		delete ate[n];
		if (e.button) { return; }
		if (window.fxHeld) { return; }   // FX + pad belongs to studio.js
		useAll();

		if (isHeld("btnRecord")) { ate[n] = 1; sampleInto(n, e.pointerId); return; }
		if (copyArm === "pattern" && g("state", 0) === 3) { ate[n] = 1; copyPattern(n - 1); return; }
		if (copyArm === "sound" && g("state", 0) === 2) { ate[n] = 1; copySound(n); return; }
		if (isHeld("btnWrite") && g("play", false) && g("state", 0) === 0) { ate[n] = 1; punchIn(n - 1); return; }

		// WRITE keeps the click: a press-and-hold there latches a step lock
		if (g("view", 0) === 1) { return; }

		ate[n] = 1;
		call("buttonFunction", n);
	}

	function eatClicks(e) {
		var el = e.target.closest && e.target.closest(".buttonGridItem");
		if (!el) { return; }
		var n = padNum(el);
		if (n && ate[n]) {
			delete ate[n];
			delete el.dataset.lockFired;
			e.stopImmediatePropagation();
			e.preventDefault();
			return;
		}
		if (KEYS.indexOf(el.id) !== -1) {
			e.stopImmediatePropagation();
			e.preventDefault();
		}
	}

	function sliderUse() {
		if (isHeld("btnBPM")) { held.btnBPM.used = true; }
		if (isHeld("btnWrite")) { held.btnWrite.used = true; }
	}

	function releaseAll() {
		Object.keys(held).forEach(keyUp);
		sampleRelease(recPointer);
	}

	function boot() {
		document.addEventListener("pointerdown", padDown, true);
		document.addEventListener("pointerup", function (e) { sampleRelease(e.pointerId); }, true);
		document.addEventListener("pointercancel", function (e) { sampleRelease(e.pointerId); }, true);
		document.addEventListener("click", eatClicks, true);
		document.addEventListener("input", function (e) {
			if (e.target && /^slider[12]$/.test(e.target.id)) { sliderUse(); }
		}, true);
		window.addEventListener("blur", releaseAll);
		var tries = 0;
		var iv = setInterval(function () {
			if (wireKeys() || ++tries > 60) { clearInterval(iv); }
		}, 100);
	}

	window.PO33 = window.PO33 || {};
	window.PO33.hold = {
		held: function (id) { return isHeld(id); },
		releaseAll: releaseAll
	};

	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
