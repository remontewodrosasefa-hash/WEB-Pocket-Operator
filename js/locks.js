/* locks.js — per-step parameter locks + accent / velocity.
 *
 * In WRITE mode, PRESS AND HOLD a lit step pad (~250ms). That step LATCHES into
 * lock mode (the screen shows "LOCK step N") and stays latched, so you are free
 * to move a slider with the mouse or another finger. Whatever you move is saved
 * to THAT STEP only, not the whole sound:
 *
 *   TONE   -> slider1 = note / sample for this step, slider2 = volume (accent)
 *   FILTER -> slider1 = cutoff (LPF / off / HPF),    slider2 = resonance
 *   TRIM   -> slider1 = start,                       slider2 = length
 *
 * Tap the latched pad again (or leave WRITE mode) to finish.
 * Exposes window.PO33.locks
 */
(function () {
	"use strict";

	var HOLD_MS = 250;
	var DEFAULT_VOL = -12;
	var FX_LABEL = ["TONE", "FILTER", "TRIM"];

	var lockStep = -1;        // latched step index, or -1
	var lockChannel = -1;     // channel the latch belongs to
	var holdTimer = null;
	var bar = null;

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }
	function inWrite() { var m = g("mode", 0); return m === 1 || m === 11; }

	function beatAt(step, ch) {
		try {
			return window.newChannelArr[ch == null ? g("selectedChannel", 0) : ch][g("currentPattern", 0)][step];
		} catch (e) { return null; }
	}
	function persist() {
		try { localStorage.setItem("po33_settings", JSON.stringify(window.newChannelArr, null, "  ")); } catch (e) {}
	}

	/* ---------- on-screen readout ---------- */

	function ensureBar() {
		if (bar) { return bar; }
		var hud = document.getElementById("lcdHud");
		if (!hud) { return null; }
		bar = document.createElement("div");
		bar.id = "lockBar";
		bar.hidden = true;
		hud.appendChild(bar);
		return bar;
	}

	function describe(b) {
		var fx = g("fxMode", 0);
		if (fx === 1) {
			return "cutoff " + Math.round(b.fxFilterFreq || 20) + "Hz  ·  res " +
				(Math.round((b.fxFilterRes || 1) * 10) / 10);
		}
		if (fx === 2) {
			return "start " + Math.round((b.fxTrim || 0) / 10) + "%  ·  len " +
				Math.round((b.fxLength == null ? 1000 : b.fxLength) / 10) + "%";
		}
		var v = (b.fxVolume == null ? DEFAULT_VOL : b.fxVolume);
		var tag = v > DEFAULT_VOL + 4 ? "  ACCENT" : (v < DEFAULT_VOL - 6 ? "  ghost" : "");
		return "note " + ((b.notePitch || 0) + 1) + "  ·  vol " +
			(Math.round(v * 10) / 10) + "dB" + tag;
	}

	function showBar() {
		var el = ensureBar();
		var b = beatAt(lockStep, lockChannel);
		if (!el || !b) { return; }
		el.innerHTML = '<b>LOCK step ' + (lockStep + 1) + '</b> · ' + FX_LABEL[g("fxMode", 0)] +
			' — ' + describe(b) +
			'<span class="lbHint">move a slider · tap the pad to finish</span>';
		el.hidden = false;
		document.body.classList.add("lockHold");
	}
	function hideBar() {
		if (bar) { bar.hidden = true; }
		document.body.classList.remove("lockHold");
	}

	/* ---------- latch control ---------- */

	function latch(step) {
		lockStep = step;
		lockChannel = g("selectedChannel", 0);
		syncSlidersToStep();
		showBar();
	}
	function unlatch(quiet) {
		if (lockStep >= 0) { persist(); }
		lockStep = -1;
		lockChannel = -1;
		hideBar();
		if (!quiet) { flash("step locks saved", "tip"); }
	}

	/* ---------- write a slider value into the latched step ---------- */

	function applyLock(dialNumber, value) {
		var b = beatAt(lockStep, lockChannel);
		if (!b) { return; }
		var fx = g("fxMode", 0);

		if (fx === 1) {                                   // FILTER
			if (dialNumber === 1) {
				var minv = Math.log(20), maxv = Math.log(12000);
				var scale = (maxv - minv) / 475;
				if (value < 475) {
					b.fxFilterType = "lowpass";
					b.fxFilterFreq = Math.exp(minv + scale * value);
				} else if (value > 525) {
					b.fxFilterType = "highpass";
					b.fxFilterFreq = Math.exp(minv + scale * (value - 525));
				} else {
					b.fxFilterType = "highpass";
					b.fxFilterFreq = 20;
				}
				b.fxFilter = value;
			} else {
				b.fxFilterRes = value / 100;
				b.fxResonance = value;
			}
		} else if (fx === 2) {                            // TRIM
			if (dialNumber === 1) { b.fxTrim = Math.round(value); }
			else { b.fxLength = Math.max(10, Math.round(value)); }
		} else {                                          // TONE
			if (dialNumber === 1) {
				b.notePitch = Math.max(0, Math.min(15, Math.floor(value / 1000 * 16)));
			} else {
				b.fxVolume = Math.max(-40, Math.min(6, (value - 500) / 20.8));
			}
		}
		b.locked = 1;
		showBar();
	}

	// park the sliders on the latched step's values so nothing jumps
	function syncSlidersToStep() {
		var b = beatAt(lockStep, lockChannel);
		var s1 = document.getElementById("slider1");
		var s2 = document.getElementById("slider2");
		if (!b || !s1 || !s2) { return; }
		var fx = g("fxMode", 0), v1, v2;
		if (fx === 1) {
			v1 = b.fxFilter == null ? 500 : b.fxFilter;
			v2 = b.fxResonance == null ? 100 : b.fxResonance;
		} else if (fx === 2) {
			v1 = b.fxTrim || 0;
			v2 = b.fxLength == null ? 1000 : b.fxLength;
		} else {
			v1 = Math.round((b.notePitch || 0) / 16 * 1000);
			v2 = Math.round((b.fxVolume == null ? DEFAULT_VOL : b.fxVolume) * 20.8 + 500);
		}
		s1.value = Math.max(0, Math.min(1000, v1));
		s2.value = Math.max(0, Math.min(1000, v2));
	}

	/* ---------- clearing ---------- */

	function clearStep(step, ch) {
		var b = beatAt(step, ch);
		var cs;
		try { cs = window.channelSettingsArr[ch == null ? g("selectedChannel", 0) : ch]; } catch (e) {}
		if (!b || !cs) { return; }
		b.notePitch = cs.notePitch;
		b.fxVolume = cs.fxVolume;
		b.fxTrim = cs.fxTrim;
		b.fxLength = cs.fxLength;
		b.fxFilter = cs.fxFilter;
		b.fxFilterType = cs.fxFilterType;
		b.fxFilterFreq = cs.fxFilterFreq;
		b.fxResonance = cs.fxResonance;
		b.fxFilterRes = cs.fxFilterRes;
		b.locked = 0;
	}
	function clearAllLocks() {
		var ch = g("selectedChannel", 0);
		for (var s = 0; s < 16; s++) { clearStep(s, ch); }
		persist();
		unlatch(true);
		flash("locks cleared on SOUND " + (ch + 1), "warn");
	}

	/* ---------- pads ---------- */

	function wirePads() {
		for (var n = 1; n <= 16; n++) {
			(function (n) {
				var el = document.getElementById("btn" + n);
				if (!el || el.dataset.lockWired) { return; }
				el.dataset.lockWired = "1";
				var step = n - 1;

				el.addEventListener("pointerdown", function () {
					if (!inWrite() || window.fxHeld) { return; }
					clearTimeout(holdTimer);

					// already latched? a short tap finishes, or moves the latch
					if (lockStep >= 0) { return; }

					holdTimer = setTimeout(function () {
						var b = beatAt(step);
						if (!b || !b.noteOn) {
							flash("step " + n + " is empty — tap to add it first", "warn");
							return;
						}
						el.dataset.lockFired = "1";
						latch(step);
					}, HOLD_MS);
				}, true);

				el.addEventListener("pointerup", function () { clearTimeout(holdTimer); }, true);
				el.addEventListener("pointercancel", function () { clearTimeout(holdTimer); }, true);

				el.addEventListener("click", function (e) {
					// swallow the click that ended a hold
					if (el.dataset.lockFired) {
						e.stopImmediatePropagation();
						e.preventDefault();
						delete el.dataset.lockFired;
						return;
					}
					// while latched, taps re-target or finish instead of toggling steps
					if (lockStep >= 0) {
						e.stopImmediatePropagation();
						e.preventDefault();
						if (step === lockStep) { unlatch(); return; }
						var b = beatAt(step);
						if (b && b.noteOn) { latch(step); }
						else { flash("step " + n + " is empty", "warn"); }
					}
				}, true);
			})(n);
		}
	}

	/* ---------- slider interception ----------
	 * Listens on `document` in the CAPTURE phase. At the target node itself
	 * listeners run in registration order regardless of the capture flag, and
	 * studio.js registers its channel-wide handler first — capturing on an
	 * ancestor is the only way to reliably get in front of it.
	 */
	function wireSliders() {
		if (document.documentElement.dataset.lockSliders) { return; }
		document.documentElement.dataset.lockSliders = "1";
		document.addEventListener("input", function (e) {
			if (lockStep < 0) { return; }
			var id = e.target && e.target.id;
			var n = id === "slider1" ? 1 : (id === "slider2" ? 2 : 0);
			if (!n) { return; }
			e.stopImmediatePropagation();   // keep it off the channel-wide handler
			applyLock(n, +e.target.value);
		}, true);
	}

	// leaving WRITE, switching sound or pattern drops the latch
	function watch() {
		setInterval(function () {
			if (lockStep < 0) { return; }
			if (!inWrite() || g("selectedChannel", 0) !== lockChannel) { unlatch(true); }
		}, 200);
	}

	window.PO33 = window.PO33 || {};
	window.PO33.locks = {
		clearStep: clearStep,
		clearAll: clearAllLocks,
		held: function () { return lockStep; },
		unlatch: unlatch
	};

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (document.getElementById("btn1") && document.getElementById("slider1")) {
				wirePads(); wireSliders(); ensureBar(); watch(); clearInterval(iv);
			} else if (++tries > 80) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
