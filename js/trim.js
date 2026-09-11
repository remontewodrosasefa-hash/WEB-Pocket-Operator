/* trim.js — waveform trim editor.
 * Appears over the LCD whenever the sliders are in TRIM mode (press FX to cycle
 * to TRIM). Two handles set start / length for the selected sound; the engine
 * already reads channelSettingsArr[ch].fxTrim / .fxLength (0–1000 scale).
 */
(function () {
	"use strict";

	var wrap, canvas, ctx, hStart, hEnd, shadeL, shadeR, label, note, bpmRow, bpmText;
	var curChannel = -1, curBufKey = "";
	var dragging = null;
	var count = 8;                      // chop into any number of pieces, 1-16

	function setCount(n) {
		count = Math.max(1, Math.min(16, n));
		var el = document.getElementById("tvCount");
		if (el) { el.textContent = count; }
	}

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }

	/* ---------- get the AudioBuffer for the selected sound ---------- */

	function selectedBuffer() {
		var ch = g("selectedChannel", 0);
		try {
			if (ch < 8) {
				var b = window.melodicArr[ch].buffers.get(61);
				return b && (b.get ? b.get() : b._buffer) || null;
			}
			var pitch = 0;
			try { pitch = window.channelSettingsArr[ch].notePitch % 16; } catch (e) {}
			var p = window.drumArr[ch - 8].get(window.noteArray[pitch]);
			var tb = p && p.buffer;
			return tb && (tb.get ? tb.get() : tb._buffer) || null;
		} catch (e) { return null; }
	}

	/* ---------- build ---------- */

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || document.getElementById("trimView")) { return true; }
		wrap = document.createElement("div");
		wrap.id = "trimView";
		wrap.hidden = true;
		wrap.innerHTML =
			'<div class="tvHead"><span id="tvLabel">TRIM</span>' +
				'<span><button type="button" data-tv="prev">&#9654; preview</button>' +
				'<button type="button" data-tv="all" title="steps already placed in this pattern keep the OLD trim until you press this">apply trim to steps</button></span></div>' +
			'<div id="tvWave">' +
				'<canvas id="tvCanvas"></canvas>' +
				'<div class="tvShade" id="tvShadeL"></div><div class="tvShade" id="tvShadeR"></div>' +
				'<div class="tvHandle" id="tvStart"></div><div class="tvHandle" id="tvEnd"></div>' +
			'</div>' +
			'<div id="tvBpm" hidden><span id="tvBpmText"></span>' +
				'<button type="button" data-tv="setbpm" id="tvBpmBtn">set BPM</button></div>' +
			'<div id="tvSlice">' +
				'<span id="tvDest">chop:</span>' +
				'<button type="button" data-tv="less">&minus;</button>' +
				'<b id="tvCount">8</b>' +
				'<button type="button" data-tv="more">+</button>' +
				'<button type="button" data-tv="go" id="tvGo">chop</button>' +
				'<button type="button" data-tv="pitch" id="tvPitch">&#9834; pitch</button>' +
				'<label><input type="checkbox" id="tvLayout" checked> lay out + match tempo</label>' +
			'</div>' +
			'<div id="tvNote">drag handles &mdash; the pads now preview the trimmed sound live &middot; ' +
				'“apply trim to steps” re-trims steps you already placed &middot; ' +
				'chop spreads slices across the 16 pads</div>';
		hud.appendChild(wrap);

		canvas = wrap.querySelector("#tvCanvas");
		ctx = canvas.getContext("2d");
		hStart = wrap.querySelector("#tvStart");
		hEnd = wrap.querySelector("#tvEnd");
		shadeL = wrap.querySelector("#tvShadeL");
		shadeR = wrap.querySelector("#tvShadeR");
		label = wrap.querySelector("#tvLabel");
		note = wrap.querySelector("#tvNote");
		bpmRow = wrap.querySelector("#tvBpm");
		bpmText = wrap.querySelector("#tvBpmText");

		hStart.addEventListener("pointerdown", startDrag("start"));
		hEnd.addEventListener("pointerdown", startDrag("end"));
		wrap.addEventListener("click", function (e) {
			var a = e.target.getAttribute("data-tv");
			if (a === "prev") { preview(); }
			else if (a === "all") { applyToPattern(); }
			else if (a === "pitch") { doPitch(); }
			else if (a === "less") { setCount(count - 1); }
			else if (a === "more") { setCount(count + 1); }
			else if (a === "go") { doSlice(count); }
			else if (a === "setbpm") { applyBpm(); }
		});
		return true;
	}

	function startDrag(which) {
		return function (e) {
			e.preventDefault();
			dragging = which;
			var move = function (ev) {
				var r = wrap.querySelector("#tvWave").getBoundingClientRect();
				var f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
				var ch = g("selectedChannel", 0);
				var cs = window.channelSettingsArr[ch];
				var startF = (cs.fxTrim || 0) / 1000;
				var lenF = (cs.fxLength == null ? 1000 : cs.fxLength) / 1000;
				var endF = Math.min(1, startF + lenF);
				if (which === "start") { startF = Math.min(f, endF - 0.02); }
				else { endF = Math.max(f, startF + 0.02); }
				cs.fxTrim = Math.round(startF * 1000);
				cs.fxLength = Math.round((endF - startF) * 1000);
				window.dial1Value = cs.fxTrim;
				window.dial2Value = cs.fxLength;
				layout();
			};
			var up = function () {
				dragging = null;
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up);
		};
	}

	/* ---------- draw ---------- */

	function drawWave(buf) {
		var w = canvas.width = canvas.clientWidth || 260;
		var h = canvas.height = canvas.clientHeight || 70;
		ctx.clearRect(0, 0, w, h);
		if (!buf) {
			ctx.fillStyle = "rgba(27,36,17,0.5)";
			ctx.fillText("no sample loaded", 8, h / 2);
			return;
		}
		var data = buf.getChannelData(0);
		var step = Math.max(1, Math.floor(data.length / w));
		ctx.strokeStyle = "rgba(27,36,17,0.75)";
		ctx.beginPath();
		for (var x = 0; x < w; x++) {
			var min = 1, max = -1;
			for (var i = 0; i < step; i++) {
				var v = data[x * step + i] || 0;
				if (v < min) { min = v; }
				if (v > max) { max = v; }
			}
			ctx.moveTo(x + 0.5, (1 + min) * h / 2);
			ctx.lineTo(x + 0.5, (1 + max) * h / 2);
		}
		ctx.stroke();
	}

	function layout() {
		var ch = g("selectedChannel", 0);
		var cs = window.channelSettingsArr && window.channelSettingsArr[ch];
		if (!cs) { return; }
		var startF = (cs.fxTrim || 0) / 1000;
		var lenF = (cs.fxLength == null ? 1000 : cs.fxLength) / 1000;
		var endF = Math.min(1, startF + lenF);
		hStart.style.left = (startF * 100) + "%";
		hEnd.style.left = (endF * 100) + "%";
		shadeL.style.width = (startF * 100) + "%";
		shadeR.style.left = (endF * 100) + "%";
		shadeR.style.width = ((1 - endF) * 100) + "%";
		// the guide tells people to read the sample's length off this screen to
		// work out a matching BPM — it needs to actually be here to do that
		var buf = selectedBuffer();
		var durTxt = "";
		if (buf && buf.duration) {
			var total = buf.duration, sel = total * lenF;
			durTxt = "  " + sel.toFixed(2) + "s of " + total.toFixed(2) + "s";
			showBpmMatch(sel);
		} else if (bpmRow) {
			bpmRow.hidden = true;
		}
		if (label) {
			label.textContent = "TRIM · SOUND " + (ch + 1) +
				"  " + Math.round(startF * 100) + "%–" + Math.round(endF * 100) + "%" + durTxt;
		}
		var dest = document.getElementById("tvDest");
		if (dest && window.PO33 && PO33.slice && PO33.slice.target) {
			var t = PO33.slice.target();
			dest.textContent = "chop \u2192 SOUND " + t + ":";
			dest.title = t === (ch + 1)
				? "chops replace this slot's 16 pads"
				: "melodic slots hold one sample, so chops land on drum SOUND " + t;
		}
	}

	/* ---------- BPM to match the trimmed selection ----------
	 * One bar of the sequencer is 16 steps = 4 beats, so a sample that should
	 * fill exactly one bar wants BPM = 240 / (its length in seconds). Doing
	 * this by hand is the one bit of arithmetic in the whole app, so the trim
	 * screen works it out and offers to set it.
	 */
	function matchBpm(seconds) {
		if (!seconds || seconds <= 0) { return null; }
		var bpm = Math.round(240 / seconds);
		return (bpm >= 40 && bpm <= 300) ? bpm : null;   // outside this, one bar isn't a sane fit
	}

	function showBpmMatch(seconds) {
		if (!bpmRow || !bpmText) { return; }
		var bpm = matchBpm(seconds);
		if (bpm == null) { bpmRow.hidden = true; return; }
		bpmRow.hidden = false;
		bpmRow.dataset.bpm = bpm;
		var cur = g("tempo", 120);
		bpmText.textContent = "→ " + bpm + " BPM fills one bar" +
			(cur === bpm ? " ✓" : "");
		var btn = wrap.querySelector("#tvBpmBtn");
		if (btn) { btn.disabled = (cur === bpm); btn.textContent = cur === bpm ? "already set" : "set BPM"; }
	}

	function applyBpm() {
		var bpm = bpmRow && +bpmRow.dataset.bpm;
		if (!bpm) { return; }
		try {
			window.tempo = bpm;
			Tone.Transport.bpm.value = bpm;
			if (window.PO33 && PO33.session) { PO33.session.save(); }
		} catch (e) {}
		say(bpm + " BPM — the trimmed sample now fills exactly one bar");
		layout();
	}

	/* ---------- feedback ---------- */

	// the trim panel covers the HUD, so its own messages must render inside it
	var sayTimer;
	function say(msg, keep) {
		if (note) {
			note.textContent = msg;
			clearTimeout(sayTimer);
			if (!keep) {
				sayTimer = setTimeout(function () {
					note.innerHTML = "drag handles to trim &middot; chop spreads slices across the 16 pads";
				}, 2600);
			}
		}
		if (window.PO33 && PO33.flash) { PO33.flash(msg, "tip"); }
	}

	/* ---------- preview / apply ---------- */

	function preview() {
		var buf = selectedBuffer();
		if (!buf || !window.Tone) { return; }
		var ch = g("selectedChannel", 0);
		var cs = window.channelSettingsArr[ch];
		var off = buf.duration * (cs.fxTrim || 0) / 1000;
		var dur = buf.duration * (cs.fxLength == null ? 1000 : cs.fxLength) / 1000;
		try {
			var raw = Tone.context._context || Tone.context;
			var src = raw.createBufferSource();
			src.buffer = buf;
			src.connect(raw.destination);
			src.start(0, off, Math.max(0.02, dur));
		} catch (e) {}
	}

	function applyToPattern() {
		var ch = g("selectedChannel", 0);
		var p = g("currentPattern", 0);
		var cs, n = 0;
		try { cs = window.channelSettingsArr[ch]; } catch (e) {}
		if (!cs) { say("no sound selected"); return; }
		try {
			for (var b = 0; b < 16; b++) {
				var beat = window.newChannelArr[ch][p][b];
				if (beat && beat.noteOn) {
					beat.fxTrim = cs.fxTrim;
					beat.fxLength = cs.fxLength;
					beat.locked = 1;
					n++;
				}
			}
			try { window.PO33.session.save(); } catch (e2) {}
		} catch (e) {
			say("couldn't apply: " + e.message);
			return;
		}
		if (n === 0) {
			say("SOUND " + (ch + 1) + " has no steps in pattern " + (p + 1) + " yet");
		} else {
			say("trim applied to " + n + " step" + (n > 1 ? "s" : "") + " of pattern " + (p + 1));
		}
	}

	// load the trimmed region onto a melodic slot so the 16 pads play it at
	// 16 pitches — what a piano phrase actually wants
	function doPitch() {
		if (!window.PO33 || !PO33.slice || !PO33.slice.toPitched) { say("not available"); return; }
		var ch = g("selectedChannel", 0);
		var cs;
		try { cs = window.channelSettingsArr[ch]; } catch (e) {}
		if (!cs) { say("no sound selected"); return; }
		var from = (cs.fxTrim || 0) / 1000;
		var len = (cs.fxLength == null ? 1000 : cs.fxLength) / 1000;
		var dest = ch < 8 ? ch + 1 : 1;                 // melodic slots only
		if (PO33.slice.toPitched(dest, { from: from, to: Math.min(1, from + len) })) {
			curBufKey = "";
			say("SOUND " + dest + " \u00b7 16 pads now play it at 16 pitches");
		} else {
			say("couldn't load it as a pitched sound");
		}
	}

	function doSlice(n) {
		if (!window.PO33 || !PO33.slice) { say("slicer not loaded"); return; }
		var buf = selectedBuffer();
		if (!buf) { say("no sample on SOUND " + (g("selectedChannel", 0) + 1)); return; }
		var lay = wrap.querySelector("#tvLayout");
		var opts = { layout: !!(lay && lay.checked), matchTempo: !!(lay && lay.checked) };
		var sel = g("selectedChannel", 0) + 1;
		var target = sel >= 9 ? sel : 16;
		var ok = false;
		try { ok = PO33.slice.current(n, opts); }
		catch (e) { say("slice failed: " + e.message); return; }
		if (ok) {
			curBufKey = "";                       // force a redraw of the new pad buffer
			var mode = (PO33.slice.cutMode && PO33.slice.cutMode() === "transient")
				? "on transients" : "evenly";
			say("chopped x" + n + " " + mode + " \u2192 SOUND " + target + " pads" +
				(opts.layout ? ", laid out on its 16 steps" : "") +
				(target !== sel ? " (select SOUND " + target + " to play it)" : ""));
		} else {
			say("couldn't chop — sample too short?");
		}
	}

	/* ---------- show / hide loop ---------- */

	var forced = null;                  // set by the TRIM button; null = follow FX mode

	function toggle() {
		forced = !(forced === null ? (g("fxMode", 0) === 2) : forced);
		if (forced && window.PO33 && PO33.util) { PO33.util.hide(); }
		poll();
	}
	function close() { forced = false; poll(); }

	function poll() {
		var active = (forced === null) ? (g("fxMode", 0) === 2) : forced;
		if (!wrap) { if (!build()) { return; } }
		if (active === !wrap.hidden) {
			// still open — refresh if the selected sound or its buffer changed
			if (active) {
				var ch = g("selectedChannel", 0);
				var buf = selectedBuffer();
				var key = ch + "|" + (buf ? buf.length : 0);
				if (key !== curBufKey) { curBufKey = key; drawWave(buf); layout(); }
				else if (!dragging) { layout(); }
			}
			return;
		}
		wrap.hidden = !active;
		document.body.classList.toggle("trimOpen", active);
		if (active) {
			curBufKey = "";
			setTimeout(function () { drawWave(selectedBuffer()); layout(); }, 30);
		}
	}

	window.PO33 = window.PO33 || {};
	window.PO33.trim = { toggle: toggle, close: close };

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (document.getElementById("lcdHud")) {
				build();
				var tb = document.getElementById("btnTrim");
				if (tb) { tb.addEventListener("click", toggle); }
				setCount(count);
				clearInterval(iv);
				setInterval(poll, 180);
			}
			else if (++tries > 80) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
