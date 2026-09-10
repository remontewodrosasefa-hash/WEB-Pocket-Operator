/* perf.js — the live performance strip.
 *
 * The 16 pads are double-booked: in WRITE mode they're steps, so you can't play
 * while you sequence. This strip is the second surface that fixes that.
 *
 *   XY    a drag surface with three jobs, switched by the chip in its corner:
 *           TONE   muffled <-> bright, the classic filter sweep
 *           SYNTH  play a lead over the beat; left-right picks the note
 *           SPACE  throw echo and reverb on whatever is playing
 *   MUTE  one cell per sound, tap to drop a part and bring it back
 *   FX    the punch-ins as one-thumb buttons instead of hold-FX + reach
 *   KEYS  play the selected melodic sound without touching the step pads
 *
 * Exposes window.PO33.perf
 */
(function () {
	"use strict";

	var xyEl, xyCv, xyCtx, xyLabel, xyChip, panel, panelTarget, W = 0, H = 0, DPR = 1;
	var xyOn = false, xyX = 0.5, xyY = 0.2, tab = "xy";
	var latched = false;

	// What the XY pad is wired to right now. SYNTH is never latched — a lead
	// note that carries on after you lift your finger is just a stuck note.
	var XY_MODES = ["tone", "synth", "space"];
	var XY_TITLE = { tone: "TONE", synth: "SYNTH", space: "SPACE" };
	var XY_REST = { tone: "muffled \u2194 bright", synth: "play a lead", space: "echo + reverb" };
	var xyMode = "tone";

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	/* ================= XY pad ================= */

	function xyResize() {
		if (!xyCv || !xyEl) { return; }
		var r = xyEl.getBoundingClientRect();
		W = Math.max(60, Math.floor(r.width));
		H = Math.max(40, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		xyCv.width = W * DPR; xyCv.height = H * DPR;
		xyCv.style.width = W + "px"; xyCv.style.height = H + "px";
		xyCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
		xyDraw();
	}

	function xyDraw() {
		if (!xyCtx) { return; }
		xyCtx.clearRect(0, 0, W, H);
		// grid
		xyCtx.strokeStyle = "rgba(255,122,26,0.14)";
		xyCtx.lineWidth = 1;
		for (var i = 1; i < 4; i++) {
			xyCtx.beginPath();
			xyCtx.moveTo(W * i / 4, 0); xyCtx.lineTo(W * i / 4, H);
			xyCtx.moveTo(0, H * i / 4); xyCtx.lineTo(W, H * i / 4);
			xyCtx.stroke();
		}
		if (xyMode === "tone") {
			// the centre column is "no filter" — the neutral place to rest
			xyCtx.strokeStyle = "rgba(255,122,26,0.3)";
			xyCtx.beginPath(); xyCtx.moveTo(W / 2, 0); xyCtx.lineTo(W / 2, H); xyCtx.stroke();
		} else if (xyMode === "synth") {
			// one tick per playable note, so you can see where the notes are
			xyCtx.strokeStyle = "rgba(255,122,26,0.22)";
			for (var n = 0; n < 16; n++) {
				var nx = (n / 15) * W;
				xyCtx.beginPath();
				xyCtx.moveTo(nx, H - (n % 5 === 0 ? 12 : 6));
				xyCtx.lineTo(nx, H);
				xyCtx.stroke();
			}
		}

		if (!xyOn && !latched) { return; }
		var px = xyX * W, py = (1 - xyY) * H;
		xyCtx.strokeStyle = "rgba(255,122,26,0.5)";
		xyCtx.beginPath();
		xyCtx.moveTo(px, 0); xyCtx.lineTo(px, H);
		xyCtx.moveTo(0, py); xyCtx.lineTo(W, py);
		xyCtx.stroke();
		xyCtx.fillStyle = latched && !xyOn ? "#ffb060" : "#ff7a1a";
		xyCtx.beginPath(); xyCtx.arc(px, py, 8, 0, 7); xyCtx.fill();
	}

	// send the current position to whichever engine the pad is driving
	function xyApply(on) {
		if (xyMode === "synth") {
			if (window.PO33.keys) { PO33.keys.xy(xyX, xyY, on); }
		} else if (xyMode === "space") {
			if (window.PO33.fx && PO33.fx.space) { PO33.fx.space(xyX, xyY, on); }
		} else if (window.PO33.fx) {
			PO33.fx.xy(xyX, xyY, on);
		}
	}

	function xyRelease() {
		// always silence every engine, not just the current one, so switching
		// modes mid-drag can never leave something hanging
		if (window.PO33.fx) { PO33.fx.xy(0, 0, false); }
		if (window.PO33.fx && PO33.fx.space) { PO33.fx.space(0, 0, false); }
		if (window.PO33.keys) { PO33.keys.xy(0, 0, false); }
	}

	function xyReadout() {
		if (!xyLabel) { return; }
		if (!xyOn && !latched) { xyLabel.textContent = XY_REST[xyMode]; return; }
		if (xyMode === "synth") {
			var n = window.PO33.keys ? PO33.keys.note(Math.round(xyX * 15)) : "";
			xyLabel.textContent = n + "  \u00b7  tone " + Math.round(xyY * 100) + "%";
		} else if (xyMode === "space") {
			xyLabel.textContent = "echo " + Math.round(xyX * 100) +
				"%  \u00b7  reverb " + Math.round(xyY * 100) + "%";
		} else {
			xyLabel.textContent = (xyX < 0.5 ? "muffled" : "thin") +
				"  " + Math.round(xyX * 100) + "%  \u00b7  bite " + Math.round(xyY * 100) + "%";
		}
	}

	function xySet(e) {
		var r = xyCv.getBoundingClientRect();
		xyX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
		xyY = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
		xyApply(true);
		xyReadout();
		xyDraw();
	}

	function setXyMode(m) {
		xyRelease();
		xyOn = false;
		if (latched) { latched = false; if (xyEl) { xyEl.classList.remove("latched"); } }
		xyMode = m;
		if (xyChip) { xyChip.textContent = XY_TITLE[m]; }
		if (xyEl) { xyEl.setAttribute("data-mode", m); }
		xyReadout();
		xyDraw();
		flash("XY: " + XY_TITLE[m] + " \u2014 " + XY_REST[m], "tip");
	}

	function wireXY() {
		xyEl = document.getElementById("xyPad");
		xyCv = document.getElementById("xyCanvas");
		xyLabel = document.getElementById("xyLabel");
		if (!xyEl || !xyCv) { return false; }
		xyCtx = xyCv.getContext("2d");

		xyCv.addEventListener("pointerdown", function (e) {
			e.preventDefault();
			xyCv.setPointerCapture(e.pointerId);
			xyOn = true; xySet(e);
		});
		xyCv.addEventListener("pointermove", function (e) { if (xyOn) { xySet(e); } });
		var up = function () {
			if (!xyOn) { return; }
			xyOn = false;
			// synth always stops on release; the other two respect the latch
			if (!latched || xyMode === "synth") { xyRelease(); }
			xyReadout();
			xyDraw();
		};
		xyCv.addEventListener("pointerup", up);
		xyCv.addEventListener("pointercancel", up);

		// the corner chip cycles what the pad is wired to
		xyChip = document.getElementById("xyMode");
		if (xyChip) {
			xyChip.addEventListener("click", function (e) {
				e.stopPropagation();
				setXyMode(XY_MODES[(XY_MODES.indexOf(xyMode) + 1) % XY_MODES.length]);
			});
		}

		// tap the readout to latch, so an effect stays on with no finger down.
		// SYNTH is excluded: a held lead note with nothing holding it is a
		// stuck note, not a feature.
		if (xyLabel) {
			xyLabel.addEventListener("click", function (e) {
				e.stopPropagation();
				if (xyMode === "synth") { flash("synth mode can't latch", "warn"); return; }
				latched = !latched;
				xyEl.classList.toggle("latched", latched);
				if (latched) { xyApply(true); } else { xyRelease(); }
				xyReadout();
				flash(latched ? "XY latched \u2014 stays on when you let go" : "XY back to hold-to-use", "tip");
				xyDraw();
			});
		}
		setXyMode(xyMode);

		xyResize();
		if (window.ResizeObserver) { new ResizeObserver(xyResize).observe(xyEl); }
		window.addEventListener("resize", xyResize);
		return true;
	}

	/* ================= the switchable panel ================= */

	function renderMute() {
		var P = window.PO33.channels;
		var h = '<div class="perfCells mute">';
		for (var i = 0; i < 16; i++) {
			var st = P ? P.state(i) : "on";
			h += '<button data-mute="' + i + '" class="' + st + '">' + (i + 1) + '</button>';
		}
		panelTarget.innerHTML = h + '</div>';
	}

	// The 16 punch-in effects in pad order, so the grid doubles as a
	// cheat-sheet for hold-FX + pad on the hardware layout.
	function renderFx() {
		var labels = (window.PO33.fx && PO33.fx.labels) ? PO33.fx.labels() : [];
		var help = (window.PO33.fx && PO33.fx.help) ? PO33.fx.help() : [];
		var h = '<div class="perfCells fx">';
		for (var i = 1; i <= 16; i++) {
			var name = (labels[i] || i).toString().toLowerCase();
			var tip = (help[i] || name).replace(/"/g, "");
			h += '<button data-fx="' + i + '" title="' + tip + '"><b>' + i + '</b>' + name + '</button>';
		}
		panelTarget.innerHTML = h + '</div>';
	}

	// A real little keyboard rather than "the selected sample at 16 pitches".
	// The pads are laid out in a musical scale, so every note on them belongs
	// with the others; IN TIME holds each note back until the next sixteenth of
	// the beat so late fingers still land with the drums.
	function renderKeys() {
		var K = window.PO33.keys;
		if (!K) {
			panelTarget.innerHTML = '<div class="perfNote">keyboard unavailable</div>';
			return;
		}
		var h = '<div class="keysBar">' +
			'<button class="keysVoice" data-keysvoice="1">' + K.voice() + '</button>' +
			'<button class="keysFit' + (K.fit() ? " on" : "") + '" data-keysfit="1">in time</button>' +
			'<span class="keysScale">' + K.layout() + '</span>' +
			'</div><div class="perfCells keys">';
		for (var i = 0; i < 16; i++) {
			h += '<button data-key="' + i + '"><b>' + K.note(i) + '</b></button>';
		}
		panelTarget.innerHTML = h + '</div>';
	}

	function render() {
		if (!panel) { return; }
		var slot = document.getElementById("perfViews");
		if (!slot) {
			slot = document.createElement("div");
			slot.id = "perfViews";
			panel.appendChild(slot);
		}
		var showXy = tab === "xy";
		if (xyEl) { xyEl.hidden = !showXy; }
		slot.hidden = showXy;
		if (showXy) { setTimeout(xyResize, 0); return; }
		panelTarget = slot;
		if (tab === "mute") { renderMute(); }
		else if (tab === "fx") { renderFx(); }
		else { renderKeys(); }
	}

	function wirePanel() {
		panel = document.getElementById("perfPanel");
		var tabs = document.querySelectorAll(".perfTabs button");
		if (!panel || !tabs.length) { return false; }

		Array.prototype.forEach.call(tabs, function (b) {
			b.addEventListener("click", function () {
				tab = b.getAttribute("data-perf");
				Array.prototype.forEach.call(tabs, function (o) { o.classList.toggle("on", o === b); });
				render();
			});
		});

		// mute cells
		panel.addEventListener("click", function (e) {
			var m = e.target.getAttribute("data-mute");
			if (m != null && window.PO33.channels) { PO33.channels.cycle(+m); renderMute(); }
		});

		// keyboard settings
		panel.addEventListener("click", function (e) {
			var K = window.PO33.keys;
			if (!K) { return; }
			if (e.target.closest("[data-keysvoice]")) { K.nextVoice(); renderKeys(); }
			else if (e.target.closest("[data-keysfit]")) { K.toggleFit(); renderKeys(); }
		});

		/* FX and keys are hold-to-use, so they need press and release.
		 *
		 * The pointer is CAPTURED on press. Without that the browser is free to
		 * decide a small finger movement was the start of a scroll, fire
		 * pointercancel and kill the effect mid-performance — which is exactly
		 * what it was doing. Capture plus touch-action:none on the cells means
		 * the press only ends when you actually lift. Tracking is per pointer
		 * id, so two fingers on two pads behave.
		 */
		var live = {};   // pointerId -> { el, fx, key }

		panel.addEventListener("pointerdown", function (e) {
			var cell = e.target.closest("[data-fx], [data-key]");
			if (!cell) { return; }
			e.preventDefault();
			try { cell.setPointerCapture(e.pointerId); } catch (err) {}
			cell.classList.add("hot");
			var f = cell.getAttribute("data-fx");
			var k = cell.getAttribute("data-key");
			live[e.pointerId] = { el: cell, fx: f, key: k };
			if (f != null && window.PO33.fx) { PO33.fx.punch(+f, true); }
			else if (k != null && window.PO33.keys) { PO33.keys.down(+k); }
		});

		var release = function (e) {
			var rec = live[e.pointerId];
			if (!rec) { return; }
			delete live[e.pointerId];
			rec.el.classList.remove("hot");
			if (rec.fx != null && window.PO33.fx) { PO33.fx.punch(0, false); }
			if (rec.key != null && window.PO33.keys) { PO33.keys.up(+rec.key); }
		};
		panel.addEventListener("pointerup", release);
		panel.addEventListener("pointercancel", release);
		// a pointer lost without an up (tab hidden, gesture stolen) still ends
		window.addEventListener("blur", function () {
			Object.keys(live).forEach(function (id) { release({ pointerId: +id }); });
			if (window.PO33.keys) { PO33.keys.allOff(); }
		});

		render();
		// keep the mute view honest if solo/mute changes elsewhere
		setInterval(function () { if (tab === "mute" && panel.offsetParent !== null) { renderMute(); } }, 700);
		return true;
	}

	window.PO33 = window.PO33 || {};
	window.PO33.perf = { render: render, tab: function () { return tab; } };

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			var a = wireXY(), b = wirePanel();
			if ((a && b) || ++tries > 100) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
