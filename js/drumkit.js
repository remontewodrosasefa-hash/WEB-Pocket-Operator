/* drumkit.js — synthesised drum kits, rendered to real audio buffers.
 *
 * The drum slots hold sixteen one-shot samples each. Rather than ship more
 * .wav files, these kits are built out of maths in an OfflineAudioContext and
 * loaded onto a slot's pads exactly like a chopped or recorded sample would
 * be — so they cost nothing to download, they work offline, and everything
 * downstream (trim, per-step locks, patterns, the chop store) treats them as
 * ordinary audio because that is what they are.
 *
 * Exposes window.PO33.drumkit
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "tip"); } }
	function rawCtx() { try { return Tone.context._context || Tone.context; } catch (e) { return null; } }

	/* ---------- tiny synthesis helpers, all offline ---------- */

	function render(seconds, build) {
		var rate = 44100;
		try { rate = (rawCtx() || {}).sampleRate || 44100; } catch (e) {}
		var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
		if (!OC) { return null; }
		var ctx = new OC(1, Math.max(128, Math.ceil(rate * seconds)), rate);
		build(ctx, ctx.destination);
		return ctx.startRendering();
	}

	function env(ctx, node, peak, attack, decay) {
		var g = ctx.createGain();
		g.gain.setValueAtTime(0, 0);
		g.gain.linearRampToValueAtTime(peak, attack);
		g.gain.exponentialRampToValueAtTime(0.0001, attack + decay);
		node.connect(g);
		return g;
	}

	function noiseBuf(ctx, seconds) {
		var b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
		var d = b.getChannelData(0);
		for (var i = 0; i < d.length; i++) { d[i] = Math.random() * 2 - 1; }
		return b;
	}

	function noise(ctx, seconds) {
		var s = ctx.createBufferSource();
		s.buffer = noiseBuf(ctx, seconds);
		s.start(0);
		return s;
	}

	/* ---------- the voices ---------- */

	// a sine that drops in pitch: the whole of every electronic kick drum
	function kick(f0, f1, decay, drive) {
		return function (ctx, out) {
			var o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.setValueAtTime(f0, 0);
			o.frequency.exponentialRampToValueAtTime(f1, decay * 0.6);
			var g = env(ctx, o, 1, 0.001, decay);
			if (drive) {
				var sh = ctx.createWaveShaper();
				var c = new Float32Array(1024);
				for (var i = 0; i < 1024; i++) {
					var x = (i / 512) - 1;
					c[i] = Math.tanh(x * drive);
				}
				sh.curve = c;
				g.connect(sh); sh.connect(out);
			} else { g.connect(out); }
			o.start(0); o.stop(decay + 0.05);
		};
	}

	function snare(tone, decay, noiseMix) {
		return function (ctx, out) {
			var o = ctx.createOscillator();
			o.type = "triangle";
			o.frequency.setValueAtTime(tone, 0);
			o.frequency.exponentialRampToValueAtTime(tone * 0.6, decay);
			env(ctx, o, 1 - noiseMix, 0.001, decay).connect(out);
			o.start(0); o.stop(decay + 0.05);

			var n = noise(ctx, decay + 0.05);
			var hp = ctx.createBiquadFilter();
			hp.type = "highpass"; hp.frequency.value = 1200;
			n.connect(hp);
			env(ctx, hp, noiseMix, 0.001, decay * 0.9).connect(out);
		};
	}

	function hat(decay, cutoff) {
		return function (ctx, out) {
			var n = noise(ctx, decay + 0.05);
			var hp = ctx.createBiquadFilter();
			hp.type = "highpass"; hp.frequency.value = cutoff;
			n.connect(hp);
			env(ctx, hp, 0.7, 0.0005, decay).connect(out);
		};
	}

	// four short noise bursts a few ms apart — why a clap sounds like a room
	function clap(decay) {
		return function (ctx, out) {
			[0, 0.010, 0.020, 0.030].forEach(function (t, i) {
				var n = noise(ctx, decay);
				var bp = ctx.createBiquadFilter();
				bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 1.2;
				n.connect(bp);
				var g = ctx.createGain();
				var peak = i === 3 ? 0.9 : 0.5;
				g.gain.setValueAtTime(0, t);
				g.gain.linearRampToValueAtTime(peak, t + 0.001);
				g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? decay : 0.03));
				bp.connect(g); g.connect(out);
			});
		};
	}

	function tom(f0, decay) {
		return function (ctx, out) {
			var o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.setValueAtTime(f0, 0);
			o.frequency.exponentialRampToValueAtTime(f0 * 0.55, decay);
			env(ctx, o, 0.9, 0.001, decay).connect(out);
			o.start(0); o.stop(decay + 0.05);
		};
	}

	function rim() {
		return function (ctx, out) {
			var o = ctx.createOscillator();
			o.type = "square";
			o.frequency.setValueAtTime(1700, 0);
			env(ctx, o, 0.5, 0.0005, 0.03).connect(out);
			o.start(0); o.stop(0.08);
		};
	}

	function cowbell() {
		return function (ctx, out) {
			[540, 800].forEach(function (f) {
				var o = ctx.createOscillator();
				o.type = "square";
				o.frequency.setValueAtTime(f, 0);
				env(ctx, o, 0.35, 0.001, 0.25).connect(out);
				o.start(0); o.stop(0.3);
			});
		};
	}

	function zap(f0, f1, decay) {
		return function (ctx, out) {
			var o = ctx.createOscillator();
			o.type = "sawtooth";
			o.frequency.setValueAtTime(f0, 0);
			o.frequency.exponentialRampToValueAtTime(f1, decay);
			env(ctx, o, 0.6, 0.001, decay).connect(out);
			o.start(0); o.stop(decay + 0.05);
		};
	}

	/* ---------- the kits ----------
	 * Sixteen pads each, in the order a drummer would reach for them:
	 * kick, snare, hats, then the extras.
	 */
	var KITS = {
		"808": {
			blurb: "long booming kick, snappy snare, metallic hats",
			pads: [
				[0.9, kick(120, 38, 0.85, 2)], [0.7, kick(150, 45, 0.45, 2)],
				[0.35, snare(190, 0.16, 0.6)], [0.35, snare(210, 0.10, 0.75)],
				[0.09, hat(0.04, 7000)], [0.4, hat(0.30, 7000)],
				[0.4, clap(0.22)], [0.1, rim()],
				[0.4, tom(120, 0.32)], [0.4, tom(180, 0.28)], [0.4, tom(260, 0.24)],
				[0.35, cowbell()],
				[0.3, zap(900, 90, 0.22)], [0.25, hat(0.18, 11000)],
				[0.5, snare(150, 0.32, 0.5)], [0.6, kick(90, 30, 0.55, 3)]
			]
		},
		"909": {
			blurb: "punchier kick, noisier snare, house-ready",
			pads: [
				[0.55, kick(180, 48, 0.42, 3)], [0.45, kick(220, 55, 0.30, 3)],
				[0.28, snare(240, 0.14, 0.78)], [0.22, snare(260, 0.09, 0.85)],
				[0.06, hat(0.035, 9000)], [0.32, hat(0.26, 9000)],
				[0.3, clap(0.18)], [0.08, rim()],
				[0.3, tom(150, 0.25)], [0.3, tom(210, 0.22)], [0.3, tom(300, 0.2)],
				[0.3, cowbell()],
				[0.22, zap(1400, 140, 0.16)], [0.2, hat(0.14, 12000)],
				[0.35, snare(200, 0.26, 0.7)], [0.4, kick(140, 40, 0.36, 4)]
			]
		},
		"lo-fi": {
			blurb: "soft, dusty, short — sits under a sample without fighting it",
			pads: [
				[0.5, kick(95, 42, 0.36, 1)], [0.4, kick(110, 50, 0.26, 1)],
				[0.22, snare(170, 0.12, 0.45)], [0.18, snare(185, 0.08, 0.55)],
				[0.05, hat(0.03, 5200)], [0.22, hat(0.16, 5200)],
				[0.25, clap(0.14)], [0.08, rim()],
				[0.26, tom(110, 0.22)], [0.26, tom(160, 0.2)], [0.26, tom(220, 0.18)],
				[0.3, cowbell()],
				[0.18, zap(700, 80, 0.14)], [0.16, hat(0.1, 8000)],
				[0.3, snare(140, 0.22, 0.4)], [0.35, kick(80, 34, 0.3, 1)]
			]
		}
	};

	function kitNames() { return Object.keys(KITS); }
	function blurb(name) { return (KITS[name] || {}).blurb || ""; }

	/* ---------- load a kit onto a slot ---------- */

	function load(slot, name) {
		var kit = KITS[name];
		if (!kit) { return Promise.resolve(false); }
		if (slot < 9 || slot > 16) { flash("drum kits need a drum slot (9-16)", "warn"); return Promise.resolve(false); }
		var di = slot - 9;
		try {
			if (!window.drumArr[di] && window.PO33.slice && PO33.slice.ensureSlot) {
				PO33.slice.ensureSlot(di);
			}
		} catch (e) {}
		if (!window.drumArr || !window.drumArr[di]) { flash("could not prepare slot " + slot, "warn"); return Promise.resolve(false); }

		var jobs = kit.pads.map(function (spec) {
			var p = render(spec[0], spec[1]);
			return p || Promise.resolve(null);
		});

		return Promise.all(jobs).then(function (bufs) {
			var live = rawCtx();
			var kept = [];
			bufs.forEach(function (b, pad) {
				if (!b || pad > 15) { return; }
				// an offline render comes back as its own buffer; copy it into
				// one belonging to the live context so Tone can play it
				var copy = b;
				try {
					copy = live.createBuffer(1, b.length, b.sampleRate);
					copy.getChannelData(0).set(b.getChannelData(0));
				} catch (e) {}
				try {
					window.drumArr[di].add(window.noteArray[pad], copy);
					window.drumArr[di].get(window.noteArray[pad]).playbackRate = 1;
				} catch (e) {}
				kept[pad] = copy;
			});
			// same store the chops use, so a kit survives a reload too
			try { window.PO33.chops.saveSlot(slot, kept); } catch (e) {}
			try {
				var cs = window.channelSettingsArr[slot - 1];
				cs.fxTrim = 0; cs.fxLength = 1000; cs.notePitch = 0;
			} catch (e) {}
			flash(name + " kit → SOUND " + slot, "warn");
			return true;
		}).catch(function () { return false; });
	}

	window.PO33.drumkit = { load: load, names: kitNames, blurb: blurb };
})();
