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

	/* What the XY pad is wired to.
	 *
	 * Each of the three can be LOCKED independently. A locked mode keeps
	 * running at the last spot you left it, so you can lock a filter setting,
	 * switch to SPACE, and now have both going at once — the effects stack
	 * instead of replacing each other. The pad always drives whichever mode is
	 * selected; locking is what keeps the others alive behind it.
	 */
	var XY_MODES = ["tone", "synth", "space"];
	var XY_TITLE = { tone: "TONE", synth: "SYNTH", space: "SPACE" };
	var XY_REST = { tone: "muffled \u2194 bright", synth: "play a lead", space: "echo + reverb" };
	var xyMode = "tone";
	var xyLock = { tone: false, synth: false, space: false };
	var xyPos = { tone: { x: 0.5, y: 0.2 }, synth: { x: 0.5, y: 0.6 }, space: { x: 0.4, y: 0.4 } };
	var xyLockBtn;

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }
	// chain edits are undoable one link at a time, same as tapping them in
	function markChain() { try { PO33.undo.markChain(); } catch (e) {} }
	var chainSel = -1;        // which chain link is being edited, -1 = none
	function chainText(c) { return c.map(function (n) { return n + 1; }).join(" "); }
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

		// ghost markers for anything locked in another mode
		XY_MODES.forEach(function (m) {
			if (!xyLock[m] || m === xyMode) { return; }
			var gx = xyPos[m].x * W, gy = (1 - xyPos[m].y) * H;
			xyCtx.strokeStyle = "rgba(255,176,96,0.45)";
			xyCtx.beginPath(); xyCtx.arc(gx, gy, 6, 0, 7); xyCtx.stroke();
		});

		if (!xyOn && !xyLock[xyMode]) { return; }
		var px = xyX * W, py = (1 - xyY) * H;
		xyCtx.strokeStyle = "rgba(255,122,26,0.5)";
		xyCtx.beginPath();
		xyCtx.moveTo(px, 0); xyCtx.lineTo(px, H);
		xyCtx.moveTo(0, py); xyCtx.lineTo(W, py);
		xyCtx.stroke();
		xyCtx.fillStyle = (xyLock[xyMode] && !xyOn) ? "#ffb060" : "#ff7a1a";
		xyCtx.beginPath(); xyCtx.arc(px, py, 8, 0, 7); xyCtx.fill();
	}

	// drive one named engine
	function xyDrive(mode, x, y, on) {
		if (mode === "synth") {
			if (window.PO33.keys) { PO33.keys.xy(x, y, on); }
		} else if (mode === "space") {
			if (window.PO33.fx && PO33.fx.space) { PO33.fx.space(x, y, on); }
		} else if (window.PO33.fx) {
			PO33.fx.xy(x, y, on);
		}
	}

	// the mode under your finger
	function xyApply(on) {
		xyPos[xyMode] = { x: xyX, y: xyY };
		xyDrive(xyMode, xyX, xyY, on);
	}

	// stop only the selected mode; anything locked keeps playing
	function xyRelease() { xyDrive(xyMode, 0, 0, false); }

	// re-assert every locked mode. Called after a release so that turning off
	// the mode you were touching can't knock out the ones you locked earlier.
	function xyReassert() {
		XY_MODES.forEach(function (m) {
			if (xyLock[m] && m !== xyMode) { xyDrive(m, xyPos[m].x, xyPos[m].y, true); }
		});
	}

	function xyAllOff() {
		XY_MODES.forEach(function (m) { xyLock[m] = false; xyDrive(m, 0, 0, false); });
	}

	function paintLocks() {
		if (xyChip) {
			Array.prototype.forEach.call(xyChip.children, function (b) {
				var m = b.getAttribute("data-xy");
				if (!m) { return; }
				b.classList.toggle("on", m === xyMode);
				b.classList.toggle("locked", !!xyLock[m]);
			});
		}
		if (xyLockBtn) {
			xyLockBtn.classList.toggle("on", !!xyLock[xyMode]);
			xyLockBtn.textContent = xyLock[xyMode] ? "LOCKED" : "LOCK";
		}
		if (xyEl) {
			var any = XY_MODES.some(function (m) { return xyLock[m]; });
			xyEl.classList.toggle("latched", any);
		}
	}

	function toggleLock() {
		var on = !xyLock[xyMode];
		xyLock[xyMode] = on;
		if (on) {
			// lock it where it is now, so it keeps doing what you just heard
			xyDrive(xyMode, xyPos[xyMode].x, xyPos[xyMode].y, true);
			flash(XY_TITLE[xyMode] + " locked \u2014 stays on while you use the others", "warn");
		} else {
			xyDrive(xyMode, 0, 0, false);
			flash(XY_TITLE[xyMode] + " unlocked", "tip");
		}
		paintLocks();
		xyReadout();
		xyDraw();
	}

	function xyReadout() {
		if (!xyLabel) { return; }
		// tell the user when the synth is being written into the pattern —
		// there is no way to tell from the pad itself otherwise
		if (xyEl) {
			var rec = xyMode === "synth" && window.PO33.keys && PO33.keys.armed();
			xyEl.classList.toggle("recording", !!rec);
		}
		// name anything still running in the background so a locked effect is
		// never a mystery
		var also = XY_MODES.filter(function (m) { return xyLock[m] && m !== xyMode; })
			.map(function (m) { return XY_TITLE[m].toLowerCase(); });
		var tail = also.length ? "   +" + also.join(" +") : "";
		if (!xyOn && !xyLock[xyMode]) { xyLabel.textContent = XY_REST[xyMode] + tail; return; }
		if (xyMode === "synth") {
			var n = window.PO33.keys ? PO33.keys.note(Math.round(xyX * 15)) : "";
			xyLabel.textContent = n + "  \u00b7  tone " + Math.round(xyY * 100) + "%" + tail;
		} else if (xyMode === "space") {
			xyLabel.textContent = "echo " + Math.round(xyX * 100) +
				"%  \u00b7  reverb " + Math.round(xyY * 100) + "%" + tail;
		} else {
			xyLabel.textContent = (xyX < 0.5 ? "muffled" : "thin") +
				"  " + Math.round(xyX * 100) + "%  \u00b7  bite " + Math.round(xyY * 100) + "%" + tail;
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
		// leaving a mode only silences it if it isn't locked
		if (!xyLock[xyMode]) { xyRelease(); }
		xyOn = false;
		xyMode = m;
		xyX = xyPos[m].x; xyY = xyPos[m].y;
		if (xyEl) { xyEl.setAttribute("data-mode", m); }
		paintLocks();
		xyReadout();
		xyDraw();
		flash("XY: " + XY_TITLE[m] + " \u2014 " + XY_REST[m] +
			(xyLock[m] ? " (locked)" : ""), "tip");
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
			// lifting your finger stops this mode unless you locked it
			if (!xyLock[xyMode]) { xyRelease(); }
			xyReassert();
			xyReadout();
			xyDraw();
		};
		xyCv.addEventListener("pointerup", up);
		xyCv.addEventListener("pointercancel", up);

		// all three modes sit side by side — no hunting through a cycle
		xyChip = document.getElementById("xyModes");
		if (xyChip) {
			xyChip.addEventListener("click", function (e) {
				var b = e.target.closest("[data-xy]");
				if (!b) { return; }
				e.stopPropagation();
				setXyMode(b.getAttribute("data-xy"));
			});
		}

		/* A labelled button, not a hidden tap on the readout text. LOCK keeps
		 * the mode you are on running after you lift your finger, so you can
		 * stack it with the others. Long-press clears every lock at once. */
		xyLockBtn = document.getElementById("xyLock");
		if (xyLockBtn) {
			var lockHold = null;
			xyLockBtn.addEventListener("pointerdown", function (e) {
				e.stopPropagation();
				lockHold = setTimeout(function () {
					lockHold = null;
					xyAllOff();
					paintLocks(); xyReadout(); xyDraw();
					flash("all XY locks cleared", "warn");
				}, 600);
			});
			var endHold = function (e) {
				if (e) { e.stopPropagation(); }
				if (lockHold) { clearTimeout(lockHold); lockHold = null; toggleLock(); }
			};
			xyLockBtn.addEventListener("pointerup", endHold);
			xyLockBtn.addEventListener("pointercancel", function () {
				if (lockHold) { clearTimeout(lockHold); lockHold = null; }
			});
		}
		setXyMode(xyMode);

		setInterval(function () { if (xyEl && !xyOn) { xyReadout(); } }, 400);
		xyResize();
		if (window.ResizeObserver) { new ResizeObserver(xyResize).observe(xyEl); }
		window.addEventListener("resize", xyResize);
		return true;
	}

	/* ================= the switchable panel ================= */

	/* The MIX tab: what's playing, and in what order.
	 *
	 * Mute/solo used to be sixteen anonymous numbers with no indication of
	 * which ones even had anything on them, and the pattern chain could only
	 * be built by holding PATTERN and tapping — with no way to see it, fix a
	 * wrong tap, or remove one link. Both belong on the same screen: this is
	 * the "what is my arrangement actually doing" view.
	 */
	function chanHasContent(ch) {
		var pat = g("currentPattern", 0);
		for (var i = 0; i < 16; i++) {
			try { if (window.newChannelArr[ch][pat][i].noteOn) { return true; } } catch (e) {}
		}
		return false;
	}

	function renderMute() {
		var P = window.PO33.channels;
		var chain = g("patternChain", [0]);
		var pos = g("patternCount", 0);
		var cur = g("currentPattern", 0);

		var h = '<div class="mixHead"><span>MUTE &amp; SOLO</span>' +
			'<button data-mix="unmute">all on</button></div>';

		h += '<div class="perfCells mute">';
		for (var i = 0; i < 16; i++) {
			var st = P ? P.state(i) : "on";
			// a slot with nothing on it this pattern is dimmed, so you can see
			// at a glance what you are actually muting
			var empty = chanHasContent(i) ? "" : " empty";
			h += '<button data-mute="' + i + '" class="' + st + empty + '">' + (i + 1) + '</button>';
		}
		h += '</div>';

		/* Tapping a link SELECTS it rather than deleting it. Selection is what
		 * makes real editing possible — once the app knows which link you mean
		 * you can move it, insert next to it, or remove just that one, instead
		 * of only ever being able to append to the end. */
		h += '<div class="mixHead"><span>CHAIN <i>' +
			(chainSel >= 0 ? "editing link " + (chainSel + 1) : "tap a link to edit") +
			'</i></span><button data-mix="chainclear">reset</button></div>';
		h += '<div class="chainRow">';
		if (!chain.length) {
			h += '<span class="chainEmpty">empty</span>';
		} else {
			chain.forEach(function (n, idx) {
				h += '<button class="chainLink' + (idx === pos ? " playing" : "") +
					(idx === chainSel ? " sel" : "") +
					'" data-chainsel="' + idx + '">' + (n + 1) + '</button>';
			});
		}
		h += '</div>';

		if (chainSel >= 0 && chainSel < chain.length) {
			h += '<div class="chainTools">' +
				'<button data-chainmove="-1" title="move earlier">\u25c0</button>' +
				'<button data-chainmove="1" title="move later">\u25b6</button>' +
				'<button data-chaindup="1" title="duplicate it">copy</button>' +
				'<button data-chaindel="' + chainSel + '" class="del" title="remove it">remove</button>' +
				'<button data-chainsel="-1" class="done">done</button>' +
				'</div>';
		}

		h += '<div class="chainAdd"><span>' +
			(chainSel >= 0 ? "insert after" : "add") + '</span>';
		for (var q = 0; q < 8; q++) {
			h += '<button data-chainadd="' + q + '"' + (q === cur ? ' class="cur"' : "") +
				'>' + (q + 1) + '</button>';
		}
		h += '</div>';
		panelTarget.innerHTML = h;
	}

	// The 16 punch-in effects in pad order, so the grid doubles as a
	// cheat-sheet for hold-FX + pad on the hardware layout.
	function renderFx() {
		var labels = (window.PO33.fx && PO33.fx.labels) ? PO33.fx.labels() : [];
		var help = (window.PO33.fx && PO33.fx.help) ? PO33.fx.help() : [];
		var fr = window.PO33.fxRec;
		var h = '<div class="keysBar keysBar2">' +
			'<button class="keysRec' + (fr && fr.info().ownArm ? " on" : "") +
				'" data-fxrec="1">rec</button>' +
			'<button class="keysClear" data-fxclear="1">clear</button>' +
			'<span class="keysScale">' +
				(fr ? (fr.info().steps + " steps recorded") : "") +
			'</span></div>';
		h += '<div class="perfCells fx">';
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
		// Every voice is a button of its own. Cycling through a single button
		// meant three taps to reach the bass; there is room to just show them.
		var cur = K.voice();
		var h = '<div class="keysBar">';
		K.voices().forEach(function (v) {
			h += '<button class="keysVoice' + (v === cur ? " on" : "") +
				'" data-keysvoice="' + v + '">' + v + '</button>';
		});
		h += '</div><div class="keysBar keysBar3">';
		var dk = window.PO33.drumkit;
		if (dk) {
			h += '<span class="keysScale kitLabel">drum kit →</span>';
			dk.names().forEach(function (k) {
				h += '<button class="keysKit" data-kit="' + k + '" title="' + dk.blurb(k) +
					'">' + k + '</button>';
			});
		}
		h += '</div><div class="keysBar keysBar2">' +
			'<button class="keysFit' + (K.fit() ? " on" : "") + '" data-keysfit="1">in time</button>' +
			'<button class="keysRec' + (K.armed() ? " on" : "") + '" data-keysrec="1">rec</button>' +
			'<button class="keysClear" data-keysclear="1">clear</button>' +
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

		// mute cells + chain editing
		panel.addEventListener("click", function (e) {
			var t = e.target.closest("[data-mute],[data-mix],[data-chaindel],[data-chainadd]," +
				"[data-chainsel],[data-chainmove],[data-chaindup]");
			if (!t) { return; }

			var m = t.getAttribute("data-mute");
			if (m != null && window.PO33.channels) { PO33.channels.cycle(+m); renderMute(); return; }

			var mix = t.getAttribute("data-mix");
			if (mix === "unmute" && window.PO33.channels) { PO33.channels.clearAll(); renderMute(); return; }
			if (mix === "chainclear") {
				markChain();
				window.patternChain = [g("currentPattern", 0)];
				window.patternCount = 0;
				chainSel = -1;
				flash("chain reset to pattern " + (g("currentPattern", 0) + 1), "tip");
				renderMute();
				return;
			}

			var sel = t.getAttribute("data-chainsel");
			if (sel != null) {
				var si = +sel;
				chainSel = (si === chainSel || si < 0) ? -1 : si;   // tap again to deselect
				renderMute();
				return;
			}

			var chain = g("patternChain", [0]);

			var mv = t.getAttribute("data-chainmove");
			if (mv != null && chainSel >= 0) {
				var to = chainSel + (+mv);
				if (to < 0 || to >= chain.length) { flash("already at the end", "warn"); return; }
				markChain();
				var moved = chain.splice(chainSel, 1)[0];
				chain.splice(to, 0, moved);
				chainSel = to;
				flash("chain: " + chainText(chain), "tip");
				renderMute();
				return;
			}

			if (t.getAttribute("data-chaindup") != null && chainSel >= 0) {
				markChain();
				chain.splice(chainSel + 1, 0, chain[chainSel]);
				chainSel = chainSel + 1;
				flash("chain: " + chainText(chain), "tip");
				renderMute();
				return;
			}

			var del = t.getAttribute("data-chaindel");
			if (del != null) {
				if (chain.length <= 1) { flash("a chain needs at least one pattern", "warn"); return; }
				markChain();
				chain.splice(+del, 1);
				if (window.patternCount >= chain.length) { window.patternCount = 0; }
				chainSel = -1;
				flash("chain: " + chainText(chain), "tip");
				renderMute();
				return;
			}

			var add = t.getAttribute("data-chainadd");
			if (add != null) {
				markChain();
				// with a link selected this inserts next to it; otherwise it
				// appends, which is what you want when you're building it up
				if (chainSel >= 0) { chain.splice(chainSel + 1, 0, +add); chainSel++; }
				else { chain.push(+add); }
				flash("chain: " + chainText(chain), "tip");
				renderMute();
			}
		});

		// keyboard settings
		panel.addEventListener("click", function (e) {
			var K = window.PO33.keys;
			if (!K) { return; }
			var v = e.target.closest("[data-keysvoice]");
			if (v) { K.setVoice(v.getAttribute("data-keysvoice")); renderKeys(); return; }
			if (e.target.closest("[data-keysfit]")) { K.toggleFit(); renderKeys(); return; }
			if (e.target.closest("[data-keysrec]")) { K.toggleArm(); renderKeys(); return; }
			if (e.target.closest("[data-keysclear]")) { K.clearTrack(); renderKeys(); return; }
			var kit = e.target.closest("[data-kit]");
			if (kit && window.PO33.drumkit) {
				// drop it on the selected slot if that's a drum slot, else 9
				var sel = g("selectedChannel", 0) + 1;
				var target = sel >= 9 ? sel : 9;
				kit.disabled = true;
				PO33.drumkit.load(target, kit.getAttribute("data-kit")).then(function () {
					renderKeys();
				});
			}
		});

		// fx lane rec / clear
		panel.addEventListener("click", function (e) {
			var fr = window.PO33.fxRec;
			if (!fr) { return; }
			if (e.target.closest("[data-fxrec]")) { fr.toggleArm(); renderFx(); }
			else if (e.target.closest("[data-fxclear]")) { fr.clear(); renderFx(); }
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
