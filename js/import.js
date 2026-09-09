/* import.js — get audio INTO the sampler without the microphone.
 *
 * A phone browser can't capture another app's audio (Android has no
 * getDisplayMedia audio, iOS has no getDisplayMedia at all) — the OS sandboxes
 * it. These are the routes that do work on a phone:
 *
 *   1. Pick an audio file  ........ <input type=file>, works on iOS + Android
 *   2. Pick a video / screen-recording — audio track is extracted
 *   3. Share Target ............... Android: share audio to the installed PWA
 *
 * Everything lands on the currently selected sound slot, same as a recording.
 */
(function () {
	"use strict";

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }
	function status(msg) {
		var s = document.getElementById("recStatus");
		if (s) { s.textContent = msg; }
	}

	/* ---------- hold-a-pad-to-target ----------
	 * On the real PO-33 you hold the sound key while you sample, so the audio
	 * lands where your finger is. Same here: hold any pad while you hit record
	 * or import and it targets that slot instead of the selected one.
	 */
	var heldPad = null;

	function wireHold() {
		if (document.documentElement.dataset.padHold) { return; }
		document.documentElement.dataset.padHold = "1";
		document.addEventListener("pointerdown", function (e) {
			var el = e.target.closest && e.target.closest("[id^='btn']");
			if (!el) { return; }
			var m = /^btn([1-9]|1[0-6])$/.exec(el.id);
			if (m) { heldPad = +m[1]; }
		}, true);
		var clear = function () { heldPad = null; };
		document.addEventListener("pointerup", clear, true);
		document.addEventListener("pointercancel", clear, true);
	}

	// where the next sample should land
	function targetSlot() {
		if (heldPad) { return heldPad; }
		return window.PO33Lib ? PO33Lib.currentSlot() : 1;
	}

	function rawCtx() {
		try { return (window.Tone && (Tone.context._context || Tone.context)) || new (window.AudioContext || window.webkitAudioContext)(); }
		catch (e) { return new (window.AudioContext || window.webkitAudioContext)(); }
	}

	/* ---------- decoding ---------- */

	// Straight decode first; containers the decoder rejects (mp4/mov screen
	// recordings) get played through a <video> and captured in real time.
	function decode(file) {
		return file.arrayBuffer().then(function (buf) {
			return new Promise(function (res, rej) {
				rawCtx().decodeAudioData(buf.slice(0), res, rej);
			});
		}).catch(function () {
			return viaMediaElement(file);
		});
	}

	function viaMediaElement(file) {
		return new Promise(function (res, rej) {
			var url = URL.createObjectURL(file);
			var el = document.createElement(/^video/.test(file.type) ? "video" : "audio");
			el.src = url;
			el.muted = true;
			el.playsInline = true;
			el.onerror = function () { URL.revokeObjectURL(url); rej(new Error("unreadable file")); };
			el.onloadedmetadata = function () {
				var dur = Math.min(30, el.duration || 20);
				var stream = el.captureStream ? el.captureStream()
					: (el.mozCaptureStream ? el.mozCaptureStream() : null);
				if (!stream || !stream.getAudioTracks().length) {
					URL.revokeObjectURL(url);
					rej(new Error("no audio track"));
					return;
				}
				status("extracting audio… " + Math.round(dur) + "s");
				var chunks = [];
				var mr = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
				mr.ondataavailable = function (e) { if (e.data.size) { chunks.push(e.data); } };
				mr.onstop = function () {
					el.pause(); URL.revokeObjectURL(url);
					new Blob(chunks).arrayBuffer().then(function (b) {
						rawCtx().decodeAudioData(b.slice(0), res, rej);
					});
				};
				mr.start();
				el.play().catch(function () {});
				setTimeout(function () { try { mr.stop(); } catch (e) {} }, dur * 1000 + 200);
			};
		});
	}

	/* ---------- WAV so it can be stored + downloaded ---------- */

	function encodeWav(buf) {
		var numCh = Math.min(2, buf.numberOfChannels), len = buf.length, rate = buf.sampleRate;
		var out = new DataView(new ArrayBuffer(44 + len * numCh * 2)), p = 0;
		function str(s) { for (var i = 0; i < s.length; i++) { out.setUint8(p++, s.charCodeAt(i)); } }
		function u32(v) { out.setUint32(p, v, true); p += 4; }
		function u16(v) { out.setUint16(p, v, true); p += 2; }
		str("RIFF"); u32(36 + len * numCh * 2); str("WAVE");
		str("fmt "); u32(16); u16(1); u16(numCh); u32(rate);
		u32(rate * numCh * 2); u16(numCh * 2); u16(16);
		str("data"); u32(len * numCh * 2);
		var ch = [];
		for (var c = 0; c < numCh; c++) { ch.push(buf.getChannelData(c)); }
		for (var i = 0; i < len; i++) {
			for (var c2 = 0; c2 < numCh; c2++) {
				var v = Math.max(-1, Math.min(1, ch[c2][i]));
				out.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true); p += 2;
			}
		}
		return new Blob([out], { type: "audio/wav" });
	}

	/* ---------- the shared landing path ---------- */

	function land(file) {
		if (!file) { return; }
		status("reading " + (file.name || "file") + "…");
		decode(file).then(function (audio) {
			var wav = encodeWav(audio);
			var url = URL.createObjectURL(wav);
			var secs = Math.round(audio.duration * 100) / 100;
			var base = (file.name || "import").replace(/\.[^.]+$/, "").slice(0, 18) || "import";
			var name = base + "-" + String(Date.now()).slice(-4);
			var slot = targetSlot();

			if (window.PO33Lib) {
				PO33Lib.addUserSample(name, url, secs);
				PO33Lib.assignUrl(slot, url, "recordings/" + name, secs);
			}
			if (window.PO33 && PO33.idbPut) { PO33.idbPut(name, wav, secs); }

			var s = document.getElementById("recStatus");
			if (s) {
				s.innerHTML = "imported " + secs + "s → SOUND " + slot + " &nbsp;";
				var a = document.createElement("a");
				a.href = url; a.download = name + ".wav"; a.textContent = "download .wav";
				a.className = "recDl";
				s.appendChild(a);
			}
			flash("imported → SOUND " + slot, "tip");
		}).catch(function (e) {
			status("couldn't read that file (" + (e && e.message ? e.message : "unsupported") + ")");
			flash("import failed — try a .wav / .m4a / .mp3", "warn");
		});
	}

	window.PO33 = window.PO33 || {};
	window.PO33.importFile = land;
	window.PO33.heldPad = function () { return heldPad; };
	window.PO33.targetSlot = targetSlot;

	/* ---------- UI: a file button in the recorder bar ---------- */

	function build() {
		var wrap = document.getElementById("recWrap");
		if (!wrap || document.getElementById("impBtn")) { return !!wrap; }

		var inp = document.createElement("input");
		inp.type = "file";
		inp.id = "impFile";
		inp.accept = "audio/*,video/*";
		inp.style.display = "none";
		inp.addEventListener("change", function () {
			if (inp.files && inp.files[0]) { land(inp.files[0]); }
			inp.value = "";
		});

		var btn = document.createElement("button");
		btn.id = "impBtn";
		btn.type = "button";
		btn.textContent = "📂 import";
		btn.title = "load an audio file, or a screen recording, from this device";
		btn.addEventListener("click", function () { inp.click(); });

		wrap.appendChild(inp);
		wrap.appendChild(btn);
		return true;
	}

	/* ---------- Share Target: a file shared into the installed PWA ---------- */

	function checkShared() {
		if (location.search.indexOf("shared=1") === -1 || !window.caches) { return; }
		caches.open("po33-share").then(function (c) {
			return c.match("shared-audio").then(function (res) {
				if (!res) { return; }
				return res.blob().then(function (b) {
					var name = res.headers.get("X-Filename") || "shared-audio";
					land(new File([b], name, { type: b.type || "audio/*" }));
					c.delete("shared-audio");
					history.replaceState({}, "", location.pathname);
				});
			});
		}).catch(function () {});
	}

	function boot() {
		wireHold();
		var tries = 0;
		var iv = setInterval(function () {
			if (build() || ++tries > 80) { clearInterval(iv); }
		}, 250);
		setTimeout(checkShared, 1500);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
