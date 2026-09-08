/* slice.js — auto-slice.
 * Chops a sample (a recording, or any loaded sound) into N equal slices and
 * lays them across the 16 pads of a drum slot, so each pad plays one chunk.
 * Optionally writes the slices back out across the 16 steps and matches the
 * tempo to the loop length — the PO-33's "record a bar, chop it" move.
 *
 * Exposes window.PO33.slice
 */
(function () {
	"use strict";

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }
	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }

	function rawCtx() {
		try { return Tone.context._context || Tone.context; } catch (e) { return null; }
	}

	/* ---------- buffer helpers ---------- */

	// grab the AudioBuffer behind the currently selected sound
	function selectedBuffer() {
		var ch = g("selectedChannel", 0);
		try {
			if (ch < 8) {
				var b = window.melodicArr[ch].buffers.get(61);
				return (b && (b.get ? b.get() : b._buffer)) || null;
			}
			var pitch = 0;
			try { pitch = window.channelSettingsArr[ch].notePitch % 16; } catch (e) {}
			var p = window.drumArr[ch - 8].get(window.noteArray[pitch]);
			var tb = p && p.buffer;
			return (tb && (tb.get ? tb.get() : tb._buffer)) || null;
		} catch (e) { return null; }
	}

	// ~2ms fade in/out so slice boundaries don't click
	function deClick(data, sampleRate) {
		var n = Math.min(Math.floor(sampleRate * 0.002), Math.floor(data.length / 4));
		if (n < 2) { return; }
		for (var i = 0; i < n; i++) {
			var f = i / n;
			data[i] *= f;
			data[data.length - 1 - i] *= f;
		}
	}

	function makeSlices(buf, n) {
		var ctx = rawCtx();
		if (!ctx || !buf) { return []; }
		var per = Math.floor(buf.length / n);
		if (per < 64) { return []; }
		var chans = buf.numberOfChannels;
		var out = [];
		for (var k = 0; k < n; k++) {
			var start = k * per;
			var len = (k === n - 1) ? (buf.length - start) : per;
			var sub = ctx.createBuffer(chans, len, buf.sampleRate);
			for (var c = 0; c < chans; c++) {
				var src = buf.getChannelData(c);
				var dst = sub.getChannelData(c);
				for (var i = 0; i < len; i++) { dst[i] = src[start + i]; }
				deClick(dst, buf.sampleRate);
			}
			out.push(sub);
		}
		return out;
	}

	/* ---------- load slices onto a drum slot ---------- */

	function ensureDrumSlot(di) {
		if (window.drumArr[di]) { return true; }
		try {
			if (typeof window.drumFilterArr[di] === "undefined") {
				window.drumFilterArr[di] = new Tone.Filter(20, "highpass");
				window.drumFilterArr[di].chain(window.meter, Tone.Master);
			}
			var silent = rawCtx().createBuffer(1, 128, rawCtx().sampleRate);
			var map = {};
			for (var k = 0; k < 16; k++) { map[window.noteArray[k]] = silent; }
			window.drumArr[di] = new Tone.Players(map);
			window.drumArr[di].connect(window.drumFilterArr[di]);
			return true;
		} catch (e) { return false; }
	}

	/**
	 * @param {AudioBuffer} buf     source audio
	 * @param {number} slot         1-16 target (drum slots 9-16 only)
	 * @param {number} n            slice count (4 / 8 / 16)
	 * @param {object} opts         { layout:bool, matchTempo:bool }
	 */
	function sliceToSlot(buf, slot, n, opts) {
		opts = opts || {};
		n = n || 16;
		if (!buf) { flash("nothing to slice", "warn"); return false; }
		if (slot < 9) { flash("slicing needs a drum slot (9-16)", "warn"); return false; }

		var di = slot - 9;
		if (!ensureDrumSlot(di)) { flash("could not prepare slot " + slot, "warn"); return false; }

		var slices = makeSlices(buf, n);
		if (!slices.length) { flash("sample too short to slice", "warn"); return false; }

		// spread N slices over the 16 pads (16 -> 1:1, 8 -> each twice, 4 -> each 4x)
		try {
			for (var pad = 0; pad < 16; pad++) {
				var s = slices[Math.floor(pad * n / 16)] || slices[slices.length - 1];
				window.drumArr[di].add(window.noteArray[pad], s);
			}
		} catch (e) { flash("slice load failed", "warn"); return false; }

		// slices are already cut - clear any inherited trim on this channel
		try {
			var cs = window.channelSettingsArr[slot - 1];
			cs.fxTrim = 0;
			cs.fxLength = 1000;
			cs.notePitch = 0;
		} catch (e) {}

		if (opts.matchTempo) { matchTempo(buf.duration); }
		if (opts.layout) { layoutSteps(slot - 1, n); }

		flash("sliced into " + n + " -> SOUND " + slot + " pads", "tip");
		if (window.PO33Lib && PO33Lib.toast) { PO33Lib.toast("sliced x" + n + " onto SOUND " + slot); }
		return true;
	}

	// one bar of 4/4 = the whole sample -> bpm
	function matchTempo(seconds) {
		if (!seconds || seconds < 0.2) { return; }
		var bpm = Math.round(240 / seconds);
		while (bpm > 200) { bpm = Math.round(bpm / 2); }
		while (bpm < 50) { bpm = Math.round(bpm * 2); }
		try {
			window.tempo = bpm;
			Tone.Transport.bpm.value = bpm;
		} catch (e) {}
	}

	// write the slices back out in order across the 16 steps
	function layoutSteps(ch, n) {
		var pat = g("currentPattern", 0);
		try {
			var cs = window.channelSettingsArr[ch];
			for (var step = 0; step < 16; step++) {
				var beat = window.newChannelArr[ch][pat][step];
				beat.noteOn = 1;
				beat.notePitch = step;                 // pad N holds slice N
				beat.fxPitch = cs.fxPitch;
				beat.fxVolume = cs.fxVolume;
				beat.fxTrim = 0;
				beat.fxLength = 1000;
				beat.fxFilter = cs.fxFilter;
				beat.fxFilterType = cs.fxFilterType;
				beat.fxFilterFreq = cs.fxFilterFreq;
				beat.fxResonance = cs.fxResonance;
				beat.fxFilterRes = cs.fxFilterRes;
			}
			localStorage.setItem("po33_settings", JSON.stringify(window.newChannelArr, null, "  "));
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) {}
	}

	/* ---------- convenience entry points ---------- */

	// slice whatever sound is selected; if it's melodic, drop the chops on slot 16
	function sliceCurrent(n, opts) {
		var sel = g("selectedChannel", 0) + 1;
		var target = sel >= 9 ? sel : 16;
		var buf = selectedBuffer();
		if (sel < 9) { flash("melodic slot - chops go to SOUND 16", "info"); }
		return sliceToSlot(buf, target, n, opts);
	}

	window.PO33 = window.PO33 || {};
	window.PO33.slice = {
		toSlot: sliceToSlot,
		current: sliceCurrent,
		selectedBuffer: selectedBuffer,
		makeSlices: makeSlices
	};
})();
