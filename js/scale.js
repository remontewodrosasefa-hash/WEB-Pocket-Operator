/* scale.js — musical key / scale / octave for the melodic slots.
 *
 * The engine plays pad N via melodicArr[ch].triggerAttack(<noteName>), where the
 * Tone.Sampler pitch-shifts from its C#4 root. Historically the note for each pad
 * came from a fixed 16-entry `noteArray`. This module supplies window.melodicNote(pad)
 * which returns either that legacy layout ("16-pad classic", the default) or a
 * note built from a key + scale + octave, so 16 pads span 2-4 musical octaves.
 *
 * Patterns still store notePitch as a 0-15 index, so nothing about saved data
 * changes — only which pitch each index sounds, exactly like transposing a synth.
 *
 * Exposes window.PO33.scale
 */
(function () {
	"use strict";

	var SCALES = {
		"classic":   null,                       // use the legacy noteArray
		"chromatic": [0,1,2,3,4,5,6,7,8,9,10,11],
		"major":     [0,2,4,5,7,9,11],
		"minor":     [0,2,3,5,7,8,10],
		"dorian":    [0,2,3,5,7,9,10],
		"penta maj": [0,2,4,7,9],
		"penta min": [0,3,5,7,10],
		"blues":     [0,3,5,6,7,10]
	};
	var KEYS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
	var NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

	var state = { scale: "classic", key: 0, octave: 0 };

	function load() {
		try {
			var v = JSON.parse(localStorage.getItem("po33.scale") || "null");
			if (v && SCALES.hasOwnProperty(v.scale)) { state = v; }
		} catch (e) {}
	}
	function save() {
		try { localStorage.setItem("po33.scale", JSON.stringify(state)); } catch (e) {}
	}
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	function midiToName(m) {
		m = Math.max(12, Math.min(108, Math.round(m)));
		return NAMES[m % 12] + (Math.floor(m / 12) - 1);
	}

	// pad 0-15 -> note name
	function note(pad) {
		var sc = SCALES[state.scale];
		if (!sc) { return (window.noteArray && window.noteArray[pad]) || "C#4"; }
		var root = 60 + state.key + state.octave * 12;   // pad 0 = the root
		var deg = pad % sc.length;
		var oct = Math.floor(pad / sc.length);
		return midiToName(root + oct * 12 + sc[deg]);
	}

	function label() {
		if (state.scale === "classic") { return "16-pad classic"; }
		return KEYS[state.key] + " " + state.scale +
			(state.octave ? (state.octave > 0 ? " +" + state.octave : " " + state.octave) : "");
	}

	function set(patch, quiet) {
		if (patch.scale != null && SCALES.hasOwnProperty(patch.scale)) { state.scale = patch.scale; }
		if (patch.key != null) { state.key = ((patch.key % 12) + 12) % 12; }
		if (patch.octave != null) { state.octave = Math.max(-3, Math.min(3, patch.octave)); }
		save();
		if (!quiet) { flash("scale: " + label(), "tip"); }
		syncUi();
		return label();
	}
	function nudgeOctave(d) { return set({ octave: state.octave + d }); }

	function syncUi() {
		var s = document.getElementById("scaleSel"); if (s) { s.value = state.scale; }
		var k = document.getElementById("scaleKey"); if (k) { k.value = String(state.key); }
		var o = document.getElementById("scaleOct"); if (o) { o.textContent = "oct " + (state.octave >= 0 ? "+" : "") + state.octave; }
		var kw = document.getElementById("scaleKeyWrap");
		if (kw) { kw.style.opacity = state.scale === "classic" ? "0.35" : "1"; }
	}

	window.melodicNote = note;
	window.PO33 = window.PO33 || {};
	window.PO33.scale = {
		note: note,
		set: set,
		octave: nudgeOctave,
		enabled: function () { return state.scale !== "classic"; },
		label: label,
		scales: function () { return Object.keys(SCALES); },
		keys: KEYS
	};

	// the scale/key selects can live in the info drawer or the UTIL panel —
	// listen globally so either works
	function wireSelects() {
		document.addEventListener("change", function (e) {
			var id = e.target && e.target.id;
			if (id !== "scaleSel" && id !== "scaleKey") { return; }
			var sel = document.getElementById("scaleSel");
			var key = document.getElementById("scaleKey");
			set({ scale: sel ? sel.value : state.scale, key: key ? +key.value : state.key });
		});
	}

	load();
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () { syncUi(); wireSelects(); });
	} else { syncUi(); wireSelects(); }
})();
