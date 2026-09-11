/* util.js — the UTIL panel.
 *
 * Everything that used to be buried in the info drawer now lives on a proper
 * screen you reach from the UTIL button: scale & key, LFO, metronome, motion
 * rec, haptics, undo and the clear actions. The info drawer keeps the
 * explanations; this holds the actual controls.
 *
 * Exposes window.PO33.util
 */
(function () {
	"use strict";

	var view, listEl;

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	var HTML =
		'<div class="uvHead"><span>UTILITIES</span>' +
			'<button type="button" data-uv="close">&times;</button></div>' +
		'<div id="uvBody">' +

			'<div class="uvSec"><h4>skin <i>(how the device looks)</i></h4>' +
				'<div class="uvRow" id="uvSkins"></div></div>' +

			'<div class="uvSec"><h4>scale &amp; key <i>(melodic slots 1-8)</i></h4>' +
				'<div class="uvRow">' +
					'<select id="scaleSel">' +
						'<option value="classic">16-pad classic</option>' +
						'<option value="major">major</option><option value="minor">minor</option>' +
						'<option value="dorian">dorian</option><option value="penta maj">penta maj</option>' +
						'<option value="penta min">penta min</option><option value="blues">blues</option>' +
						'<option value="chromatic">chromatic</option>' +
					'</select>' +
					'<span id="scaleKeyWrap">key <select id="scaleKey">' +
						'<option value="0">C</option><option value="1">C#</option><option value="2">D</option>' +
						'<option value="3">D#</option><option value="4">E</option><option value="5">F</option>' +
						'<option value="6">F#</option><option value="7">G</option><option value="8">G#</option>' +
						'<option value="9">A</option><option value="10">A#</option><option value="11">B</option>' +
					'</select></span>' +
					'<button type="button" data-uv="octdn">&minus;</button>' +
					'<span id="scaleOct">oct +0</span>' +
					'<button type="button" data-uv="octup">+</button>' +
				'</div></div>' +

			'<div class="uvSec"><h4>LFO <i>(auto filter sweep)</i></h4>' +
				'<div class="uvRow">' +
					'<button id="lfoBtn" type="button">LFO off</button>' +
					'<label>rate <input type="range" id="lfoRate" min="1" max="1200" value="400"></label>' +
					'<label>depth <input type="range" id="lfoDepth" min="0" max="100" value="60"></label>' +
					'<select id="lfoWave">' +
						'<option value="sine">sine</option><option value="triangle">triangle</option>' +
						'<option value="square">square</option><option value="sawtooth">saw</option>' +
					'</select>' +
				'</div></div>' +

			'<div class="uvSec"><h4>recording</h4>' +
				'<div class="uvRow">' +
					'<button type="button" data-uv="live">&#9679; arm live rec</button>' +
					'<button type="button" data-uv="motion">arm motion rec</button>' +
				'</div></div>' +

			'<div class="uvSec"><h4>feel</h4>' +
				'<div class="uvRow">' +
					'<button type="button" data-uv="metro">metronome</button>' +
					'<button type="button" data-uv="haptic">haptics</button>' +
					'<button type="button" data-uv="unmute">un-mute all</button>' +
				'</div></div>' +

			'<div class="uvSec"><h4>history &amp; projects</h4>' +
				'<div class="uvRow">' +
					'<button type="button" data-uv="undo">&#8630; undo</button>' +
					'<button type="button" data-uv="redo">&#8631; redo</button>' +
					'<button type="button" data-uv="proj">projects</button>' +
				'</div></div>' +

			'<div class="uvSec danger"><h4>clear</h4>' +
				'<div class="uvRow">' +
					'<button type="button" data-uv="clrPat">this pattern</button>' +
					'<button type="button" data-uv="clrLock">locks</button>' +
					'<button type="button" data-uv="clrAll" id="uvClrAll">everything (x3)</button>' +
				'</div></div>' +

		'</div>';

	function isOpen() { return document.body.classList.contains("utilOpen"); }
	function show() {
		build();
		if (!view) { return; }
		if (window.PO33.projects) { PO33.projects.hide(); }
		if (window.PO33.trim) { PO33.trim.close(); }
		document.body.classList.add("utilOpen");
		view.hidden = false;
		renderSkins();
		if (window.PO33.scale) { syncScale(); }
	}
	function hide() { document.body.classList.remove("utilOpen"); if (view) { view.hidden = true; } }
	function toggle() { if (isOpen()) { hide(); } else { show(); } }

	function renderSkins() {
		var row = document.getElementById("uvSkins");
		if (!row || !window.PO33.skin) { return; }
		var cur = PO33.skin.current();
		row.innerHTML = PO33.skin.list().map(function (s) {
			return '<button type="button" data-uv="skin" data-v="' + s.id + '"' +
				(s.id === cur ? ' class="on"' : "") + ' title="' + s.blurb + '">' +
				s.name + "</button>";
		}).join("");
	}

	function syncScale() {
		// scale.js keeps its own selects in sync; nudge it so the labels are right
		try { PO33.scale.set({}, true); } catch (e) {}
	}

	function act(a, target) {
		var P = window.PO33 || {};
		switch (a) {
			case "close":  hide(); break;
			case "skin":   if (P.skin) { P.skin.set(target.getAttribute("data-v")); renderSkins(); } break;
			case "octup":  if (P.scale) { P.scale.octave(1); } break;
			case "octdn":  if (P.scale) { P.scale.octave(-1); } break;
			case "live":   if (P.liveRec) { hide(); P.liveRec(); } break;
			case "motion": if (P.motion) { target.textContent = P.motion.toggle() ? "disarm motion rec" : "arm motion rec"; } break;
			case "metro":  if (P.metro) { P.metro.toggle(); } break;
			case "haptic": if (P.haptics) { P.haptics.toggle(); } break;
			case "unmute": if (P.channels) { P.channels.clearAll(); } break;
			case "undo":   if (P.undo) { P.undo.undo(); } break;
			case "redo":   if (P.undo) { P.undo.redo(); } break;
			case "proj":   hide(); if (P.projects) { P.projects.show(); } break;
			case "clrPat": if (P.clearPattern) { P.clearPattern(); } break;
			case "clrLock":if (P.locks) { P.locks.clearAll(); } break;
			case "clrAll": if (P.clearAll) { P.clearAll(target); } break;
		}
	}

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || view) { return !!hud; }
		view = document.createElement("div");
		view.id = "utilView";
		view.hidden = true;
		view.innerHTML = HTML;
		hud.appendChild(view);
		view.addEventListener("click", function (e) {
			var a = e.target.getAttribute("data-uv");
			if (a) { e.stopPropagation(); act(a, e.target); }
		});
		// the LFO + scale selects are wired by their own modules via delegation
		return true;
	}

	window.PO33 = window.PO33 || {};
	window.PO33.util = { show: show, hide: hide, toggle: toggle };

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (build()) {
				var b = document.getElementById("btnUtil");
				if (b) { b.addEventListener("click", toggle); }
				var l = document.getElementById("btnLive");
				if (l) {
					l.addEventListener("click", function () {
						if (window.PO33.liveRec) { window.PO33.liveRec(); }
					});
				}
				clearInterval(iv);
			} else if (++tries > 100) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
