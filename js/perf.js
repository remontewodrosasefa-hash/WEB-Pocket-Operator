/* perf.js — the live performance strip.
 *
 * The 16 pads are double-booked: in WRITE mode they're steps, so you can't play
 * while you sequence. This strip is the second surface that fixes that.
 *
 *   XY    always visible — drag for filter cutoff (x) and resonance (y)
 *   MUTE  one cell per sound, tap to drop a part and bring it back
 *   FX    the punch-ins as one-thumb buttons instead of hold-FX + reach
 *   KEYS  play the selected melodic sound without touching the step pads
 *
 * Exposes window.PO33.perf
 */
(function () {
	"use strict";

	var xyEl, xyCv, xyCtx, xyLabel, panel, panelTarget, W = 0, H = 0, DPR = 1;
	var xyOn = false, xyX = 0.5, xyY = 0.2, tab = "xy";
	var latched = false;

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
		// centre line = filter bypass
		xyCtx.strokeStyle = "rgba(255,122,26,0.3)";
		xyCtx.beginPath(); xyCtx.moveTo(W / 2, 0); xyCtx.lineTo(W / 2, H); xyCtx.stroke();

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

	function xySet(e) {
		var r = xyCv.getBoundingClientRect();
		xyX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
		xyY = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
		if (window.PO33.fx) { PO33.fx.xy(xyX, xyY, true); }
		if (xyLabel) {
			xyLabel.textContent = (xyX < 0.5 ? "LPF" : "HPF") +
				"  " + Math.round(xyX * 100) + "%  ·  RES " + Math.round(xyY * 100) + "%";
		}
		xyDraw();
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
			if (!latched && window.PO33.fx) {
				PO33.fx.xy(0, 0, false);
				if (xyLabel) { xyLabel.textContent = "FILTER / RES"; }
			}
			xyDraw();
		};
		xyCv.addEventListener("pointerup", up);
		xyCv.addEventListener("pointercancel", up);

		// double-tap the label to latch the filter on
		if (xyLabel) {
			xyLabel.addEventListener("click", function () {
				latched = !latched;
				xyEl.classList.toggle("latched", latched);
				if (!latched && window.PO33.fx) {
					PO33.fx.xy(0, 0, false);
					xyLabel.textContent = "FILTER / RES";
				} else if (latched && window.PO33.fx) {
					PO33.fx.xy(xyX, xyY, true);
				}
				flash(latched ? "XY latched — stays on" : "XY momentary", "tip");
				xyDraw();
			});
		}

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

	function renderFx() {
		var labels = (window.PO33.fx && PO33.fx.labels) ? PO33.fx.labels() : [];
		var h = '<div class="perfCells fx">';
		for (var i = 1; i <= 16; i++) {
			var name = (labels[i] || i).toString().toLowerCase().replace(" ", " ");
			h += '<button data-fx="' + i + '">' + name + '</button>';
		}
		panelTarget.innerHTML = h + '</div>';
	}

	function renderKeys() {
		var h = '<div class="perfCells keys">';
		for (var i = 0; i < 16; i++) { h += '<button data-key="' + i + '">' + (i + 1) + '</button>'; }
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

		// fx + keys are momentary, so they need pointer down/up
		panel.addEventListener("pointerdown", function (e) {
			var f = e.target.getAttribute("data-fx");
			if (f != null && window.PO33.fx) {
				e.target.classList.add("hot");
				PO33.fx.punch(+f, true);
				return;
			}
			var k = e.target.getAttribute("data-key");
			if (k != null) {
				e.target.classList.add("hot");
				try { window.playSound(g("selectedChannel", 0), +k); } catch (err) {}
			}
		});
		var release = function (e) {
			var t = e.target;
			if (t && t.classList && t.classList.contains("hot")) {
				t.classList.remove("hot");
				if (t.getAttribute("data-fx") != null && window.PO33.fx) { PO33.fx.punch(0, false); }
			}
			var hot = panel.querySelectorAll(".hot");
			Array.prototype.forEach.call(hot, function (n) { n.classList.remove("hot"); });
		};
		panel.addEventListener("pointerup", release);
		panel.addEventListener("pointercancel", release);
		panel.addEventListener("pointerleave", release);

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
