/* studio.js
 * Two additions the hardware can't do on its own:
 *  1. a readable status HUD drawn over the LCD
 *  2. an audio recorder (microphone OR a browser tab's audio) that drops the
 *     result straight onto the currently selected sound slot.
 */
(function () {
	"use strict";

	/* ============================================================
	 * 1. LCD HUD
	 * ============================================================ */

	var MODE_NAMES = { 0: "PERFORM", 1: "WRITE", 2: "SOUND", 3: "PATTERN", 4: "BPM",
		11: "LIVE REC", 33: "COPY PTN", 34: "PASTE PTN" };
	var FX_NAMES = ["TONE", "FILTER", "TRIM"];

	// Ethiopian household motifs, line-art. Swapped by mode so the screen has
	// life without competing with the readout.
	var ART = {
		jebena: '<svg viewBox="0 0 100 100"><path d="M50 8c-4 0-6 3-6 6l-2 4h16l-2-4c0-3-2-6-6-6zM38 20c-10 6-16 20-16 34 0 16 12 30 28 30s28-14 28-30c0-14-6-28-16-34zM33 44c6-6 28-6 34 0"/><path d="M66 34c10 2 16 8 12 16"/></svg>',
		mesob: '<svg viewBox="0 0 100 100"><path d="M50 10l14 12H36zM26 24h48l-6 44H32zM22 72h56l-6 16H28z"/><path d="M34 34h32M32 46h36M31 58h38"/></svg>',
		gabi: '<svg viewBox="0 0 100 100"><path d="M14 30h72v40H14z"/><path d="M14 38h72M14 62h72M22 30v40M78 30v40"/><path d="M22 44l56 12M78 44L22 56"/></svg>',
		cross: '<svg viewBox="0 0 100 100"><path d="M50 12v76M28 34h44M24 50h52M28 66h44"/><path d="M50 12c-8 6-8 14 0 20 8-6 8-14 0-20zM50 68c-8 6-8 14 0 20 8-6 8-14 0-20z"/></svg>',
		masinko: '<svg viewBox="0 0 100 100"><path d="M50 14c-9 8-9 44 0 60 9-16 9-52 0-60z"/><path d="M50 74v14M40 88h20M30 24l40 44M70 24L30 68"/></svg>'
	};
	var ART_BY_MODE = { 0: "jebena", 1: "mesob", 2: "cross", 3: "gabi", 4: "masinko", 11: "mesob" };

	// short "what this does" text, shown briefly when a control is used
	var BTN_INFO = {
		btnSound: "SOUND — pick the active sound slot, then a pad",
		btnPattern: "PATTERN — hold to select / chain patterns",
		btnBPM: "BPM — sliders set swing & tempo · double-tap = presets",
		btnFX: "FX — cycles slider target: TONE / FILTER / TRIM",
		btnPlay: "PLAY — start / stop the sequencer",
		btnWrite: "WRITE — edit steps · hold 3s while playing = live record",
		btnRecord: "RECORD — sample the mic / a browser tab onto this slot"
	};

	function g(name, dflt) {
		return (typeof window[name] !== "undefined") ? window[name] : dflt;
	}

	var flashTimer;
	function flash(msg, kind) {
		var el = document.getElementById("hudFlash");
		if (!el) { return; }
		el.textContent = msg;
		el.className = "show " + (kind || "info");
		clearTimeout(flashTimer);
		flashTimer = setTimeout(function () { el.className = el.className.replace("show", "").trim(); }, 2200);
	}
	window.PO33 = window.PO33 || {};
	window.PO33.flash = flash;

	function buildHud() {
		var lcd = document.querySelector(".lcd");
		if (!lcd || document.getElementById("lcdHud")) { return; }
		var hud = document.createElement("div");
		hud.id = "lcdHud";
		hud.innerHTML =
			'<div class="hudTop"><span id="hudMode">PERFORM</span>' +
				'<span id="hudClock"></span></div>' +
			'<div id="hudMain">—</div>' +
			'<div id="hudSub">&nbsp;</div>' +
			'<div id="hudArt"></div>' +
			'<div id="hudFlash"></div>' +
			'<div id="hudSteps"></div>';
		lcd.appendChild(hud);
		wireFeedback();

		var steps = hud.querySelector("#hudSteps");
		for (var i = 0; i < 16; i++) {
			var d = document.createElement("i");
			steps.appendChild(d);
		}
		E.mode = document.getElementById("hudMode");
		E.main = document.getElementById("hudMain");
		E.sub = document.getElementById("hudSub");
		E.clock = document.getElementById("hudClock");
		E.art = document.getElementById("hudArt");
		E.steps = document.getElementById("hudSteps").children;
		tick();
		setInterval(tick, 130);
	}

	var E = {};

	function tick() {
		var modeEl = E.mode;
		if (!modeEl) { return; }
		// an overlay covers the LCD — don't churn behind it
		if (document.body.classList.contains("projOpen") ||
		    document.body.classList.contains("trimOpen")) { updateClock(); return; }

		var mode = g("mode", 0), state = g("state", 0), view = g("view", 0);
		var play = g("play", false);
		var sel = g("selectedChannel", 0);
		var pat = g("currentPattern", 0);
		var tempo = g("tempo", 120), swing = g("swing", 0), vol = g("volume", 8);
		var beat = g("beatCount", 0);
		var fxMode = g("fxMode", 0);

		var effState = state || mode;
		var mainEl = E.main;
		var subEl = E.sub;

		modeEl.textContent = MODE_NAMES[effState] || ("MODE " + effState);

		var slot = sel + 1;
		var kind = slot <= 8 ? "melodic" : "drum";
		var name = (window.PO33Lib && PO33Lib.slotName) ? PO33Lib.slotName(slot) : null;
		var soundLine = "SOUND " + slot + " · " + kind + (name ? "  " + shortName(name) : "  (default)");

		if (state === 4) {
			mainEl.textContent = tempo + " BPM";
			subEl.textContent = "swing " + swing + "%   ·   vol " + vol + "/16";
		} else if (state === 3 || state === 33 || state === 34) {
			mainEl.textContent = "PATTERN " + (pat + 1);
			subEl.textContent = "chain: " + (g("patternChain", [0]).map(function (n) { return n + 1; }).join(" ")) ;
		} else if (state === 2) {
			mainEl.textContent = soundLine;
			subEl.textContent = "press a pad to pick · Library click loads here";
		} else if (mode === 1) {
			mainEl.textContent = "WRITE → " + soundLine;
			subEl.textContent = "press pads 1-16 to place steps";
		} else if (mode === 11) {
			mainEl.textContent = "● LIVE REC → " + soundLine;
			subEl.textContent = "playing pads records into pattern " + (pat + 1);
		} else {
			mainEl.textContent = soundLine;
			subEl.textContent = play ? ("playing · pattern " + (pat + 1)) : "stopped · press PLAY";
			if (view === 0 && fxMode) {
				subEl.textContent += "   · FX " + (FX_NAMES[fxMode] || fxMode);
			}
		}

		updateSliderLabels();
		updateClock();

		var kids = E.steps;
		var heldLock = (window.PO33 && PO33.locks) ? PO33.locks.held() : -1;
		for (var i = 0; i < 16; i++) {
			var on = false, cur = play && i === beat, lk = false, acc = "";
			try {
				var bt = window.newChannelArr && newChannelArr[sel][pat][i];
				if (bt) {
					on = !!bt.noteOn;
					lk = on && !!bt.locked;
					if (on) {
						var bv = (bt.fxVolume == null ? -12 : bt.fxVolume);
						if (bv > -8) { acc = " acc"; }
						else if (bv < -18) { acc = " ghost"; }
					}
				}
			} catch (e) {}
			var cls = (on ? "on" : "") + (cur ? " cur" : "") + (lk ? " lk" : "") + acc +
				(i === heldLock ? " held" : "");
			if (kids[i].className !== cls) { kids[i].className = cls; }
		}

		var wantArt = ART_BY_MODE[effState] || "jebena";
		if (E.art && E.art.dataset.art !== wantArt) {
			E.art.dataset.art = wantArt;
			E.art.innerHTML = ART[wantArt];
		}

		// live hint while FX is held
		if (window.fxHeld && !flashTimer) {
			flash("FX held · " + (FX_NAMES[fxMode] || "TONE") + " — release to keep", "tip");
		}

		// recommended next step — nudge on mode changes only, never nagging
		var ctxKey = effState + "|" + mode + "|" + (play ? 1 : 0) + "|" + (name ? 1 : 0);
		if (ctxKey !== tick._ctx) {
			tick._ctx = ctxKey;
			var tip = nextHint(effState, mode, play, name, sel, pat);
			if (tip && !flashTimer) { flash("next → " + tip, "tip"); }
		}
	}

	function updateClock() {
		if (!E.clock) { return; }
		var now = new Date();
		var t = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
		if (E.clock.textContent !== t) { E.clock.textContent = t; }
	}

	function patternHasSteps(pat) {
		try {
			for (var c = 0; c < 16; c++) {
				for (var b = 0; b < 16; b++) { if (newChannelArr[c][pat][b].noteOn) { return true; } }
			}
		} catch (e) {}
		return false;
	}

	function nextHint(state, mode, play, haveSample, sel, pat) {
		if (state === 2) { return "tap a pad to pick the slot, or click a Library sample"; }
		if (state === 4) { return "drag the sliders for swing & tempo"; }
		if (state === 3) { return "tap pads to pick / chain patterns, PATTERN to exit"; }
		if (mode === 1) {
			return patternHasSteps(pat) ? "PLAY to hear it, or WRITE to exit" : "tap pads 1-16 to add steps";
		}
		if (!haveSample && sel < 8) { return "open LIBRARY to load a sound onto this slot"; }
		if (!play && patternHasSteps(pat)) { return "press PLAY"; }
		if (!play) { return "SOUND + a pad to choose a sound, then WRITE to sequence"; }
		return "hold FX + pads 1-8 for effects";
	}

	// screen reacts to every control: show what it does, or that it did nothing
	function wireFeedback() {
		document.addEventListener("click", function (e) {
			var item = e.target.closest("[id^='btn']");
			if (!item) { return; }
			var id = item.id;
			try { if (localStorage.getItem("po33.haptics") !== "0" && navigator.vibrate) { navigator.vibrate(8); } } catch (e) {}
			if (BTN_INFO[id]) { flash(BTN_INFO[id], "info"); return; }
			if (/^btn([1-9]|1[0-6])$/.test(id)) {
				var n = +id.slice(3);
				var st = g("state", 0), md = g("mode", 0);
				if (st === 0 && md === 0 && !g("play", false)) {
					flash("pad " + n + " · playing sound " + (g("selectedChannel", 0) + 1), "info");
				} else if (md === 1) {
					flash("pad " + n + " · step " + n + " toggled", "info");
				}
			}
		}, true);

		// FX press-and-hold: enters punch-in mode; a short tap still cycles the
		// slider target as before.
		var fx = document.getElementById("btnFX");
		if (fx) {
			var downAt = 0;
			var down = function () {
				window.fxHeld = true;
				window.fxWasUsed = false;
				downAt = Date.now();
				buildFxChain(); // lazy — first hold only
				flash("FX held · pads 1-8 = effects", "tip");
			};
			var up = function () {
				window.fxHeld = false;
				// swallow the trailing click (so the mode doesn't cycle) if this
				// was a real hold or a punch-in was triggered
				if (Date.now() - downAt > 250 || window.fxWasUsed) { fx.dataset.eat = "1"; }
			};
			fx.addEventListener("mousedown", down);
			fx.addEventListener("touchstart", down, { passive: true });
			fx.addEventListener("mouseup", up);
			fx.addEventListener("mouseleave", up);
			fx.addEventListener("touchend", up);
			fx.addEventListener("click", function (e) {
				if (fx.dataset.eat) { e.stopImmediatePropagation(); e.preventDefault(); delete fx.dataset.eat; }
			}, true);
		}
	}

	/* ============================================================
	 * Punch-in FX engine — a bypassed master chain spliced between the
	 * meter and Tone.Master. Fully guarded: if the reroute fails, the
	 * app keeps working and FX just does nothing.
	 * ============================================================ */

	var fxNodes = null;

	function distTo(amt) {
		if (!fxNodes) { return; }
		try { fxNodes.dist.wet.rampTo(amt > 0 ? 1 : 0, 0.03); } catch (e) {}
		try { fxNodes.dist.distortion = amt; } catch (e) {}
	}
	function pitchTo(semis) {
		if (!fxNodes) { return; }
		try { fxNodes.pitch.pitch = semis; } catch (e) {}
	}
	function ramp(sig, val, t) { try { sig.rampTo(val, t); } catch (e) { try { sig.value = val; } catch (e2) {} } }

	// Built lazily on the FIRST FX hold so users who never touch FX pay nothing.
	// No BitCrusher (r12's is a main-thread ScriptProcessor → mobile jank).
	var fxTried = false;
	function buildFxChain() {
		if (fxNodes || fxTried || !window.Tone || !window.meter) { return; }
		fxTried = true;
		try {
			var M = Tone.Master;
			var hp     = new Tone.Filter(20, "highpass");
			var lp     = new Tone.Filter(20000, "lowpass");
			var dist   = new Tone.Distortion(0.9);      dist.wet.value = 0;
			var chorus = new Tone.Chorus(4, 2.5, 0.7);  chorus.wet.value = 0;
			var phaser = new Tone.Phaser(0.6, 3, 900);  phaser.wet.value = 0;
			var delay  = new Tone.FeedbackDelay(0.19, 0.34); delay.wet.value = 0;
			var pong   = new Tone.PingPongDelay(0.25, 0.45); pong.wet.value = 0;
			var pitch  = new Tone.PitchShift(0);
			var verb   = new Tone.Freeverb(0.85, 3000); verb.wet.value = 0;
			var wob    = new Tone.AutoFilter(5, 200, 4); wob.wet.value = 0;
			try { wob.start(); } catch (e) {}
			var trem   = new Tone.Tremolo(13, 0);
			try { trem.start(); } catch (e) {}
			// a dedicated, always-in-chain filter driven by an LFO (off by default)
			var lfoFilt = new Tone.Filter(20000, "lowpass");
			var lfo     = new Tone.LFO(4, 400, 6000);
			lfo.type = "sine";
			try { lfo.connect(lfoFilt.frequency); } catch (e) {}
			var kill   = new Tone.Gain(1);

			hp.chain(lp, dist, chorus, phaser, delay, pong, pitch, verb, wob, trem, lfoFilt, kill, M);

			var rerouted = false;
			try {
				try { meter.disconnect(); } catch (e) { try { meter.disconnect(0); } catch (e2) {} }
				meter.connect(hp);
				rerouted = true;
			} catch (e) {
				try { meter.connect(M); } catch (e2) {}
			}
			if (!rerouted) { return; }

			fxNodes = { hp: hp, lp: lp, dist: dist, chorus: chorus, phaser: phaser, lfoFilt: lfoFilt, lfo: lfo,
				delay: delay, pong: pong, pitch: pitch, verb: verb, wob: wob,
				trem: trem, kill: kill };
		} catch (e) {
			fxNodes = null;
		}
	}

	/* ---- persistent LFO -> master filter ---- */
	var lfoOn = false;
	function setLfo(opts) {
		opts = opts || {};
		var toggled = opts.on != null;
		if (toggled) { lfoOn = !!opts.on; }
		if (lfoOn) { buildFxChain(); }
		if (!fxNodes || !fxNodes.lfo) { return lfoState(); }
		var f = fxNodes;
		try {
			if (opts.rate != null) { f.lfo.frequency.value = Math.max(0.05, +opts.rate); }
			if (opts.wave) { f.lfo.type = opts.wave; }
			if (opts.depth != null) {
				var d = Math.max(0, Math.min(1, +opts.depth));   // 0..1
				var floor = 8000 - d * 7800;                      // deeper = lower floor
				f.lfo.min = 20 + floor * 0.05;
				f.lfo.max = Math.max(f.lfo.min + 50, 8000);
			}
			if (lfoOn) { f.lfo.start(); }
			else { f.lfo.stop(); ramp(f.lfoFilt.frequency, 20000, 0.15); }
		} catch (e) {}
		persistLfo();
		if (toggled) { flash("LFO " + (lfoOn ? "on" : "off"), lfoOn ? "warn" : "tip"); }
		return lfoState();
	}
	function lfoState() {
		var f = fxNodes;
		return {
			on: lfoOn,
			rate: f && f.lfo ? Math.round(f.lfo.frequency.value * 100) / 100 : 4,
			wave: f && f.lfo ? f.lfo.type : "sine"
		};
	}
	function persistLfo() {
		try { localStorage.setItem("po33.lfo", JSON.stringify(lfoState())); } catch (e) {}
	}
	function restoreLfo() {
		var v;
		try { v = JSON.parse(localStorage.getItem("po33.lfo") || "null"); } catch (e) {}
		if (v && v.on) { setLfo({ on: true, rate: v.rate, wave: v.wave, depth: 0.6 }); }
	}
	window.PO33.fx = { lfo: setLfo, lfoState: lfoState, buildChain: buildFxChain };

	var FX_LABELS = ["",
		"CRUSH", "LO-FI", "FILTER DOWN", "FILTER UP",
		"DELAY", "STUTTER", "PITCH UP", "PITCH DOWN",
		"REVERB", "WIDE 6/9", "PHASER", "TAPE STOP",
		"ROLL", "PING-PONG", "WOBBLE", "KILL"];

	var tapeTimer = null;

	function fxOn(n) {
		window.fxWasUsed = true;
		flash("FX " + n + " · " + (FX_LABELS[n] || ""), "warn");
		if (!fxNodes) { return; }
		var f = fxNodes;
		switch (n) {
			case 1:  distTo(0.92); ramp(f.lp.frequency, 3500, 0.05); break;
			case 2:  ramp(f.lp.frequency, 900, 0.05); distTo(0.45); break;
			case 3:  ramp(f.lp.frequency, 240, 0.12); break;
			case 4:  ramp(f.hp.frequency, 1800, 0.12); break;
			case 5:  ramp(f.delay.wet, 0.55, 0.04); break;
			case 6:  try { f.trem.frequency.value = 13; } catch (e) {}
			         ramp(f.trem.depth, 1, 0.02); break;
			case 7:  pitchTo(7); break;
			case 8:  pitchTo(-5); break;
			case 9:  ramp(f.verb.wet, 0.6, 0.05); break;
			case 10: ramp(f.chorus.wet, 1, 0.05); break;
			case 11: ramp(f.phaser.wet, 1, 0.05); break;
			case 12: tapeStop(); break;
			case 13: try { f.trem.frequency.value = 26; } catch (e) {}
			         ramp(f.trem.depth, 1, 0.02); break;
			case 14: ramp(f.pong.wet, 0.6, 0.04); break;
			case 15: ramp(f.wob.wet, 1, 0.05); break;
			case 16: ramp(f.kill.gain, 0, 0.015); break;
		}
	}

	// slow the "tape" down: pitch drops and the top end closes over ~0.6s
	function tapeStop() {
		var f = fxNodes;
		if (!f) { return; }
		clearTimeout(tapeTimer);
		var t0 = Date.now();
		var step = function () {
			var k = Math.min(1, (Date.now() - t0) / 600);
			pitchTo(-12 * k);
			ramp(f.lp.frequency, 20000 - (19700 * k), 0.05);
			if (k < 1) { tapeTimer = setTimeout(step, 40); }
		};
		step();
	}

	function fxOff() {
		clearTimeout(tapeTimer);
		if (!fxNodes) { return; }
		var f = fxNodes;
		ramp(f.lp.frequency, 20000, 0.12);
		ramp(f.hp.frequency, 20, 0.12);
		ramp(f.delay.wet, 0, 0.12);
		ramp(f.pong.wet, 0, 0.12);
		ramp(f.verb.wet, 0, 0.15);
		ramp(f.chorus.wet, 0, 0.08);
		ramp(f.phaser.wet, 0, 0.08);
		ramp(f.wob.wet, 0, 0.08);
		ramp(f.trem.depth, 0, 0.06);
		ramp(f.kill.gain, 1, 0.02);
		pitchTo(0);
		distTo(0);
	}

	function wireFxPads() {
		for (var n = 1; n <= 16; n++) {
			(function (n) {
				var el = document.getElementById("btn" + n);
				if (!el || el.dataset.fxWired) { return; }
				el.dataset.fxWired = "1";
				el.addEventListener("pointerdown", function (e) {
					if (!window.fxHeld) { return; }
					e.stopImmediatePropagation();
					e.preventDefault();
					el.dataset.fxFired = "1";
					fxOn(n);
					var end = function () {
						fxOff();
						window.removeEventListener("pointerup", end, true);
						window.removeEventListener("pointercancel", end, true);
						setTimeout(function () { delete el.dataset.fxFired; }, 300);
					};
					window.addEventListener("pointerup", end, true);
					window.addEventListener("pointercancel", end, true);
				}, true);
				el.addEventListener("click", function (e) {
					if (window.fxHeld || el.dataset.fxFired) {
						e.stopImmediatePropagation();
						e.preventDefault();
					}
				}, true);
			})(n);
		}
	}

	function shortName(id) {
		return "[" + String(id).replace(/^.*\//, "") + "]";
	}

	/* ============================================================
	 * 2. Recorder
	 * ============================================================ */

	var mediaRec = null, chunks = [], recTimer = null, recStart = 0, recStream = null;
	var MAX_MS = 20000;

	function buildRecorder() {
		var head = document.getElementById("libHead");
		if (!head || document.getElementById("recWrap")) {
			return !!document.getElementById("recWrap");
		}
		var wrap = document.createElement("span");
		wrap.id = "recWrap";
		wrap.innerHTML =
			'<select id="recSource" title="audio source">' +
				'<option value="mic">🎙 microphone</option>' +
				'<option value="tab">🖥 browser tab audio</option>' +
			'</select>' +
			'<button id="recBtn" type="button">● record</button>' +
			'<span id="recStatus"></span>';
		head.appendChild(wrap);
		document.getElementById("recBtn").addEventListener("click", toggleRec);
		return true;
	}

	function status(msg) {
		var s = document.getElementById("recStatus");
		if (s) { s.textContent = msg || ""; }
	}

	async function toggleRec() {
		if (mediaRec && mediaRec.state === "recording") { stopRec(); return; }
		var src = document.getElementById("recSource").value;
		try {
			if (src === "tab") {
				var disp = await navigator.mediaDevices.getDisplayMedia({
					video: true,
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
				});
				if (!disp.getAudioTracks().length) {
					disp.getTracks().forEach(function (t) { t.stop(); });
					status("no audio — re-share and tick “Share tab audio”");
					return;
				}
				disp.getVideoTracks().forEach(function (t) { t.stop(); });
				recStream = new MediaStream(disp.getAudioTracks());
			} else {
				recStream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
				});
			}
		} catch (e) {
			status(e.name === "NotAllowedError" ? "permission denied" : ("error: " + e.message));
			return;
		}

		chunks = [];
		mediaRec = new MediaRecorder(recStream);
		mediaRec.ondataavailable = function (ev) { if (ev.data.size) { chunks.push(ev.data); } };
		mediaRec.onstop = onRecStop;
		mediaRec.start();
		recStart = Date.now();
		document.getElementById("recBtn").textContent = "■ stop";
		document.getElementById("recBtn").classList.add("recording");
		recTimer = setInterval(function () {
			var s = (Date.now() - recStart) / 1000;
			status(s.toFixed(1) + "s  (auto-stop " + (MAX_MS / 1000) + "s)");
			if (Date.now() - recStart >= MAX_MS) { stopRec(); }
		}, 100);
	}

	function stopRec() {
		if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); }
	}

	/* ---- export the mix as MP3 (records the master bus, encodes with lamejs) ---- */

	var expRec = null, expChunks = [], expDest = null;

	function loadLame() {
		return new Promise(function (res, rej) {
			if (window.lamejs) { return res(); }
			var s = document.createElement("script");
			s.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
			s.onload = res; s.onerror = rej;
			document.head.appendChild(s);
		});
	}

	function wireExport() {
		var wrap = document.getElementById("recWrap");
		if (!wrap || document.getElementById("expBtn")) { return; }
		var b = document.createElement("button");
		b.id = "expBtn"; b.type = "button"; b.textContent = "⬇ mp3";
		b.title = "record the mix and export as MP3";
		b.addEventListener("click", toggleExport);
		wrap.appendChild(b);
	}

	function toggleExport() {
		var b = document.getElementById("expBtn");
		if (expRec && expRec.state === "recording") { expRec.stop(); return; }
		loadLame().then(function () {
			var raw = (window.Tone && Tone.context && (Tone.context._context || Tone.context)) || null;
			if (!raw || !raw.createMediaStreamDestination) { status("export not supported here"); return; }
			expDest = raw.createMediaStreamDestination();
			try { Tone.Master.connect(expDest); } catch (e) { status("export: routing failed"); return; }
			expChunks = [];
			expRec = new MediaRecorder(expDest.stream);
			expRec.ondataavailable = function (e) { if (e.data.size) { expChunks.push(e.data); } };
			expRec.onstop = finishExport;
			expRec.start();
			b.textContent = "■ stop & save";
			b.classList.add("recording");
			flash("recording the mix — press stop to save MP3", "tip");
		}).catch(function () { status("could not load MP3 encoder (offline?)"); });
	}

	async function finishExport() {
		var b = document.getElementById("expBtn");
		b.textContent = "⬇ mp3";
		b.classList.remove("recording");
		try { Tone.Master.disconnect(expDest); } catch (e) {}
		var raw = Tone.context._context || Tone.context;
		var buf = await new Blob(expChunks).arrayBuffer();
		var audio;
		try { audio = await raw.decodeAudioData(buf.slice(0)); }
		catch (e) { status("export: decode failed"); return; }

		status("encoding MP3…");
		var mp3 = encodeMp3(audio);
		var url = URL.createObjectURL(mp3);
		var a = document.createElement("a");
		a.href = url; a.download = "po33-mix-" + Date.now() + ".mp3"; a.textContent = "download MP3";
		a.className = "recDl";
		var s = document.getElementById("recStatus");
		s.textContent = "mix ready · ";
		s.appendChild(a);
	}

	function encodeMp3(audio) {
		var ch = Math.min(2, audio.numberOfChannels);
		var enc = new lamejs.Mp3Encoder(ch, audio.sampleRate, 128);
		var l = audio.getChannelData(0);
		var r = ch > 1 ? audio.getChannelData(1) : l;
		var block = 1152, out = [];
		var li = new Int16Array(block), ri = new Int16Array(block);
		for (var i = 0; i < l.length; i += block) {
			var n = Math.min(block, l.length - i);
			for (var j = 0; j < n; j++) {
				li[j] = Math.max(-1, Math.min(1, l[i + j])) * 32767;
				ri[j] = Math.max(-1, Math.min(1, r[i + j])) * 32767;
			}
			var chunk = ch > 1 ? enc.encodeBuffer(li.subarray(0, n), ri.subarray(0, n))
			                   : enc.encodeBuffer(li.subarray(0, n));
			if (chunk.length) { out.push(chunk); }
		}
		var end = enc.flush();
		if (end.length) { out.push(end); }
		return new Blob(out, { type: "audio/mp3" });
	}

	/* ---- IndexedDB: recordings survive a reload ---- */

	function idbOpen() {
		return new Promise(function (res, rej) {
			var r = indexedDB.open("po33", 1);
			r.onupgradeneeded = function () {
				if (!r.result.objectStoreNames.contains("rec")) { r.result.createObjectStore("rec"); }
			};
			r.onsuccess = function () { res(r.result); };
			r.onerror = function () { rej(r.error); };
		});
	}
	function idbPut(name, blob, seconds) {
		if (!window.indexedDB) { return; }
		idbOpen().then(function (db) {
			var tx = db.transaction("rec", "readwrite");
			tx.objectStore("rec").put({ blob: blob, seconds: seconds }, name);
		}).catch(function () {});
	}
	function idbRestore() {
		if (!window.indexedDB || !window.PO33Lib) { return; }
		idbOpen().then(function (db) {
			var tx = db.transaction("rec", "readonly");
			var store = tx.objectStore("rec");
			var keys = store.getAllKeys(), vals = store.getAll();
			keys.onsuccess = function () {
				vals.onsuccess = function () {
					keys.result.forEach(function (name, i) {
						var v = vals.result[i];
						if (!v || !v.blob) { return; }
						var url = URL.createObjectURL(v.blob);
						PO33Lib.addUserSample(name, url, v.seconds || null);
					});
				};
			};
		}).catch(function () {});
	}

	async function onRecStop() {
		clearInterval(recTimer);
		document.getElementById("recBtn").textContent = "● record";
		document.getElementById("recBtn").classList.remove("recording");
		if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; }

		var blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : "audio/webm" });
		var arr = await blob.arrayBuffer();

		var AC = window.AudioContext || window.webkitAudioContext;
		var ac = new AC();
		var audioBuf;
		try { audioBuf = await ac.decodeAudioData(arr.slice(0)); }
		catch (e) { status("could not decode recording"); return; }

		var wavBlob = encodeWav(audioBuf);
		var url = URL.createObjectURL(wavBlob);
		var secs = Math.round(audioBuf.duration * 100) / 100;
		var name = "rec-" + new Date().toISOString().slice(11, 19).replace(/:/g, "");

		var slot = window.PO33Lib ? PO33Lib.currentSlot() : 1;
		if (window.PO33Lib) {
			PO33Lib.addUserSample(name, url, secs);
			PO33Lib.assignUrl(slot, url, "recordings/" + name, secs);
		}
		idbPut(name, wavBlob, secs); // persist across reloads

		var s = document.getElementById("recStatus");
		s.innerHTML = "saved " + secs + 's → SOUND ' + slot + ' &nbsp;';
		var dl = document.createElement("a");
		dl.href = url; dl.download = name + ".wav"; dl.textContent = "download .wav";
		dl.className = "recDl";
		s.appendChild(dl);

		// offer to chop the fresh recording across a drum slot's 16 pads
		if (window.PO33 && PO33.slice) {
			var chop = document.createElement("button");
			chop.id = "recSlice";
			chop.type = "button";
			chop.textContent = "\u2702 chop x16";
			chop.title = "slice this recording across the 16 pads of a drum slot";
			chop.addEventListener("click", function () {
				var target = slot >= 9 ? slot : 16;
				PO33.slice.toSlot(audioBuf, target, 16, { layout: true, matchTempo: true });
			});
			s.appendChild(chop);
		}
	}

	/* minimal 16-bit PCM WAV encoder */
	function encodeWav(buf) {
		var numCh = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
		var out = new DataView(new ArrayBuffer(44 + len * numCh * 2));
		var p = 0;
		function str(s) { for (var i = 0; i < s.length; i++) { out.setUint8(p++, s.charCodeAt(i)); } }
		function u32(v) { out.setUint32(p, v, true); p += 4; }
		function u16(v) { out.setUint16(p, v, true); p += 2; }
		str("RIFF"); u32(36 + len * numCh * 2); str("WAVE");
		str("fmt "); u32(16); u16(1); u16(numCh); u32(rate);
		u32(rate * numCh * 2); u16(numCh * 2); u16(16);
		str("data"); u32(len * numCh * 2);
		var chans = [];
		for (var c = 0; c < numCh; c++) { chans.push(buf.getChannelData(c)); }
		for (var i = 0; i < len; i++) {
			for (var c2 = 0; c2 < numCh; c2++) {
				var v = Math.max(-1, Math.min(1, chans[c2][i]));
				out.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
				p += 2;
			}
		}
		return new Blob([out], { type: "audio/wav" });
	}

	/* ============================================================
	 * 3. sliders (replace the knobs), Record pad, touch shims
	 * ============================================================ */

	function wireSlider(n) {
		var el = document.getElementById("slider" + n);
		if (!el || el.dataset.wired) { return; }
		el.dataset.wired = "1";
		var apply = function () {
			window["dial" + n + "Value"] = +el.value;
			try { window.dialFunction(n); } catch (e) {}
		};
		el.addEventListener("input", function () { apply(); readout(n); });
		// mouse wheel over a slider also turns it
		el.addEventListener("wheel", function (ev) {
			ev.preventDefault();
			el.value = Math.max(0, Math.min(1000, +el.value + (ev.deltaY < 0 ? 30 : -30)));
			apply();
		}, { passive: false });
	}

	// after dialFunction has run, report what the value actually became
	function readout(n) {
		if (window.PO33 && PO33.locks && PO33.locks.held() >= 0) { return; } // lock bar owns the screen
		var st = g("state", 0), fx = g("fxMode", 0);
		var cs;
		try { cs = window.channelSettingsArr[g("selectedChannel", 0)]; } catch (e) {}
		if (st === 4) {
			flash(n === 1 ? ("swing " + Math.round(g("swing", 0) / 10) + "%")
			              : (g("tempo", 120) + " BPM"), "info");
			return;
		}
		if (!cs) { return; }
		if (fx === 1) {
			flash(n === 1
				? ((cs.fxFilterType === "lowpass" ? "LPF " : "HPF ") + Math.round(cs.fxFilterFreq) + " Hz")
				: ("resonance " + (Math.round((cs.fxFilterRes || 0) * 10) / 10)), "info");
		} else if (fx === 2) {
			flash(n === 1 ? ("start " + Math.round((cs.fxTrim || 0) / 10) + "%")
			              : ("length " + Math.round((cs.fxLength == null ? 1000 : cs.fxLength) / 10) + "%"), "info");
		} else {
			flash(n === 1 ? ("pitch " + Math.round((cs.fxPitch || 0) / 62.5))
			              : ("sample vol " + (Math.round((cs.fxVolume || 0) * 10) / 10) + " dB"), "info");
		}
	}

	var SLIDER_LABELS = {
		4: ["swing", "tempo"],       // BPM mode
		"0": ["pitch", "sample vol"],// FX: tone  (distinct from the master slider)
		"1": ["filter", "res"],      // FX: filter
		"2": ["start", "length"]     // FX: trim
	};
	function updateSliderLabels() {
		var l1 = document.getElementById("slider1Label");
		if (!l1) { return; }
		var l2 = document.getElementById("slider2Label");
		var state = g("state", 0), fxMode = g("fxMode", 0);
		var pair = state === 4 ? SLIDER_LABELS[4] : (SLIDER_LABELS["" + fxMode] || ["A", "B"]);
		l1.textContent = pair[0];
		l2.textContent = pair[1];
	}

	/* ---- clear helpers (exposed on window.PO33) ---- */

	function clearPattern() {
		var p = g("currentPattern", 0);
		try {
			for (var c = 0; c < 16; c++) {
				for (var b = 0; b < 16; b++) { window.newChannelArr[c][p][b].noteOn = 0; }
			}
			localStorage.setItem("po33_settings", JSON.stringify(window.newChannelArr, null, "  "));
			if (window.updateDisplay) { window.updateDisplay(); }
			flash("pattern " + (p + 1) + " cleared", "warn");
		} catch (e) { flash("could not clear pattern", "warn"); }
	}

	var clearAllClicks = 0, clearAllTimer;
	function clearAll(btn) {
		clearAllClicks++;
		clearTimeout(clearAllTimer);
		if (clearAllClicks >= 3) {
			clearAllClicks = 0;
			try { localStorage.clear(); } catch (e) {}
			location.reload();
			return;
		}
		var left = 3 - clearAllClicks;
		flash("clear EVERYTHING — press " + left + " more time" + (left > 1 ? "s" : ""), "warn");
		if (btn) { btn.textContent = "clear all · " + left + " more"; }
		clearAllTimer = setTimeout(function () {
			clearAllClicks = 0;
			if (btn) { btn.textContent = "clear everything (triple-click)"; }
		}, 1500);
	}

	window.PO33.clearPattern = clearPattern;
	window.PO33.clearAll = clearAll;

	/* ---- metronome (Transport-scheduled, so it stays in time) ---- */

	var metroSynth = null, metroId = null;

	function metroOn() { try { return localStorage.getItem("po33.metro") === "1"; } catch (e) { return false; } }

	function setMetro(on) {
		try { localStorage.setItem("po33.metro", on ? "1" : "0"); } catch (e) {}
		try {
            if (on) {
                if (!metroSynth) {
                    metroSynth = new Tone.Synth({
                        oscillator: { type: "square" },
                        envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 }
                    }).toMaster();
                    metroSynth.volume.value = -18;
                }
                if (metroId === null) {
                    var count = 0;
                    metroId = Tone.Transport.scheduleRepeat(function (time) {
                        metroSynth.triggerAttackRelease(count % 4 === 0 ? "C6" : "C5", "64n", time);
                        count++;
                    }, "4n");
                }
            } else if (metroId !== null) {
                Tone.Transport.clear(metroId);
                metroId = null;
            }
		} catch (e) {}
		flash("metronome " + (on ? "on" : "off"), "info");
	}

	window.PO33.metro = {
		toggle: function () { var v = !metroOn(); setMetro(v); return v; },
		isOn: metroOn
	};

	function wireVolume() {
		var el = document.getElementById("sliderVol");
		if (!el || el.dataset.wired) { return; }
		el.dataset.wired = "1";
		var apply = function (announce) {
			var pct = +el.value;                 // 0..100
			var db = pct === 0 ? -60 : (pct / 100) * 40 - 40;  // -40..0 dB
			try { if (window.Tone) { Tone.Master.volume.value = db; } } catch (e) {}
			window.volume = Math.round(pct / 100 * 16);
			window.mainVolume = db;
			if (announce) { flash("master volume " + pct + "%", "info"); }
		};
		el.addEventListener("input", function () { apply(true); });
		apply(false);
	}

	function wireRecordPad() {
		var pad = document.getElementById("btnRecord");
		var btn = document.getElementById("recBtn");
		if (!pad || !btn || pad.dataset.rec) { return; }
		pad.dataset.rec = "1";
		pad.addEventListener("click", function () { btn.click(); });
	}

	// touch shim: WRITE long-press (po33.js only listens for mousedown/mouseup),
	// and BPM double-tap (only listens for dblclick).
	function wireTouchShims() {
		var w = document.getElementById("btnWrite");
		if (w && !w.dataset.touch) {
			w.dataset.touch = "1";
			w.addEventListener("touchstart", function (e) {
				e.preventDefault();
				window.btnWriteHold = false;
				clearTimeout(window.btnWriteMouseUpTimer);
				window.btnWriteMouseUpTimer = setTimeout(function () { window.btnWriteHold = true; }, 3000);
			}, { passive: false });
			w.addEventListener("touchend", function (e) {
				e.preventDefault();
				clearTimeout(window.btnWriteMouseUpTimer);
				try { window.writeButtonFunction(); } catch (err) {}
			});
		}

		var bpm = document.getElementById("btnBPM");
		if (bpm && !bpm.dataset.touch && window.jQuery) {
			bpm.dataset.touch = "1";
			var last = 0;
			bpm.addEventListener("touchend", function () {
				var now = Date.now();
				if (now - last < 320) { jQuery(bpm).trigger("dblclick"); }
				last = now;
			});
		}
	}

	/* ============================================================
	 * boot — wait for the LCD and the library head to exist
	 * ============================================================ */

	function boot() {
		buildHud();
		wireSlider(1);
		wireSlider(2);
		wireVolume();
		wireTouchShims();
		wireFxPads();
		// FX chain is built lazily on the first FX hold — nothing to do here
		var tries = 0;
		var iv = setInterval(function () {
			var haveRec = buildRecorder();
			if (haveRec) { wireRecordPad(); wireExport(); }
			if (haveRec || ++tries > 60) { clearInterval(iv); }
		}, 250);
		setTimeout(idbRestore, 1800);
		setTimeout(function () { if (metroOn()) { setMetro(true); } }, 1200);
		setTimeout(restoreLfo, 1400);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else { boot(); }
})();
