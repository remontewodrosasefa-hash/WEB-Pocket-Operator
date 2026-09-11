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

	/* ---------- transient detection ----------
	 * Equal division is fine for a metronomic loop but cuts a real phrase in
	 * the wrong places. This walks the energy envelope and cuts where the
	 * sound actually restarts, falling back to equal slices if it can't find
	 * enough onsets.
	 */
	function findOnsets(data, sampleRate, n, from, to) {
		var win = Math.max(64, Math.floor(sampleRate * 0.01));   // ~10ms
		var start = Math.floor(data.length * from);
		var end = Math.floor(data.length * to);
		var env = [], i, j;
		for (i = start; i < end; i += win) {
			var sum = 0, m = Math.min(win, end - i);
			for (j = 0; j < m; j++) { var v = data[i + j]; sum += v * v; }
			env.push(Math.sqrt(sum / Math.max(1, m)));
		}
		if (env.length < n * 2) { return null; }

		// rising energy against a short moving average = an onset
		var cand = [], avgN = 6;
		for (i = 1; i < env.length; i++) {
			var lo = Math.max(0, i - avgN), avg = 0;
			for (j = lo; j < i; j++) { avg += env[j]; }
			avg /= Math.max(1, i - lo);
			var rise = env[i] - avg;
			if (env[i] > 0.02 && rise > avg * 0.6) { cand.push({ i: i, w: rise }); }
		}
		if (cand.length < 2) { return null; }

		// strongest first, but keep them at least ~60ms apart
		cand.sort(function (a, b) { return b.w - a.w; });
		var minGap = Math.ceil(0.06 * sampleRate / win);
		var picked = [];
		for (i = 0; i < cand.length && picked.length < n; i++) {
			var ok = true;
			for (j = 0; j < picked.length; j++) {
				if (Math.abs(cand[i].i - picked[j]) < minGap) { ok = false; break; }
			}
			if (ok) { picked.push(cand[i].i); }
		}
		if (picked.length < Math.min(3, n)) { return null; }
		picked.sort(function (a, b) { return a - b; });
		return picked.map(function (k) { return start + k * win; });
	}

	// region = {from, to} as 0..1 fractions of the buffer (the trim handles).
	// Only that slice of audio gets chopped.
	var lastCutMode = "equal";
	function makeSlices(buf, n, region, opts_smart) {
		var ctx = rawCtx();
		if (!ctx || !buf) { return []; }
		region = region || { from: 0, to: 1 };
		var f = Math.max(0, Math.min(1, region.from));
		var t = Math.max(f + 0.01, Math.min(1, region.to));
		var regStart = Math.floor(buf.length * f);
		var regLen = Math.floor(buf.length * (t - f));
		var per = Math.floor(regLen / n);
		if (per < 64) { return []; }
		var chans = buf.numberOfChannels;
		var out = [];

		// cut points: transients if we can find them, otherwise equal division
		var cuts = (opts_smart === false) ? null
			: findOnsets(buf.getChannelData(0), buf.sampleRate, n, f, t);
		lastCutMode = cuts ? "transient" : "equal";
		if (!cuts) {
			cuts = [];
			for (var q = 0; q < n; q++) { cuts.push(regStart + q * per); }
		}

		for (var k = 0; k < cuts.length; k++) {
			var start = cuts[k];
			var len = (k === cuts.length - 1) ? (regStart + regLen - start) : (cuts[k + 1] - start);
			if (len < 64) { continue; }
			var sub = ctx.createBuffer(chans, len, buf.sampleRate);
			for (var c = 0; c < chans; c++) {
				var src = buf.getChannelData(c);
				var dst = sub.getChannelData(c);
				var lim = Math.min(len, src.length - start);
				for (var i = 0; i < lim; i++) { dst[i] = src[start + i]; }
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

		var slices = makeSlices(buf, n, opts.region, opts.smart);
		if (!slices.length) { flash("sample too short to slice", "warn"); return false; }

		// N chops -> pads 1..N, each one a DISTINCT piece. Pads beyond N are left
		// untouched (not silenced, not repeated) — if this slot already had a
		// kit loaded, those pads keep whatever was already there; if the slot
		// is brand new, ensureDrumSlot already left them silent.
		//
		// This used to repeat pieces to fill all 16 pads (8 chops -> every pad
		// paired up with its neighbour playing the identical piece), which is
		// exactly the "certain buttons played the same chopped bit" bug: two
		// different-looking pads making the same sound reads as broken, not
		// as a feature.
		try {
			var m = slices.length;
			for (var pad = 0; pad < m && pad < 16; pad++) {
				window.drumArr[di].add(window.noteArray[pad], slices[pad]);
				// drum pads are one-shots: force playbackRate 1 so a chop can
				// never come out transposed, whatever the pad's note implies
				try { window.drumArr[di].get(window.noteArray[pad]).playbackRate = 1; } catch (e2) {}
			}
			// chopped audio only exists in memory until this writes it to
			// IndexedDB — without it the pattern survives a reload but the
			// sound it points at doesn't
			try { window.PO33.chops.saveSlot(slot, slices.slice(0, 16)); } catch (e3) {}
		} catch (e) { flash("slice load failed", "warn"); return false; }

		// slices are already cut - clear any inherited trim on this channel
		try {
			var cs = window.channelSettingsArr[slot - 1];
			cs.fxTrim = 0;
			cs.fxLength = 1000;
			cs.notePitch = 0;
		} catch (e) {}

		if (opts.matchTempo) { matchTempo(buf.duration); }
		if (opts.layout) { layoutSteps(slot - 1, Math.min(16, slices.length)); }

		var padTxt = m < 16 ? ("pads 1-" + m + " (" + (m + 1) + "-16 unchanged)") : "all 16 pads";
		flash("sliced into " + n + " -> SOUND " + slot + ", " + padTxt, "tip");
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

	// Write the N distinct slices back across the bar, spread as evenly as
	// their count allows, one hit per piece — NOT one hit per step. The old
	// version filled every one of the 16 steps regardless of N, which for an
	// 8-way chop meant every consecutive PAIR of steps played the identical
	// piece back to back — audibly the same bug as the pad-doubling above,
	// just happening in time instead of across the grid.
	function layoutSteps(ch, n) {
		var pat = g("currentPattern", 0);
		n = Math.max(1, Math.min(16, n || 16));
		try {
			var cs = window.channelSettingsArr[ch];
			var used = [];
			for (var step = 0; step < 16; step++) { window.newChannelArr[ch][pat][step].noteOn = 0; }
			for (var i = 0; i < n; i++) {
				var step = Math.min(15, Math.round(i * 16 / n));
				// guard against two pieces rounding onto the same step
				while (used.indexOf(step) !== -1 && step < 15) { step++; }
				used.push(step);
				var beat = window.newChannelArr[ch][pat][step];
				beat.noteOn = 1;
				beat.notePitch = i;              // this step plays ITS OWN piece, never a repeat
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
			try { window.PO33.session.save(); } catch (e2) {}
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) {}
	}

	/* ---------- pitch mode ----------
	 * A piano phrase doesn't want chopping into 16 time-slices — it wants to be
	 * ONE sample that the 16 pads play at 16 pitches. That's what a melodic slot
	 * already does, so this just crops the trimmed region into a fresh buffer and
	 * loads it onto a melodic slot (1-8).
	 */
	function toPitched(slot, region) {
		var buf = selectedBuffer();
		if (!buf) { flash("nothing to load", "warn"); return false; }
		slot = slot || 1;
		if (slot > 8) { flash("pitch mode needs a melodic slot (1-8)", "warn"); return false; }
		region = region || { from: 0, to: 1 };
		var ctx = rawCtx();
		var from = Math.max(0, Math.min(1, region.from));
		var to = Math.max(from + 0.01, Math.min(1, region.to));
		var start = Math.floor(buf.length * from);
		var len = Math.floor(buf.length * (to - from));
		if (len < 128) { flash("selection too short", "warn"); return false; }

		var out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
		for (var c = 0; c < buf.numberOfChannels; c++) {
			var src = buf.getChannelData(c), dst = out.getChannelData(c);
			var lim = Math.min(len, src.length - start);
			for (var i = 0; i < lim; i++) { dst[i] = src[start + i]; }
			deClick(dst, buf.sampleRate);
		}

		var url = URL.createObjectURL(encodeWav(out));
		var secs = Math.round(out.duration * 100) / 100;
		var id = "recordings/pitch-" + String(Date.now()).slice(-4);
		if (window.PO33Lib) {
			PO33Lib.addUserSample(id.split("/")[1], url, secs);
			PO33Lib.assignUrl(slot, url, id, secs);
		}
		try {
			var cs = window.channelSettingsArr[slot - 1];
			cs.fxTrim = 0; cs.fxLength = 1000;
		} catch (e) {}
		flash("SOUND " + slot + " · pads now play it at 16 pitches", "tip");
		return true;
	}

	// minimal WAV writer so the cropped buffer can go through the normal
	// url-based slot loading path
	function encodeWav(b) {
		var nc = Math.min(2, b.numberOfChannels), len = b.length, rate = b.sampleRate;
		var dv = new DataView(new ArrayBuffer(44 + len * nc * 2)), p = 0;
		function str(x) { for (var i = 0; i < x.length; i++) { dv.setUint8(p++, x.charCodeAt(i)); } }
		function u32(v) { dv.setUint32(p, v, true); p += 4; }
		function u16(v) { dv.setUint16(p, v, true); p += 2; }
		str("RIFF"); u32(36 + len * nc * 2); str("WAVE");
		str("fmt "); u32(16); u16(1); u16(nc); u32(rate);
		u32(rate * nc * 2); u16(nc * 2); u16(16);
		str("data"); u32(len * nc * 2);
		var ch = [];
		for (var c = 0; c < nc; c++) { ch.push(b.getChannelData(c)); }
		for (var i = 0; i < len; i++) {
			for (var c2 = 0; c2 < nc; c2++) {
				var v = Math.max(-1, Math.min(1, ch[c2][i]));
				dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2;
			}
		}
		return new Blob([dv], { type: "audio/wav" });
	}

	/* ---------- convenience entry points ---------- */

	// slice whatever sound is selected; if it's melodic, drop the chops on slot 16
	// Where a chop can land: only drum slots (9-16) have 16 separate pad players.
	// A melodic slot is a single Sampler, so its chops have to go somewhere else.
	function chopTarget() {
		var sel = g("selectedChannel", 0) + 1;
		return sel >= 9 ? sel : 16;
	}

	function sliceCurrent(n, opts) {
		opts = opts || {};
		var sel = g("selectedChannel", 0);
		var buf = selectedBuffer();
		// respect the trim handles unless the caller passed its own region
		if (!opts.region) {
			try {
				var cs = window.channelSettingsArr[sel];
				var from = (cs.fxTrim || 0) / 1000;
				var len = (cs.fxLength == null ? 1000 : cs.fxLength) / 1000;
				opts.region = { from: from, to: Math.min(1, from + len) };
			} catch (e) {}
		}
		return sliceToSlot(buf, chopTarget(), n, opts);
	}

	window.PO33 = window.PO33 || {};
	window.PO33.slice = {
		ensureSlot: ensureDrumSlot,
		toSlot: sliceToSlot,
		current: sliceCurrent,
		target: chopTarget,
		toPitched: toPitched,
		selectedBuffer: selectedBuffer,
		makeSlices: makeSlices,
		cutMode: function () { return lastCutMode; }
	};
})();
