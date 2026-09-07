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
		tick();
		setInterval(tick, 90);
	}

	function tick() {
		var mode = g("mode", 0), state = g("state", 0), view = g("view", 0);
		var play = g("play", false);
		var sel = g("selectedChannel", 0);
		var pat = g("currentPattern", 0);
		var tempo = g("tempo", 120), swing = g("swing", 0), vol = g("volume", 8);
		var beat = g("beatCount", 0);
		var fxMode = g("fxMode", 0);

		var effState = state || mode;
		var modeEl = document.getElementById("hudMode");
		var mainEl = document.getElementById("hudMain");
		var subEl = document.getElementById("hudSub");
		if (!modeEl) { return; }

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

		var clockEl = document.getElementById("hudClock");
		if (clockEl) {
			var now = new Date();
			clockEl.textContent = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
		}

		var kids = document.getElementById("hudSteps").children;
		for (var i = 0; i < 16; i++) {
			var on = false, cur = play && i === beat;
			try { on = !!(window.newChannelArr && newChannelArr[sel][pat][i].noteOn); } catch (e) {}
			kids[i].className = (on ? "on" : "") + (cur ? " cur" : "");
		}

		var artEl = document.getElementById("hudArt");
		var wantArt = ART_BY_MODE[effState] || "jebena";
		if (artEl && artEl.dataset.art !== wantArt) {
			artEl.dataset.art = wantArt;
			artEl.innerHTML = ART[wantArt];
		}

		// live hint while FX is held (punch-in effects land in a later build)
		if (window.fxHeld && !flashTimer) {
			flash("FX held · " + (FX_NAMES[fxMode] || "TONE") + " — release to keep", "tip");
		}
	}

	// screen reacts to every control: show what it does, or that it did nothing
	function wireFeedback() {
		document.addEventListener("click", function (e) {
			var item = e.target.closest("[id^='btn']");
			if (!item) { return; }
			var id = item.id;
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

	function crushBits(n) {
		if (!fxNodes) { return; }
		try { fxNodes.crush.bits = n; } catch (e) {}
		try { fxNodes.crush.bits.value = n; } catch (e) {}
	}
	function pitchTo(semis) {
		if (!fxNodes) { return; }
		try { fxNodes.pitch.pitch = semis; } catch (e) {}
	}
	function ramp(sig, val, t) { try { sig.rampTo(val, t); } catch (e) { try { sig.value = val; } catch (e2) {} } }

	function buildFxChain() {
		if (fxNodes || !window.Tone || !window.meter) { return; }
		try {
			var M = Tone.Master;
			var hp = new Tone.Filter(20, "highpass");
			var lp = new Tone.Filter(20000, "lowpass");
			var crush = new Tone.BitCrusher(16);
			var delay = new Tone.FeedbackDelay(0.19, 0.34);
			var pitch = new Tone.PitchShift(0);
			var trem = new Tone.Tremolo(13, 0);
			try { trem.start(); } catch (e) {}

			hp.chain(lp, crush, delay, pitch, trem, M);   // build the whole chain first

			var rerouted = false;
			try {
				try { meter.disconnect(); } catch (e) { try { meter.disconnect(0); } catch (e2) {} }
				meter.connect(hp);
				rerouted = true;
			} catch (e) {
				// couldn't splice — put the meter straight back to Master
				try { meter.connect(M); } catch (e2) {}
			}
			if (!rerouted) { return; }

			fxNodes = { hp: hp, lp: lp, crush: crush, delay: delay, pitch: pitch, trem: trem };
			ramp(delay.wet, 0, 0.01);
			flash("FX ready — hold FX + pads 1-8", "tip");
		} catch (e) {
			fxNodes = null;
		}
	}

	var FX_LABELS = ["", "CRUSH", "LO-FI", "FILTER DOWN", "FILTER UP", "DELAY", "STUTTER", "PITCH UP", "PITCH DOWN"];

	function fxOn(n) {
		window.fxWasUsed = true;
		flash("FX " + n + " · " + (FX_LABELS[n] || ""), "warn");
		if (!fxNodes) { return; }
		var f = fxNodes;
		switch (n) {
			case 1: crushBits(4); break;
			case 2: ramp(f.lp.frequency, 700, 0.05); crushBits(6); break;
			case 3: ramp(f.lp.frequency, 240, 0.12); break;
			case 4: ramp(f.hp.frequency, 1800, 0.12); break;
			case 5: ramp(f.delay.wet, 0.55, 0.04); break;
			case 6: ramp(f.trem.depth, 1, 0.02); break;
			case 7: pitchTo(7); break;
			case 8: pitchTo(-5); break;
		}
	}

	function fxOff() {
		if (!fxNodes) { return; }
		var f = fxNodes;
		ramp(f.lp.frequency, 20000, 0.12);
		ramp(f.hp.frequency, 20, 0.12);
		ramp(f.delay.wet, 0, 0.12);
		ramp(f.trem.depth, 0, 0.06);
		pitchTo(0);
		crushBits(16);
	}

	function wireFxPads() {
		for (var n = 1; n <= 8; n++) {
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

		var s = document.getElementById("recStatus");
		s.innerHTML = "saved " + secs + 's → SOUND ' + slot + ' &nbsp;';
		var dl = document.createElement("a");
		dl.href = url; dl.download = name + ".wav"; dl.textContent = "download .wav";
		dl.className = "recDl";
		s.appendChild(dl);
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
		el.addEventListener("input", apply);
		// mouse wheel over a slider also turns it
		el.addEventListener("wheel", function (ev) {
			ev.preventDefault();
			el.value = Math.max(0, Math.min(1000, +el.value + (ev.deltaY < 0 ? 30 : -30)));
			apply();
		}, { passive: false });
	}

	var SLIDER_LABELS = {
		4: ["swing", "tempo"],       // BPM mode
		"0": ["pitch", "volume"],    // FX: tone
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
		// splice the FX chain once Tone + the engine's meter exist
		var fxTries = 0;
		var fxIv = setInterval(function () {
			if (window.Tone && window.meter) { buildFxChain(); clearInterval(fxIv); }
			else if (++fxTries > 80) { clearInterval(fxIv); }
		}, 200);
		var tries = 0;
		var iv = setInterval(function () {
			var haveRec = buildRecorder();
			if (haveRec) { wireRecordPad(); }
			if (haveRec || ++tries > 60) { clearInterval(iv); }
		}, 250);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else { boot(); }
})();
