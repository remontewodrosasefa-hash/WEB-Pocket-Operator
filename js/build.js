/* build.js — the BUILD screen. Triple-press TRIM to open it.
 *
 * WHAT IT IS FOR
 * A beat is made of a few jobs: something to keep time (drums), something low
 * to hold it down (bass), and something to sing the tune (melody). If you don't
 * know which of those you're missing or what to put there, you stall.
 *
 * This looks at what you have already, tells you which jobs are still empty,
 * and offers to fill them. It NEVER overwrites something you made — it only
 * writes into parts that are empty. You start an idea, it builds around it, you
 * change what you don't like, repeat.
 *
 * Everything it does is one undo away (UTIL -> undo).
 *
 * Exposes window.PO33.build
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var view, open = false;

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
	 * The styles.
	 *
	 * Step numbers are 0-15 across one bar. Step 0 is the "one" you'd count
	 * in; 4, 8 and 12 are the other three beats. Everything between them is
	 * an off-beat.
	 * ============================================================ */
	var STYLES = {
		"boom bap": {
			bpm: 90,
			kick:  [0, 3, 10],
			snare: [4, 12],
			hat:   [0, 2, 4, 6, 8, 10, 12, 14],
			bass:  [[0, 0], [3, 0], [10, 2], [14, 4]],
			mel:   [[0, 4], [6, 7], [8, 5], [11, 9], [14, 7]]
		},
		"trap": {
			bpm: 140,
			kick:  [0, 6, 10, 11],
			snare: [8],
			hat:   [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
			bass:  [[0, 0], [6, 0], [10, 3]],
			mel:   [[0, 7], [4, 9], [8, 5], [12, 4]]
		},
		"house": {
			bpm: 124,
			kick:  [0, 4, 8, 12],
			snare: [4, 12],
			hat:   [2, 6, 10, 14],
			bass:  [[2, 0], [6, 0], [10, 4], [14, 2]],
			mel:   [[0, 5], [3, 7], [8, 9], [11, 7], [14, 5]]
		},
		"lo-fi": {
			bpm: 76,
			kick:  [0, 9],
			snare: [4, 12],
			hat:   [2, 6, 10, 14],
			bass:  [[0, 0], [9, 2]],
			mel:   [[2, 4], [5, 7], [10, 9], [13, 5]]
		}
	};
	var styleName = "boom bap";

	/* ============================================================
	 * Reading and writing the pattern
	 * ============================================================ */

	// Slots the builder is allowed to use. These are the ones that ship with a
	// sound loaded, so the result is audible without the user loading anything.
	var SLOT = { kick: 8, snare: 9, hat: 10, bass: 0, mel: 1 };   // 0-based channels

	function pat() { return g("currentPattern", 0); }

	function cell(ch, step) {
		try { return window.newChannelArr[ch][pat()][step]; } catch (e) { return null; }
	}

	function hasAny(ch) {
		for (var i = 0; i < 16; i++) {
			var c = cell(ch, i);
			if (c && c.noteOn) { return true; }
		}
		return false;
	}

	function slotLoaded(ch) {
		try {
			return ch < 8 ? !!window.melodicArr[ch] : !!window.drumArr[ch - 8];
		} catch (e) { return false; }
	}

	// Write one step. Mirrors what editPattern does when it turns a step on, so
	// a built step behaves exactly like one you tapped in by hand.
	function setStep(ch, step, pitch, vol) {
		var c = cell(ch, step);
		var cs;
		try { cs = window.channelSettingsArr[ch]; } catch (e) { return; }
		if (!c || !cs) { return; }
		c.noteOn = 1;
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
		try {
			localStorage.setItem("po33_settings",
				JSON.stringify(window.newChannelArr, null, "  "));
		} catch (e) {}
	}

	/* ============================================================
	 * What's missing
	 * ============================================================ */

	function state() {
		var drums = hasAny(SLOT.kick) || hasAny(SLOT.snare) || hasAny(SLOT.hat);
		// anything on slots 9-16 counts as drums, not just ours
		for (var d = 8; d < 16 && !drums; d++) { if (hasAny(d)) { drums = true; } }
		var bass = hasAny(SLOT.bass);
		var mel = hasAny(SLOT.mel);
		var kt = null;
		try { kt = PO33.keys.track(); } catch (e) {}
		if (kt) { for (var k = 0; k < 16; k++) { if (kt[k]) { mel = true; break; } } }
		return { drums: drums, bass: bass, melody: mel };
	}

	/* ============================================================
	 * The builders
	 * ============================================================ */

	function addDrums() {
		var st = STYLES[styleName];
		var did = [];
		[["kick", st.kick], ["snare", st.snare], ["hat", st.hat]].forEach(function (pair) {
			var ch = SLOT[pair[0]];
			if (!slotLoaded(ch)) { return; }
			if (hasAny(ch)) { return; }               // never paint over your work
			pair[1].forEach(function (s, i) {
				// hats sit back a little so they don't fight the kick and snare
				var vol = pair[0] === "hat" ? -20 : (i === 0 ? -8 : -12);
				setStep(ch, s, 0, vol);
			});
			did.push(pair[0]);
		});
		return did;
	}

	function addBass() {
		var ch = SLOT.bass;
		if (!slotLoaded(ch) || hasAny(ch)) { return false; }
		STYLES[styleName].bass.forEach(function (pair) {
			setStep(ch, pair[0], pair[1], -10);
		});
		return true;
	}

	function addMelody() {
		var ch = SLOT.mel;
		if (!slotLoaded(ch) || hasAny(ch)) { return false; }
		STYLES[styleName].mel.forEach(function (pair) {
			setStep(ch, pair[0], pair[1], -14);
		});
		return true;
	}

	/* A second pattern that is the first one with holes knocked in it and a
	 * fill at the end. Repetition with one bar that breaks is what makes a
	 * loop feel like a song instead of a loop. */
	function addVariation() {
		var from = pat();
		var to = -1;
		for (var q = 0; q < 16; q++) {
			if (q === from) { continue; }
			var used = false;
			for (var ch = 0; ch < 16 && !used; ch++) {
				for (var i = 0; i < 16; i++) {
					try { if (window.newChannelArr[ch][q][i].noteOn) { used = true; break; } } catch (e) {}
				}
			}
			if (!used) { to = q; break; }
		}
		if (to < 0) { flash("no empty pattern left to put a variation in", "warn"); return false; }

		for (var c2 = 0; c2 < 16; c2++) {
			for (var s2 = 0; s2 < 16; s2++) {
				var src, dst;
				try {
					src = window.newChannelArr[c2][from][s2];
					dst = window.newChannelArr[c2][to][s2];
				} catch (e) { continue; }
				if (!src || !dst) { continue; }
				Object.keys(src).forEach(function (k) { dst[k] = src[k]; });
				// thin the last quarter out, then put a busy fill on the snare
				if (src.noteOn && s2 >= 12 && c2 !== SLOT.snare) { dst.noteOn = 0; }
			}
		}
		if (slotLoaded(SLOT.snare)) {
			[12, 13, 14, 15].forEach(function (s) { setStepIn(to, SLOT.snare, s, -12); });
		}
		persist();
		flash("pattern " + (to + 1) + " is a variation of " + (from + 1) +
			" \\u2014 chain them to hear it", "tip");
		return to;
	}

	function setStepIn(patIdx, ch, step, vol) {
		var save = window.currentPattern;
		window.currentPattern = patIdx;
		setStep(ch, step, 0, vol);
		window.currentPattern = save;
	}

	// Play three bars of the main idea, then the variation. The oldest trick
	// there is, and it works every time.
	function chainIt(varIdx) {
		try {
			var base = pat();
			window.patternChain = [base, base, base, varIdx];
			window.patternCount = 0;
			flash("chain set: " + [base, base, base, varIdx]
				.map(function (n) { return n + 1; }).join(" "), "tip");
			return true;
		} catch (e) { return false; }
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

		s += '<div class="uvSec"><h4>what this pattern has</h4><div class="uvRow bdHave">' +
			["drums", "bass", "melody"].map(function (k) {
				return "<span class='" + (st[k] ? "roleOk" : "roleGap") + "'>" +
					(st[k] ? "✓ " : "– ") + k + "</span>";
			}).join("") + "</div>";
		s += '<p class="bdNote">' + (missing.length
			? "missing: <b>" + missing.join(", ") + "</b>. the buttons below only fill " +
				"what's empty &mdash; nothing you made gets written over."
			: "all three jobs are covered. try a variation below.") + "</p></div>";

		s += '<div class="uvSec"><h4>style</h4><div class="uvRow">' +
			Object.keys(STYLES).map(function (k) {
				return '<button type="button" data-bd="style" data-v="' + k + '"' +
					(k === styleName ? ' class="on"' : "") + ">" + k + "</button>";
			}).join("") + "</div>" +
			'<p class="bdNote">picks the rhythm and sets the tempo (' +
				STYLES[styleName].bpm + " BPM).</p></div>";

		s += '<div class="uvSec"><h4>fill the gaps</h4><div class="uvRow">' +
			'<button type="button" data-bd="all" class="bdBig">build the rest for me</button>' +
			"</div><div class='uvRow'>" +
			'<button type="button" data-bd="drums"' + (st.drums ? " disabled" : "") + ">+ drums</button>" +
			'<button type="button" data-bd="bass"' + (st.bass ? " disabled" : "") + ">+ bass</button>" +
			'<button type="button" data-bd="melody"' + (st.melody ? " disabled" : "") + ">+ melody</button>" +
			"</div></div>";

		s += '<div class="uvSec"><h4>make it a song</h4><div class="uvRow">' +
			'<button type="button" data-bd="vary">+ variation bar</button>' +
			'<button type="button" data-bd="varychain">+ variation &amp; chain it</button>' +
			"</div>" +
			'<p class="bdNote">a variation is this bar with the end stripped back and a ' +
			"fill on the snare. chaining plays your bar three times then the variation.</p></div>";

		s += '<div class="uvSec"><h4>if you don\'t like it</h4><div class="uvRow">' +
			'<button type="button" data-bd="undo">undo the last build</button>' +
			"</div></div>";

		return s + "</div>";
	}

	function paint() { if (view) { view.innerHTML = html(); } }

	function act(a, el) {
		switch (a) {
			case "close": hide(); break;
			case "style":
				styleName = el.getAttribute("data-v");
				try { window.tempo = STYLES[styleName].bpm; Tone.Transport.bpm.value = window.tempo; } catch (e) {}
				flash(styleName + " · " + STYLES[styleName].bpm + " BPM", "tip");
				paint();
				break;
			case "drums":
				mark("build drums");
				var d = addDrums(); persist();
				flash(d.length ? "added " + d.join(", ") : "those drum slots already have something", d.length ? "warn" : "tip");
				paint();
				break;
			case "bass":
				mark("build bass");
				flash(addBass() ? "bass on slot 1" : "slot 1 already has something", "warn");
				persist(); paint();
				break;
			case "melody":
				mark("build melody");
				flash(addMelody() ? "melody on slot 2" : "slot 2 already has something", "warn");
				persist(); paint();
				break;
			case "all":
				mark("build the rest");
				var did = addDrums();
				if (addBass()) { did.push("bass"); }
				if (addMelody()) { did.push("melody"); }
				persist();
				flash(did.length ? "built: " + did.join(", ") + " — press PLAY"
					: "nothing was empty to fill", did.length ? "warn" : "tip");
				paint();
				break;
			case "vary":
				mark("build variation");
				addVariation(); paint();
				break;
			case "varychain":
				mark("build variation + chain");
				var v = addVariation();
				if (v !== false && v >= 0) { chainIt(v); }
				paint();
				break;
			case "undo":
				try { PO33.undo.undo(); } catch (e) {}
				persist(); paint();
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
		if (!b || b.dataset.bdWired) { return false; }
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
