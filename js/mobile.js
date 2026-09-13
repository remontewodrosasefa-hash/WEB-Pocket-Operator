/* mobile.js — phone drawer chrome.
 * Bottom-left button opens a touch-worded guide (PO slides right);
 * bottom-right button opens the sample library (PO slides left).
 * Only active on touch / narrow screens; a no-op on desktop.
 */
(function () {
	"use strict";

	var mq = window.matchMedia("(max-width: 720px), (pointer: coarse)");

	/* The guide.
	 *
	 * It used to be a fixed slab of HTML written before half the instrument
	 * existed — no drum kits, no MIX tab, no synth, no effects
	 * recording. Worse, the long-form version lives in a <nav> in index.html
	 * that mobile.css hides outright, so on a phone it was unreachable.
	 *
	 * This is the single source of truth now: entries in a list, rendered into
	 * tabs, with a search across all of them — because at this size, scrolling
	 * four tabs hunting for one answer is the actual problem.
	 */
	var INFO = [
		["start", "What this is", "A sampler and a 16-step sequencer. It records short sounds into <b>16 slots</b>, then plays them back in a loop. Everything else is built on those two things."],
		["start", "The two halves", "<b>Slots 1&ndash;8 are melodic</b> &mdash; one sound played at 16 pitches, for tunes. <b>Slots 9&ndash;16 are drums</b> &mdash; 16 different sounds, one per pad. Picking the right half is most of the skill."],
		["start", "In 60 seconds", "Press <b>PLAY</b>. Press <b>WRITE</b>. Tap pads to place hits. That is a beat. Press WRITE again to stop writing."],
		["start", "If you get stuck", "Nothing here is permanent. <b>&#8630;</b> undoes, <b>&#8631;</b> puts it back, and UTIL can clear the pattern and start you over. Copy a beat from <i>recipes</i> below and change one thing at a time."],
		["start", "Keyboard (desktop)", "<kbd>Return</kbd> play &middot; <kbd>1-9,0</kbd> pads &middot; <kbd>5</kbd> sound &middot; <kbd>6</kbd> pattern &middot; <kbd>7</kbd> bpm &middot; <kbd>9</kbd> write"],

		["beats", "Pick a sound", "Press <b>SOUND</b>, then a pad. Lit LEDs show which slots have something in them; the screen names what you picked."],
		["beats", "Write a pattern", "Press <b>WRITE</b>, then tap pads 1-16 &mdash; each pad is one step of the bar. Tap a lit step to remove it. Press WRITE again to leave."],
		["beats", "Play it in instead", "Press <b>LIVE</b> and play the pads in time; what you play is recorded into the bar. It starts the sequencer for you if it is not already running."],
		["beats", "Chain patterns", "Hold <b>PATTERN</b> and tap pattern numbers, or use the <b>mix</b> tab where you can see the chain, reorder links and remove one without starting over."],
		["beats", "Tempo &amp; swing", "Press <b>BPM</b> and drag the two sliders. A click plays while you drag so you can hear the pace. Swing delays every other step &mdash; it is most of what makes a beat feel human."],
		["beats", "The three jobs", "A beat needs <b>drums</b> to keep time, <b>bass</b> to hold the bottom and <b>melody</b> to carry the tune. If a loop sounds thin, one of the three is missing. If it sounds muddy, two are fighting &mdash; write the bass on the same steps as the kick."],
		["beats", "Recipes", "<b>Boom-bap 90:</b> kick 1,7,11 &middot; snare 5,13 &middot; hats on the odd steps, swing 18%. <b>House 124:</b> kick 1,5,9,13 &middot; open hat 3,7,11,15 &middot; clap 5,13, swing 0. <b>Trap 140:</b> kick 1,11 &middot; snare on 9 alone &middot; hats everywhere."],
		["beats", "Accent &amp; ghost notes", "In WRITE, hold a step to latch it, then use slider 2 for its volume. Loud hits read as accents, very quiet ones as ghost notes &mdash; the difference between a beat that plods and one that moves."],
		["beats", "Micro-timing", "Hold a step and nudge it a few milliseconds early or late. A snare sitting slightly late is the classic behind-the-beat feel."],

		["sample", "Record a sound", "Open <b>library</b>, pick a source, press <b>record</b>. <i>microphone</i> works everywhere; <i>tab audio</i> is desktop Chrome only and captures whatever is playing in another tab."],
		["sample", "Load one in", "The library lists the built-in packs and anything you have recorded. Tap <b>slot...</b> on a row to put it in a slot. <b>import</b> loads a file from your device."],
		["sample", "Sequencing a chop", "In WRITE the pads are <b>steps</b>, not slices &mdash; every step you tap gets the slice that is currently selected, so tapping eight steps writes one note eight times. That is normal. To get different slices on different steps use <b>LIVE</b> and play them in time, or hold a step and drag slider 1 to set <i>note 1-16</i> for that step alone."],
		["sample", "How long to sample", "Aim for the slice, not the sample. A slice wants to be about a quarter to a half second. <b>chop x16</b> &rarr; sample <b>5-6s</b> (two bars at 85-95 BPM). <b>chop x8</b> &rarr; <b>2.5-3s</b>. Sampling 13s and chopping x16 gives you one-second slices that overlap and smear."],
		["sample", "Trim", "Press <b>TRIM</b>. Drag the handles, or drag anywhere on the waveform &mdash; it grabs the nearer one. Tapping a pad previews the trimmed sound live."],
		["sample", "Match the tempo", "The trim screen works out the BPM that makes your selection fill exactly one bar, and offers to set it. One tap, no arithmetic."],
		["sample", "Chop", "Cuts the trimmed part into pieces and spreads them across the pads &mdash; <b>16 is what the real hardware does</b>. Each piece lands on its own pad; nothing is duplicated. Chops never change pitch."],
		["sample", "Chop with feeling", "It cuts on transients where it can find them and falls back to equal slices. Tick <i>lay out + match tempo</i> and it also writes the pieces across the bar and sets the tempo to fit."],
		["sample", "Play a chop as notes", "<b>pitch</b> loads the trimmed part onto a melodic slot so the 16 pads play it at 16 pitches &mdash; what a piano phrase actually wants."],
		["sample", "It survives a reload", "Chopped and recorded audio is written to storage, so a beat still plays after an update. Projects are how you get it off the device entirely."],

		["perform", "The XY pad", "Three jobs, switched by the chips: <b>TONE</b> (muffled to bright), <b>SYNTH</b> (play a lead &mdash; left/right picks the note, up/down the brightness) and <b>SPACE</b> (echo and reverb)."],
		["perform", "Stack them", "<b>LOCK</b> keeps the current mode running after you let go, so you can lock a filter, switch to SPACE, and have both at once. An orange dot marks what is still on. Hold LOCK to clear everything."],
		["perform", "The 16 effects", "Hold <b>FX</b> and a pad, or use the <b>fx</b> tab. Most bend the sequencer rather than the sound: loop 16, loop 12, loop short, loop shorter, unison, unison low, octave up, octave down, stutter 4, stutter 3, scratch, scratch fast, 6/8 quantize, retrigger, reversed, no effect."],
		["perform", "Record the effects", "In the <b>fx</b> tab press <b>rec</b>, then hold an effect while playing &mdash; every step you hold it for is written down, so a two-bar reverse comes back as a two-bar reverse."],
		["perform", "The keyboard", "The <b>keys</b> tab is a real instrument: e.piano, pad, pluck, bass, organ, bells, lead, sub. The pads are laid out in a scale, so there is no wrong note to hit."],
		["perform", "In time", "Holds each note until the next sixteenth, so a late finger still lands with the drums. It changes <i>when</i> you play, never <i>what</i>."],
		["perform", "Record the keyboard", "<b>rec</b> in the keys tab writes what you play into the pattern. The keyboard has its own track, so it costs you none of the 16 slots."],
		["perform", "Drum kits", "<b>808</b>, <b>909</b> and <b>lo-fi</b>, built out of maths rather than files. They load onto a drum slot as real audio, so you can trim and chop them like any sample."],
		["perform", "Scale &amp; key", "UTIL, scale &amp; key. A scale is a chosen set of notes that sound good together, so the melodic pads cannot play a clashing note. Patterns store the pad number, so changing key transposes rather than breaks them."],

		["manage", "The screen", "Tap <b>song</b> in the top bar for a map of the bar: every part with something on it gets a row, filled where it hits. Along the top: tempo, scale, parts, hits, and how long a bar and a full chain last."],
		["manage", "Projects", "<b>PROJ</b> opens the browser. A project saves everything &mdash; patterns, chain, tempo, slots, and the keyboard and effects tracks. <b>+ new</b> starts genuinely empty."],
		["manage", "Folders &amp; files", "Tap a project to select it, then rename, move to a folder, copy, export or delete. <b>export</b> writes a real file to your downloads and <b>import</b> reads it back &mdash; that is how a beat moves between devices."],
		["manage", "Mute &amp; solo", "The <b>mix</b> tab. Tap a slot to cycle mute / solo / on. Slots with nothing on them in this pattern are dimmed, so you can see what you are actually muting."],
		["manage", "Undo &amp; redo", "Two arrows in the top bar &mdash; <b>&#8630;</b> back, <b>&#8631;</b> forward. They cover steps, chain edits, clears and the keyboard track, and the screen names what it just undid. On a keyboard: <kbd>cmd Z</kbd> and <kbd>cmd shift Z</kbd>. A fast run of edits collapses into one press."],
		["manage", "Metronome &amp; feel", "UTIL has a click track, haptics on touch, and motion recording, which captures slider moves into the pattern as you make them."],
		["manage", "LFO", "UTIL has an automatic filter sweep across everything &mdash; rate, depth and waveform."],
		["manage", "Install it", "<b>iPhone:</b> Share, then Add to Home Screen. <b>Android:</b> menu, then Install app. It runs full screen and works offline."],
		["manage", "The little guy", "Tap him on the screen and he climbs out and wanders the interface, using the real buttons as ledges. Press PLAY and he dances. Tap him again to send him home. He can never block a tap."]
	];

	/* The guide drawer.
	 *
	 * Content comes from guide.js so there is exactly one copy of it. Each
	 * section is a <details> accordion with a numbered badge, which is the
	 * only shape that works for a 24-section manual on a phone: everything
	 * is one thumb-scroll away collapsed, and opening one does not lose
	 * your place.
	 *
	 * The chips filter by group. Search ignores them and looks everywhere,
	 * because when you have a question you do not know which chip it is
	 * filed under. A search hit opens itself so you can read the answer
	 * without a second tap.
	 */
	function guideData() {
		return window.PO33Guide || { groups: [["all", "all"]], sections: [] };
	}

	function infoMarkup() {
		var G = guideData();
		var h = '<div class="drawerHead"><h2>Guide</h2>' +
			'<button class="drawerClose" data-close aria-label="close">&times;</button></div>' +
			'<div class="gLcd gLcdSlim">' +
				'<span class="gLcdTop">MANUAL</span>' +
				'<span class="gLcdBig">HOW TO PLAY ME!</span>' +
				'<span class="gLcdSub">' + G.sections.length + ' sections &middot; tap one to open</span>' +
				'<i class="gLcdDot"></i>' +
			'</div>' +
			'<input id="infoSearch" type="search" placeholder="search the guide" autocomplete="off">' +
			'<div id="infoNav">';
		G.groups.forEach(function (t, i) {
			h += '<button data-iv="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') + '>' + t[1] + '</button>';
		});
		h += '</div><div id="infoBody">';
		G.sections.forEach(function (e) {
			// .infoItem is what search filters on; data-view is what the chips filter on
			h += '<details class="gSec infoItem" data-view="' + e.g + '">' +
					'<summary><span class="gNum">' + e.n + '</span>' + e.t + '</summary>' +
					'<div class="gBody">' + e.b + '</div>' +
				'</details>';
		});
		h += '</div><div id="infoNone" hidden>nothing matches that</div>';
		return h;
	}

	var INFO_HTML = infoMarkup();

	function build() {
		// NB: #fabInfo lives in the markup now, so it can't be the "already built"
		// sentinel — the drawer is.
		if (document.getElementById("infoDrawer")) { return; }

		var scrim = document.createElement("div");
		scrim.id = "drawerScrim";

		var info = document.createElement("aside");
		info.id = "infoDrawer";
		info.innerHTML = INFO_HTML;

		// info / library now live in the unit's top row, straight from the markup
		var fabInfo = document.getElementById("fabInfo");
		var fabLib = document.getElementById("fabLib");
		document.body.append(scrim, info);

		if (fabInfo) { fabInfo.addEventListener("click", function () { toggle("info"); }); }
		// the library is already on screen on desktop; the link only drives
		// the drawer on a phone
		if (fabLib) { fabLib.addEventListener("click", function () { if (mq.matches) { toggle("lib"); } }); }
		scrim.addEventListener("click", close);
		info.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]")) { close(); }
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { close(); }
		});
		/* search across every entry, in all tabs at once — the fastest way to
		 * find one answer without knowing which tab it lives under */
		function applyGroup(info) {
			var nav = info.querySelector("#infoNav");
			var active = nav ? nav.querySelector("button.on") : null;
			var want = active ? active.getAttribute("data-iv") : "all";
			info.querySelectorAll(".infoItem").forEach(function (it) {
				it.hidden = !(want === "all" || it.getAttribute("data-view") === want);
			});
		}

		/* search across every section, ignoring the chips — the fastest way
		 * to find one answer without knowing which group it lives under. A
		 * hit opens itself: making you tap twice to read a result you already
		 * searched for is a waste of a tap. */
		info.addEventListener("input", function (e) {
			if (!e.target || e.target.id !== "infoSearch") { return; }
			var q = e.target.value.trim().toLowerCase();
			var nav = info.querySelector("#infoNav");
			var none = info.querySelector("#infoNone");
			var hits = 0;

			if (!q) {
				nav.hidden = false;
				none.hidden = true;
				info.querySelectorAll(".infoItem").forEach(function (it) { it.open = false; });
				applyGroup(info);
				return;
			}

			nav.hidden = true;
			info.querySelectorAll(".infoItem").forEach(function (it) {
				var match = it.textContent.toLowerCase().indexOf(q) !== -1;
				it.hidden = !match;
				it.open = match;
				if (match) { hits++; }
			});
			none.hidden = hits > 0;
		});

		// group chips
		info.addEventListener("click", function (e) {
			var t = e.target.closest("#infoNav button");
			if (!t) { return; }
			info.querySelectorAll("#infoNav button").forEach(function (b) {
				b.classList.toggle("on", b === t);
			});
			applyGroup(info);
			var body = info.querySelector("#infoBody");
			if (body) { body.scrollTop = 0; }
		});

		applyGroup(info);

		document.addEventListener("input", function (e) {
			if (!window.PO33 || !PO33.fx) { return; }
			var id = e.target && e.target.id;
			if (id === "lfoRate" || id === "lfoDepth") {
				PO33.fx.lfo({
					rate: (+document.getElementById("lfoRate").value) / 100,
					depth: (+document.getElementById("lfoDepth").value) / 100
				});
			}
		});
		document.addEventListener("change", function (e) {
			var id = e.target && e.target.id;
			if (id === "lfoWave" && window.PO33 && PO33.fx) {
				PO33.fx.lfo({ wave: e.target.value });
			}
			if ((id === "scaleSel" || id === "scaleKey") && window.PO33 && PO33.scale) {
				PO33.scale.set({
					scale: document.getElementById("scaleSel").value,
					key: +document.getElementById("scaleKey").value
				});
			}
		});
		// "‹ back" row inside the library (rendered by library.js, so delegate)
		document.addEventListener("click", function (e) {
			if (e.target.closest("#libBack")) { close(); }
			if (e.target.id === "clearLocksBtn" && window.PO33 && PO33.locks) { PO33.locks.clearAll(); }
			if (e.target.id === "metroBtn" && window.PO33 && PO33.metro) { PO33.metro.toggle(); }
			if (e.target.id === "liveRecBtn" && window.PO33 && PO33.liveRec) { close(); PO33.liveRec(); }
			if (e.target.id === "undoDrawerBtn" && window.PO33 && PO33.undo) { PO33.undo.undo(); }
			if (e.target.id === "motionBtn" && window.PO33 && PO33.motion) {
				var on = PO33.motion.toggle();
				e.target.textContent = on ? "disarm motion rec" : "arm motion rec";
			}
			if (e.target.id === "lfoBtn" && window.PO33 && PO33.fx) {
				var st = PO33.fx.lfoState();
				var now = PO33.fx.lfo({ on: !st.on,
					rate: (+document.getElementById("lfoRate").value) / 100,
					depth: (+document.getElementById("lfoDepth").value) / 100,
					wave: document.getElementById("lfoWave").value });
				e.target.textContent = now.on ? "LFO on" : "LFO off";
			}
			if (e.target.id === "unmuteBtn" && window.PO33 && PO33.channels) { PO33.channels.clearAll(); }
			if (e.target.id === "hapticBtn" && window.PO33 && PO33.haptics) { PO33.haptics.toggle(); }
			if (e.target.id === "scaleOctUp" && window.PO33 && PO33.scale) { PO33.scale.octave(1); }
			if (e.target.id === "scaleOctDn" && window.PO33 && PO33.scale) { PO33.scale.octave(-1); }
			if (e.target.id === "clearPtnBtn" && window.PO33) { PO33.clearPattern(); }
			if (e.target.id === "clearAllBtn" && window.PO33) { PO33.clearAll(e.target); }
			if (e.target.id === "projOpenBtn" && window.PO33 && PO33.projects) { close(); PO33.projects.show(); }
		});
		// NOTE: the library drawer never auto-closes — you close it with the ×,
		// the scrim, the back row, or the LIBRARY button.
	}

	/* ---- scale the whole unit to fit the viewport, no scrolling, any size ---- */
	var fitPending, fitting = false;
	function fitUnit() {
		var board = document.querySelector(".circuitBoard");
		var art = document.querySelector("article");
		if (!board || !art || fitting) { return; }
		if (!mq.matches) { board.style.transform = ""; board.style.width = ""; return; }
		// The mobile layout is FLUID now: CSS sizes the unit to the viewport width
		// and the LCD absorbs the leftover height. The old transform: scale()
		// shrank the width whenever height was the binding constraint, which is
		// exactly why it never filled the screen. Just clear any stale inline
		// transform/width an older build may have left pinned on the board.
		fitting = true;
		board.style.transform = "";
		board.style.width = "";
		setTimeout(function () { fitting = false; }, 0);
	}
	function scheduleFit() {
		clearTimeout(fitPending);
		fitPending = setTimeout(fitUnit, 60);
	}
	function watchFit() {
		fitUnit();
		[120, 400, 900, 1600].forEach(function (t) { setTimeout(fitUnit, t); });
		window.addEventListener("resize", scheduleFit);
		window.addEventListener("orientationchange", function () { setTimeout(fitUnit, 200); });
		if (window.ResizeObserver) {
			var board = document.querySelector(".circuitBoard");
			var art = document.querySelector("article");
			var ro = new ResizeObserver(scheduleFit);
			if (board) { ro.observe(board); }
			if (art) { ro.observe(art); }
		}
	}

	/* ------------------------------------------------------------------
	 * On a phone the library doesn't slide in from the side any more — it
	 * takes over the screen itself, the way a mode change does on the real
	 * unit. The <aside> is MOVED into a slot inside .lcd rather than being
	 * duplicated, so library.js keeps addressing the same nodes by id.
	 * ------------------------------------------------------------------ */
	var libHome = null;

	function dockLibrary(on) {
		var lib = document.getElementById("library");
		var slot = document.getElementById("lcdLibSlot");
		if (!lib || !slot) { return; }
		if (on) {
			if (!libHome) { libHome = { parent: lib.parentNode, next: lib.nextSibling }; }
			if (lib.parentNode !== slot) { slot.appendChild(lib); }
			document.body.classList.add("lib-lcd");
		} else {
			if (libHome && lib.parentNode === slot) {
				libHome.parent.insertBefore(lib, libHome.next);
			}
			document.body.classList.remove("lib-lcd");
		}
	}

	function toggle(which) {
		var b = document.body;
		var open = which === "info" ? "drawer-info" : "drawer-lib";
		var other = which === "info" ? "drawer-lib" : "drawer-info";
		b.classList.remove(other);
		if (other === "drawer-lib") { dockLibrary(false); }
		var isOpen = b.classList.toggle(open);
		b.classList.toggle("drawer-open", isOpen);
		if (which === "lib") { dockLibrary(isOpen && mq.matches); }
	}

	function close() {
		dockLibrary(false);
		document.body.classList.remove("drawer-info", "drawer-lib", "drawer-open");
	}

	var watching = false;
	function sync() {
		// The guide drawer is built on EVERY form factor now. It used to be
		// phone-only, because desktop had its own copy of the manual as a
		// sidebar in index.html — that copy is gone, so gating this on the
		// media query would leave desktop with an info button that does
		// nothing. Only the viewport-fitting work below is phone-only.
		build();
		if (mq.matches) {
			if (!watching) { watching = true; watchFit(); }
		} else {
			close();
			fitUnit(); // clears the transform on desktop
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", sync);
	} else { sync(); }
	(mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(sync);
})();
