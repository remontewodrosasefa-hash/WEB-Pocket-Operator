/* trim.js — waveform trim editor.
 * Appears over the LCD whenever the sliders are in TRIM mode (press FX to cycle
 * to TRIM). Two handles set start / length for the selected sound; the engine
 * already reads channelSettingsArr[ch].fxTrim / .fxLength (0–1000 scale).
 */
(function () {
	"use strict";

	var wrap, canvas, ctx, hStart, hEnd, shadeL, shadeR, label, note;
	var curChannel = -1, curBufKey = "";
	var dragging = null;

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
				'<button type="button" data-tv="all">apply to pattern</button></span></div>' +
			'<div id="tvWave">' +
				'<canvas id="tvCanvas"></canvas>' +
				'<div class="tvShade" id="tvShadeL"></div><div class="tvShade" id="tvShadeR"></div>' +
				'<div class="tvHandle" id="tvStart"></div><div class="tvHandle" id="tvEnd"></div>' +
			'</div>' +
			'<div id="tvSlice">' +
				'<span>chop:</span>' +
				'<button type="button" data-tv="s4">4</button>' +
				'<button type="button" data-tv="s8">8</button>' +
				'<button type="button" data-tv="s16">16</button>' +
				'<label><input type="checkbox" id="tvLayout" checked> lay out + match tempo</label>' +
			'</div>' +
			'<div id="tvNote">drag handles to trim &middot; chop spreads slices across the 16 pads</div>';
		hud.appendChild(wrap);

		canvas = wrap.querySelector("#tvCanvas");
		ctx = canvas.getContext("2d");
		hStart = wrap.querySelector("#tvStart");
		hEnd = wrap.querySelector("#tvEnd");
		shadeL = wrap.querySelector("#tvShadeL");
		shadeR = wrap.querySelector("#tvShadeR");
		label = wrap.querySelector("#tvLabel");
		note = wrap.querySelector("#tvNote");

		hStart.addEventListener("pointerdown", startDrag("start"));
		hEnd.addEventListener("pointerdown", startDrag("end"));
		wrap.addEventListener("click", function (e) {
			var a = e.target.getAttribute("data-tv");
			if (a === "prev") { preview(); }
			else if (a === "all") { applyToPattern(); }
			else if (a && a.charAt(0) === "s") { doSlice(parseInt(a.slice(1), 10)); }
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
		if (label) {
			label.textContent = "TRIM · SOUND " + (ch + 1) +
				"  " + Math.round(startF * 100) + "%–" + Math.round(endF * 100) + "%";
		}
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
		var cs = window.channelSettingsArr[ch];
		var p = g("currentPattern", 0);
		try {
			for (var b = 0; b < 16; b++) {
				var beat = window.newChannelArr[ch][p][b];
				if (beat.noteOn) { beat.fxTrim = cs.fxTrim; beat.fxLength = cs.fxLength; }
			}
			if (window.PO33 && PO33.flash) { PO33.flash("trim applied to pattern " + (p + 1), "tip"); }
		} catch (e) {}
	}

	function doSlice(n) {
		if (!window.PO33 || !PO33.slice) { return; }
		var lay = wrap.querySelector("#tvLayout");
		var opts = { layout: !!(lay && lay.checked), matchTempo: !!(lay && lay.checked) };
		if (PO33.slice.current(n, opts)) {
			curBufKey = "";                       // force a redraw of the new pad buffer
		}
	}

	/* ---------- show / hide loop ---------- */

	function poll() {
		var active = g("fxMode", 0) === 2;
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

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (document.getElementById("lcdHud")) { build(); clearInterval(iv); setInterval(poll, 180); }
			else if (++tries > 80) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
