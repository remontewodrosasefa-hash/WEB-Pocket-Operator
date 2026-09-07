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

	function g(name, dflt) {
		return (typeof window[name] !== "undefined") ? window[name] : dflt;
	}

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
			'<div id="hudSteps"></div>';
		lcd.appendChild(hud);

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
		wireTouchShims();
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
