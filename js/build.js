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
	 * The styles.
	 *
	 * Step numbers are 0-15 across one bar. Step 0 is the "one" you would count
	 * in; 4, 8 and 12 are the other three beats. Anything else is an off-beat.
	 * Melodic entries are [step, pad] — the pad index picks the note out of
	 * whatever scale is set, so they stay in key.
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
	function pickSlot(kind, taken, patIdx) {
		var from = kind === "drum" ? 8 : 0, to = kind === "drum" ? 16 : 8;
		var pref = -1;
		for (var ch = from; ch < to; ch++) {
			if (!slotLoaded(ch)) { continue; }
			if (pref < 0) { pref = ch; }
			if (taken.indexOf(ch) !== -1) { continue; }
			if (!hasAny(ch, patIdx)) { return { ch: ch, fresh: true }; }
		}
		for (var c2 = from; c2 < to; c2++) {
			if (slotLoaded(c2) && taken.indexOf(c2) === -1) { return { ch: c2, fresh: false }; }
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
	function setStep(ch, step, pitch, vol, patIdx) {
		var c = cell(ch, step, patIdx), cs;
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

	function putDrums(patIdx, opts) {
		opts = opts || {};
		var st = STYLES[styleName], taken = [], out = [];
		[["kick", st.kick], ["snare", st.snare], ["hat", st.hat]].forEach(function (pair) {
			if (opts.noKick && pair[0] === "kick") { return; }
			var pick = pickSlot("drum", taken, patIdx);
			if (!pick) { return; }
			taken.push(pick.ch);
			if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
			pair[1].forEach(function (s, i) {
				// hats sit back so they don't fight the kick and snare
				var vol = pair[0] === "hat" ? -20 : (i === 0 ? -8 : -12);
				setStep(pick.ch, s, 0, vol, patIdx);
			});
			out.push(pair[0] + " → slot " + (pick.ch + 1) + (pick.fresh ? "" : " (replaced)"));
		});
		return out;
	}

	function putBass(patIdx) {
		var pick = pickSlot("melodic", [], patIdx);
		if (!pick) { return null; }
		if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
		STYLES[styleName].bass.forEach(function (pr) { setStep(pick.ch, pr[0], pr[1], -10, patIdx); });
		return { ch: pick.ch, txt: "bass → slot " + (pick.ch + 1) + (pick.fresh ? "" : " (replaced)") };
	}

	function putMelody(patIdx, avoid) {
		var pick = pickSlot("melodic", avoid || [], patIdx);
		if (!pick) { return null; }
		if (!pick.fresh) { clearSlot(pick.ch, patIdx); }
		STYLES[styleName].mel.forEach(function (pr) { setStep(pick.ch, pr[0], pr[1], -14, patIdx); });
		return { ch: pick.ch, txt: "melody → slot " + (pick.ch + 1) + (pick.fresh ? "" : " (replaced)") };
	}

	/* ============================================================
	 * Patterns and arrangement
	 * ============================================================ */

	// Prefer empty patterns; if there are none, take the ones after this and
	// say so. Refusing to act is the worse outcome, and undo covers it.
	function findPatterns(n) {
		var out = [], reused = false;
		for (var q = 0; q < 16 && out.length < n; q++) {
			if (q !== cur() && patternEmpty(q)) { out.push(q); }
		}
		var next = cur();
		while (out.length < n) {
			next = (next + 1) % 16;
			if (next === cur() || out.indexOf(next) !== -1) { next = (next + 1) % 16; }
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
			[12, 13, 14, 15].forEach(function (s) { setStep(snare, s, 0, -12, to); });
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
		var avoid = [];
		if (!st.drums) { putDrums().forEach(function (t) { log.push(t); }); }
		if (!st.bass) {
			var bres = putBass();
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

		try {
			window.tempo = STYLES[styleName].bpm;
			Tone.Transport.bpm.value = window.tempo;
		} catch (e) {}

		// 1. the main bar — everything
		clearPatternAt(main);
		var avoid = [];
		putDrums(main).forEach(function (t) { log.push(t); });
		var bres = putBass(main);
		if (bres) { avoid.push(bres.ch); log.push(bres.txt); }
		var mres = putMelody(main, avoid);
		if (mres) { log.push(mres.txt); }

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

		// 4. turnaround — the main bar with a fill at the end
		clearPatternAt(fill);
		makeVariation(main, fill);

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
			: "all three jobs are covered.") + "</p></div>";

		s += '<div class="uvSec"><h4>style</h4><div class="uvRow">' +
			Object.keys(STYLES).map(function (k) {
				return '<button type="button" data-bd="style" data-v="' + k + '"' +
					(k === styleName ? ' class="on"' : "") + ">" + k + "</button>";
			}).join("") + "</div>" +
			'<p class="bdNote">sets the rhythm and the tempo (' +
				STYLES[styleName].bpm + " BPM).</p></div>";

		s += '<div class="uvSec"><h4>make a whole beat</h4><div class="uvRow">' +
			'<button type="button" data-bd="whole" class="bdBig">build a whole beat</button>' +
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
				try { window.tempo = STYLES[styleName].bpm; Tone.Transport.bpm.value = window.tempo; } catch (e) {}
				flash(styleName + " · " + STYLES[styleName].bpm + " BPM", "tip");
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
