/* ux.js — the small touches that make the hardware readable.
 *
 * Four jobs, all additive. Nothing here owns state; everything reads from
 * modules that already own it (library.js owns slots, chopstore.js owns
 * chops, po33.js owns the session). If any of them is missing this file
 * degrades to doing nothing rather than throwing.
 *
 *   1. haptics   — a tick the instant a pad goes down, not on click.
 *   2. pad dots  — while the pads mean SLOTS, each one says whether that
 *                  slot is chopped and whether it is used in this bar.
 *   3. autosave  — a dot in the screen corner that blinks when the session
 *                  is actually written, so "did that save?" stops being a
 *                  question.
 *   4. coach     — a one-time first-run card. Shown once, ever, per browser.
 *                  It never takes a tap: the card is pointer-transparent
 *                  and the first touch anywhere dismisses it, so it cannot
 *                  sit between you and a control the way a modal would.
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	/* ---------------------------------------------------------------
	 * 1. haptics on pointerdown
	 *
	 * studio.js already vibrates, but it does it on `click`, which on a
	 * touchscreen lands ~100ms after the finger and after the sound. A tick
	 * that arrives late reads as lag, not as feedback. Capture-phase
	 * pointerdown fires with the sound, so we take over here and studio.js
	 * loses its copy (see the guard it now checks).
	 * ------------------------------------------------------------- */
	window.PO33.hapticsOwned = true;

	function buzz(ms) {
		try {
			if (localStorage.getItem("po33.haptics") === "0") { return; }
			if (navigator.vibrate) { navigator.vibrate(ms || 8); }
		} catch (e) {}
	}
	window.PO33.buzz = buzz;

	document.addEventListener("pointerdown", function (e) {
		var t = e.target;
		if (!t || !t.closest) { return; }
		// every pad, every transport key, every perform cell
		var hit = t.closest(".buttonGridItem, .perfCells button, .keysBar button, .topBtn");
		if (!hit) { return; }
		// the 16 pads get a slightly firmer tick than the chrome around them,
		// so a mis-hit on a label feels different from a real pad
		buzz(/btnNumber/.test(hit.className) ? 11 : 7);
	}, true);

	/* ---------------------------------------------------------------
	 * 2. pad status dots
	 *
	 * Only drawn while the pads MEAN slots — that is, in SOUND-select
	 * (state 2). In WRITE the same pads are steps, and a slot annotation
	 * sitting on top of step LEDs would be worse than no annotation.
	 *
	 * Two things worth saying about a slot, and only two:
	 *
	 *     green   this slot is chopped — those 16 pads are your slices,
	 *             and writing over them would throw that work away
	 *     amber   this slot has steps in the bar you are on, so it is
	 *             part of what you are currently hearing
	 *
	 * Deliberately NOT "has a sample loaded": after boot every one of the
	 * sixteen slots has audio in it, so that dot would be lit on all of
	 * them, always, and would tell you nothing.
	 * ------------------------------------------------------------- */
	function padEl(n) { return document.getElementById("btn" + n); }

	function ensureDot(el) {
		var d = el.querySelector(".padDot");
		if (!d) {
			d = document.createElement("i");
			d.className = "padDot";
			el.appendChild(d);
		}
		return d;
	}

	// does this slot put anything in the pattern we are looking at?
	function slotUsed(channel) {
		var arr = window.newChannelArr;
		var pat = window.currentPattern || 0;
		if (!arr || !arr[channel] || !arr[channel][pat]) { return false; }
		var steps = arr[channel][pat];
		for (var i = 0; i < steps.length; i++) {
			if (steps[i] && steps[i].noteOn) { return true; }
		}
		return false;
	}

	var lastDotSig = "";

	function paintDots() {
		var onSlots = (window.state === 2);
		var chops = window.PO33.chops;
		var sig = onSlots ? "s" : "-", i, el, dot, cls, chopped, used, name;

		// build the whole picture first, then touch the DOM only if it moved
		var want = [];
		for (i = 1; i <= 16; i++) {
			chopped = false;
			try { chopped = !!(chops && chops.isChopped(i)); } catch (e) {}
			used = onSlots && slotUsed(i - 1);
			cls = !onSlots ? "" : chopped ? " chop" : used ? " on" : "";
			want.push(cls);
			sig += cls || ".";
		}
		if (sig === lastDotSig) { return; }
		lastDotSig = sig;

		for (i = 1; i <= 16; i++) {
			el = padEl(i);
			if (!el) { continue; }
			dot = ensureDot(el);
			dot.className = "padDot" + want[i - 1];
			// the hover title is the desktop affordance for the same facts
			name = null;
			try { name = window.PO33Lib ? PO33Lib.slotName(i) : null; } catch (e) {}
			el.title = "slot " + i
				+ (want[i - 1] === " chop" ? " · chopped" : "")
				+ (want[i - 1] === " on" ? " · playing in this bar" : "")
				+ (name ? " · " + name : "");
		}
	}

	window.PO33.padDots = paintDots;

	/* ---------------------------------------------------------------
	 * 3. autosave indicator
	 *
	 * po33.js writes the session on a 250ms debounce. We wrap the write, not
	 * the call, so the dot blinks when bytes actually land in localStorage —
	 * not every time something *asked* for a save.
	 * ------------------------------------------------------------- */
	var saveDot = null, saveTimer = null;

	function ensureSaveDot() {
		if (saveDot && saveDot.isConnected) { return saveDot; }
		var hud = document.getElementById("lcdHud");
		if (!hud) { return null; }
		saveDot = document.getElementById("saveDot");
		if (!saveDot) {
			saveDot = document.createElement("div");
			saveDot.id = "saveDot";
			saveDot.title = "session saved";
			hud.appendChild(saveDot);
		}
		return saveDot;
	}

	function blinkSaved() {
		var d = ensureSaveDot();
		if (!d) { return; }
		d.classList.add("wrote");
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () { d.classList.remove("wrote"); }, 700);
	}

	function wrapSave() {
		var s = window.PO33 && window.PO33.session;
		if (!s || s.save.__ux) { return false; }
		var orig = s.save;
		var wrapped = function (immediate) {
			var r = orig.apply(this, arguments);
			// the debounce means the real write is up to 250ms out; match it
			// so the dot lines up with the write instead of the intent
			setTimeout(blinkSaved, immediate ? 0 : 260);
			// slots may have changed with it
			setTimeout(paintDots, immediate ? 0 : 280);
			return r;
		};
		wrapped.__ux = true;
		s.save = wrapped;
		return true;
	}

	/* ---------------------------------------------------------------
	 * 4. first-run coach card
	 *
	 * One card, once, dismissed by touching it. It names the four controls
	 * that are not guessable from the hardware, and points at the guide for
	 * the rest. Stored under its own key so clearing a project never brings
	 * it back.
	 * ------------------------------------------------------------- */
	var COACH_KEY = "po33.coached";

	function coachSeen() {
		try { return localStorage.getItem(COACH_KEY) === "1"; } catch (e) { return true; }
	}

	function dismissCoach() {
		var c = document.getElementById("coachCard");
		if (c) { c.classList.remove("show"); setTimeout(function () { if (c.parentNode) { c.parentNode.removeChild(c); } }, 260); }
		try { localStorage.setItem(COACH_KEY, "1"); } catch (e) {}
	}

	// any panel that has taken the screen over — a card on top of the trim
	// waveform or the project list is noise, not help
	var PANEL_OPEN = /\b(trimOpen|utilOpen|projOpen|buildOpen|lib-lcd|libOpen|infoOpen)\b/;

	function panelOpen() {
		return PANEL_OPEN.test(document.body.className || "");
	}

	function showCoach() {
		if (coachSeen() || document.getElementById("coachCard")) { return; }
		if (panelOpen()) { return; }
		var host = document.querySelector(".lcd");
		if (!host) { return; }
		var c = document.createElement("div");
		c.id = "coachCard";
		c.innerHTML =
			'<div class="coachHead">first time?</div>' +
			'<ul>' +
				'<li>hold <b>SOUND</b> + a pad: pick what you play</li>' +
				'<li><b>WRITE</b>, then pads: put it on steps</li>' +
				'<li>hold <b>RECORD</b> + a pad: sample into it</li>' +
			'</ul>' +
			'<div class="coachFoot">tap to start · full guide in the menu</div>';
		host.appendChild(c);
		// let it land in the DOM before the transition starts
		requestAnimationFrame(function () { c.classList.add("show"); });

		// The first touch ANYWHERE takes it down, and that touch still reaches
		// whatever it was aimed at — the card is pointer-events:none, so it is
		// invisible to hit-testing. A first-run card that swallowed your first
		// tap would be worse than no card at all.
		var go = function () {
			document.removeEventListener("pointerdown", go, true);
			document.removeEventListener("keydown", go, true);
			dismissCoach();
		};
		document.addEventListener("pointerdown", go, true);
		document.addEventListener("keydown", go, true);

		// and if a panel opens on a timer, get out of its way
		var watch = setInterval(function () {
			if (!document.getElementById("coachCard")) { clearInterval(watch); return; }
			if (panelOpen()) { clearInterval(watch); dismissCoach(); }
		}, 300);
	}

	window.PO33.coach = { show: showCoach, reset: function () { try { localStorage.removeItem(COACH_KEY); } catch (e) {} } };

	/* ---------------------------------------------------------------
	 * boot
	 * ------------------------------------------------------------- */
	function init() {
		// the session and the library both finish building well after DOM
		// ready, so poll briefly instead of guessing one timeout
		var tries = 0;
		var t = setInterval(function () {
			tries++;
			var done = wrapSave();
			if (document.getElementById("lcdHud")) { ensureSaveDot(); }
			paintDots();
			if (done || tries > 40) { clearInterval(t); }
		}, 150);

		// the dots depend on the mode, which changes on a button press, so
		// this has to be quick enough to feel instant. It is a few hundred
		// array reads and it only touches the DOM when the picture changes.
		setInterval(paintDots, 250);

		setTimeout(showCoach, 2600);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else { init(); }
})();
