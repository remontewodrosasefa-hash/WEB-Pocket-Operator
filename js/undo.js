/* undo.js — undo / redo for pattern edits.
 *
 * Snapshots the pattern data just before anything mutates it, so a bad live-record
 * take, a stray step, an over-eager chop or a "clear pattern" can all be walked
 * back. Bursts inside 500ms collapse into one step, so holding WRITE and playing
 * a phrase is a single undo rather than forty.
 *
 * Snapshots are per-pattern (16 channels x 16 steps) unless something touches
 * everything, which keeps them small enough to hold plenty of history.
 *
 * Exposes window.PO33.undo
 */
(function () {
	"use strict";

	var LIMIT = 40, COALESCE = 500;
	var past = [], future = [], lastPush = 0, busy = false;

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	function persist() {
		try { localStorage.setItem("po33_settings", JSON.stringify(window.newChannelArr, null, "  ")); } catch (e) {}
	}

	/* ---------- snapshots ---------- */

	function snapPattern(idx) {
		var out = [];
		try {
			for (var c = 0; c < 16; c++) {
				out.push(JSON.parse(JSON.stringify(window.newChannelArr[c][idx])));
			}
		} catch (e) { return null; }
		return { kind: "pattern", idx: idx, data: out };
	}
	function snapAll() {
		try { return { kind: "all", data: JSON.parse(JSON.stringify(window.newChannelArr)) }; }
		catch (e) { return null; }
	}
	function snapChain() {
		try {
			return {
				kind: "chain",
				data: (window.patternChain || []).slice(),
				cur: g("currentPattern", 0),
				count: g("patternCount", 0)
			};
		} catch (e) { return null; }
	}

	function restore(s) {
		if (!s) { return; }
		try {
			if (s.kind === "chain") {
				window.patternChain = s.data.slice();
				window.currentPattern = s.cur;
				window.patternCount = Math.min(s.count, Math.max(0, s.data.length - 1));
				if (window.updateDisplay) { window.updateDisplay(); }
				return;
			}
			if (s.kind === "all") {
				window.newChannelArr = JSON.parse(JSON.stringify(s.data));
			} else {
				for (var c = 0; c < 16; c++) {
					window.newChannelArr[c][s.idx] = JSON.parse(JSON.stringify(s.data[c]));
				}
			}
			persist();
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) {}
	}

	/* ---------- the public hook every mutator calls ---------- */

	function mark(label, wide) {
		if (busy) { return; }
		var now = Date.now();
		// a burst of edits (live record, a chord) is one undo step
		if (!wide && now - lastPush < COALESCE && past.length) { lastPush = now; return; }
		lastPush = now;
		var s = wide ? snapAll() : snapPattern(g("currentPattern", 0));
		if (!s) { return; }
		s.label = label || "edit";
		past.push(s);
		if (past.length > LIMIT) { past.shift(); }
		future.length = 0;                 // a new edit clears the redo branch
		paint();
	}

	// Chain edits are marked individually — tapping 3,3,5,3,6,7 and undoing
	// should drop just the 7, not the whole run.
	function markChain() {
		if (busy) { return; }
		var snap = snapChain();
		if (!snap) { return; }
		var prev = past[past.length - 1];
		// skip if nothing actually changed since the last chain mark
		if (prev && prev.kind === "chain" && prev.data.join() === snap.data.join()) { return; }
		snap.label = "chain";
		past.push(snap);
		if (past.length > LIMIT) { past.shift(); }
		future.length = 0;
		lastPush = 0;              // don't let the next edit coalesce into this
		paint();
	}

	function undo() {
		if (!past.length) { flash("nothing to undo", "warn"); return; }
		busy = true;
		var s = past.pop();
		var back = s.kind === "chain" ? snapChain()
			: (s.kind === "all" ? snapAll() : snapPattern(s.idx));
		if (back) { back.label = s.label; future.push(back); }
		restore(s);
		busy = false;
		flash(s.kind === "chain"
			? ("undo · chain " + (window.patternChain || []).map(function (n) { return n + 1; }).join(" "))
			: ("undo · " + s.label), "tip");
		paint();
	}

	function redo() {
		if (!future.length) { flash("nothing to redo", "warn"); return; }
		busy = true;
		var s = future.pop();
		var back = s.kind === "chain" ? snapChain()
			: (s.kind === "all" ? snapAll() : snapPattern(s.idx));
		if (back) { back.label = s.label; past.push(back); }
		restore(s);
		busy = false;
		flash("redo · " + s.label, "tip");
		paint();
	}

	window.PO33 = window.PO33 || {};
	window.PO33.undo = {
		mark: mark, markChain: markChain, undo: undo, redo: redo,
		depth: function () { return past.length; },
		clear: function () { past.length = 0; future.length = 0; paint(); }
	};

	/* ---------- wrap the mutators ---------- */

	function wrap(getter, setter, label, wide) {
		var fn = getter();
		if (typeof fn !== "function" || fn.__undo) { return false; }
		var wrapped = function () {
			mark(label, wide);
			return fn.apply(this, arguments);
		};
		wrapped.__undo = true;
		setter(wrapped);
		return true;
	}

	function hook() {
		// step toggles + every live-record hit
		wrap(function () { return window.editPattern; },
			 function (f) { window.editPattern = f; }, "step");

		// pad presses while in PATTERN mode append to the chain — snapshot first
		var bf = window.buttonFunction;
		if (typeof bf === "function" && !bf.__undoChain) {
			var wrapped = function () {
				if (g("view", 0) === 3) { markChain(); }
				return bf.apply(this, arguments);
			};
			wrapped.__undoChain = true;
			window.buttonFunction = wrapped;
		}

		// the bigger, rarer operations get a full snapshot
		if (window.PO33.clearPattern) {
			wrap(function () { return window.PO33.clearPattern; },
				 function (f) { window.PO33.clearPattern = f; }, "clear pattern", true);
		}
		if (window.PO33.locks && window.PO33.locks.clearAll) {
			wrap(function () { return window.PO33.locks.clearAll; },
				 function (f) { window.PO33.locks.clearAll = f; }, "clear locks", true);
		}
		if (window.PO33.slice && window.PO33.slice.toSlot) {
			wrap(function () { return window.PO33.slice.toSlot; },
				 function (f) { window.PO33.slice.toSlot = f; }, "chop", true);
		}
		if (window.PO33.projects && window.PO33.projects.open) {
			wrap(function () { return window.PO33.projects.open; },
				 function (f) { window.PO33.projects.open = f; }, "load project", true);
		}
	}

	/* ---------- UI ---------- */

	var btn;
	function paint() {
		if (!btn) { return; }
		btn.disabled = !past.length;
		btn.title = past.length ? ("undo " + past[past.length - 1].label + " (" + past.length + ")")
			: "nothing to undo";
	}

	function build() {
		var top = document.querySelector("#lcdHud .hudTop");
		if (!top || document.getElementById("undoBtn")) { return !!top; }
		btn = document.createElement("button");
		btn.id = "undoBtn";
		btn.type = "button";
		btn.innerHTML = "&#8630;";                 // ↶
		btn.addEventListener("click", function (e) { e.stopPropagation(); undo(); });
		// long-press to redo
		var t;
		btn.addEventListener("pointerdown", function () { t = setTimeout(function () { redo(); }, 550); });
		["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
			btn.addEventListener(ev, function () { clearTimeout(t); });
		});
		var proj = document.getElementById("projBtn");
		top.insertBefore(btn, proj || top.lastChild);
		paint();
		return true;
	}

	function keys() {
		document.addEventListener("keydown", function (e) {
			var z = e.key === "z" || e.key === "Z";
			if (!(e.metaKey || e.ctrlKey) || !z) { return; }
			e.preventDefault();
			if (e.shiftKey) { redo(); } else { undo(); }
		});
	}

	function boot() {
		// undo.js loads before slice / projects / locks, so keep re-hooking for a
		// few seconds until every module has registered its functions.
		var tries = 0, built = false;
		var iv = setInterval(function () {
			hook();
			if (!built) { built = build(); }
			if (++tries > 60) { clearInterval(iv); }
		}, 150);
		keys();
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
