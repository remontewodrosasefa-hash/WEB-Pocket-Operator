/* listen.js — measuring the actual audio in a slot.
 *
 * This is how the assistant "hears". Not by streaming a WAV to a language
 * model and asking it to guess, but by measuring the AudioBuffer that is
 * already sitting in memory and handing over the numbers.
 *
 * The difference matters. Asked to listen to four seconds of a drum break,
 * a model will tell you it sounds like a warm vintage loop. It will not
 * tell you the first transient is 41ms in, the loop is 5.31s long, and that
 * makes it two bars at 90.4 BPM. Those three facts are what actually change
 * what you should press, they are arithmetic, and the browser can do them
 * exactly, instantly, offline and for nothing.
 *
 * So: this file measures, ai.js sends the measurements, the model reasons
 * about them. (ai.js can additionally send the raw audio to a provider that
 * accepts it, for the subjective half — "does this sound warm or thin" —
 * but never for the numbers.)
 *
 * Exposes window.PO33.listen
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var HOP = 512;          // ~11.6ms at 44.1k — fine enough for drum onsets
	var WIN = 1024;

	/* ---------- getting at the buffer for a slot ---------- */

	function bufferForSlot(slot) {
		var ch = slot - 1;
		try {
			if (ch < 8) {
				var bs = window.melodicArr[ch].buffers;
				var b = bs.get(61);
				return (b && (b.get ? b.get() : b._buffer || b)) || null;
			}
			var pl = window.drumArr[ch - 8];
			var pad = (window.channelSettingsArr[ch].lastPad != null)
				? window.channelSettingsArr[ch].lastPad
				: (window.channelSettingsArr[ch].notePitch || 0) % 16;
			var pb = pl.get(window.noteArray[pad]).buffer;
			return (pb && (pb.get ? pb.get() : pb._buffer || pb)) || null;
		} catch (e) { return null; }
	}

	function pcm(buf) {
		try { return buf.getChannelData(0); } catch (e) { return null; }
	}

	/* ---------- the measurements ---------- */

	// short-time RMS envelope
	function envelope(d) {
		var n = Math.max(1, Math.floor((d.length - WIN) / HOP));
		var env = new Float32Array(n);
		for (var i = 0; i < n; i++) {
			var s = i * HOP, sum = 0;
			for (var j = 0; j < WIN; j++) { var v = d[s + j]; sum += v * v; }
			env[i] = Math.sqrt(sum / WIN);
		}
		return env;
	}

	/* Onsets = where the energy jumps. Half-wave rectified difference of the
	 * envelope, peak-picked above an adaptive threshold with a minimum gap so
	 * one hit does not register three times. */
	function onsets(env, sr) {
		var n = env.length, flux = new Float32Array(n), i;
		for (i = 1; i < n; i++) { flux[i] = Math.max(0, env[i] - env[i - 1]); }

		var mean = 0;
		for (i = 0; i < n; i++) { mean += flux[i]; }
		mean /= Math.max(1, n);
		var sd = 0;
		for (i = 0; i < n; i++) { var dd = flux[i] - mean; sd += dd * dd; }
		sd = Math.sqrt(sd / Math.max(1, n));

		var thresh = mean + sd * 1.1;
		var minGap = Math.max(2, Math.round(0.045 * sr / HOP));   // 45ms
		var out = [], last = -1e9;
		for (i = 1; i < n - 1; i++) {
			if (flux[i] < thresh) { continue; }
			if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) { continue; }   // local peak
			if (i - last < minGap) { continue; }
			last = i;
			out.push(i * HOP / sr);
		}
		return out;
	}

	/* Two independent tempo estimates, because they fail in different ways.
	 *
	 *  - byLength assumes the sample IS a whole number of bars, which is true
	 *    for most things anyone loops, and is exact when it holds.
	 *  - byOnsets autocorrelates the onset envelope and needs no such
	 *    assumption, but gets confused by sparse or rubato material.
	 *
	 * When they agree you can trust the number. That agreement is worth
	 * reporting, so the caller can say so rather than pretending to certainty.
	 */
	function tempoByLength(seconds) {
		var best = null;
		[1, 2, 4, 8].forEach(function (bars) {
			var bpm = 240 * bars / seconds;
			if (bpm < 65 || bpm > 190) { return; }
			// prefer the candidate closest to the middle of where music lives
			var score = Math.abs(Math.log(bpm / 100));
			if (!best || score < best.score) { best = { bpm: bpm, bars: bars, score: score }; }
		});
		return best;
	}

	function tempoByOnsets(env, sr) {
		var n = env.length;
		if (n < 32) { return null; }
		var flux = new Float32Array(n), i, k;
		for (i = 1; i < n; i++) { flux[i] = Math.max(0, env[i] - env[i - 1]); }
		var fps = sr / HOP;
		var lagMin = Math.floor(fps * 60 / 190);     // 190 BPM
		var lagMax = Math.ceil(fps * 60 / 65);       // 65 BPM
		if (lagMax >= n) { lagMax = n - 1; }
		var bestLag = 0, bestVal = 0;
		for (k = lagMin; k <= lagMax; k++) {
			var sum = 0;
			for (i = 0; i + k < n; i++) { sum += flux[i] * flux[i + k]; }
			sum /= (n - k);
			if (sum > bestVal) { bestVal = sum; bestLag = k; }
		}
		if (!bestLag) { return null; }
		return 60 * fps / bestLag;
	}

	// zero-crossing rate as a cheap brightness proxy — no FFT needed
	function brightness(d) {
		var z = 0;
		for (var i = 1; i < d.length; i++) {
			if ((d[i - 1] < 0) !== (d[i] < 0)) { z++; }
		}
		return z / d.length;      // crossings per sample
	}

	function leadIn(d, sr) {
		var t = 0.008;
		for (var i = 0; i < d.length; i++) { if (Math.abs(d[i]) > t) { return i / sr; } }
		return d.length / sr;
	}

	function tail(d, sr) {
		var t = 0.008;
		for (var i = d.length - 1; i >= 0; i--) { if (Math.abs(d[i]) > t) { return (d.length - 1 - i) / sr; } }
		return 0;
	}

	function analyse(buf) {
		var d = pcm(buf);
		if (!d || !d.length) { return null; }
		var sr = buf.sampleRate, secs = buf.duration;

		var peak = 0, sum = 0, i;
		for (i = 0; i < d.length; i++) {
			var a = Math.abs(d[i]);
			if (a > peak) { peak = a; }
			sum += d[i] * d[i];
		}
		var rms = Math.sqrt(sum / d.length);

		var env = envelope(d);
		var on = onsets(env, sr);
		var byLen = tempoByLength(secs);
		var byOn = tempoByOnsets(env, sr);

		var agree = (byLen && byOn) ? Math.abs(byLen.bpm - byOn) < 4 : false;

		return {
			seconds: secs,
			sampleRate: sr,
			peak: peak,
			rms: rms,
			crest: peak > 0 ? (20 * Math.log10(peak / Math.max(1e-6, rms))) : 0,
			leadIn: leadIn(d, sr),
			tail: tail(d, sr),
			zcr: brightness(d),
			onsets: on,
			tempoByLength: byLen,
			tempoByOnsets: byOn,
			tempoAgree: agree,
			silent: peak < 0.005
		};
	}

	/* ---------- turning that into something worth sending ---------- */

	function round(n, p) { var m = Math.pow(10, p || 1); return Math.round(n * m) / m; }

	function describeSlot(slot) {
		var buf = bufferForSlot(slot);
		if (!buf) { return "slot " + slot + ": no audio could be read."; }
		var a = analyse(buf);
		if (!a) { return "slot " + slot + ": the buffer was empty."; }
		if (a.silent) { return "slot " + slot + ": the sample is silent."; }

		var L = [];
		L.push("MEASURED AUDIO IN SLOT " + slot + " (analysed in the browser, exact):");
		L.push("- length " + round(a.seconds, 2) + "s");
		if (a.leadIn > 0.02) {
			L.push("- " + round(a.leadIn * 1000, 0) + "ms of near-silence BEFORE the first sound " +
				"(this is why a pad can feel late; trimming it off fixes the timing)");
		} else {
			L.push("- starts immediately, no dead air at the front");
		}
		if (a.tail > 0.05) { L.push("- " + round(a.tail * 1000, 0) + "ms of silence at the end"); }

		if (a.tempoByLength) {
			L.push("- if this is " + a.tempoByLength.bars + " bar(s), the tempo is " +
				round(a.tempoByLength.bpm, 1) + " BPM");
		}
		if (a.tempoByOnsets) {
			L.push("- the spacing of its hits suggests " + round(a.tempoByOnsets, 1) + " BPM");
		}
		L.push(a.tempoAgree
			? "- both estimates agree, so the tempo is reliable"
			: "- the two tempo estimates disagree, so treat the tempo as uncertain");

		L.push("- " + a.onsets.length + " distinct hits detected" +
			(a.onsets.length ? " at " + a.onsets.slice(0, 12).map(function (t) {
				return round(t, 2) + "s";
			}).join(", ") + (a.onsets.length > 12 ? " …" : "") : ""));

		// what the chop maths actually says
		[8, 16].forEach(function (n) {
			L.push("- chopped x" + n + ", each slice would be " +
				round((a.seconds - a.leadIn) / n, 3) + "s");
		});

		L.push("- dynamics: peak " + round(20 * Math.log10(Math.max(1e-6, a.peak)), 1) +
			"dBFS, crest factor " + round(a.crest, 1) + "dB" +
			(a.crest > 14 ? " (punchy, lots of transient)" : a.crest < 8 ? " (squashed / compressed)" : " (moderate)"));
		L.push("- brightness: " + (a.zcr > 0.12 ? "bright / noisy (hats, crunch)"
			: a.zcr < 0.03 ? "dark / bassy" : "mid-range"));
		return L.join("\n");
	}

	window.PO33.listen = {
		bufferForSlot: bufferForSlot,
		analyse: function (slot) { var b = bufferForSlot(slot); return b ? analyse(b) : null; },
		analyseBuffer: analyse,
		describeSlot: describeSlot
	};
})();
