/* mobile.js — phone drawer chrome.
 * Bottom-left button opens a touch-worded guide (PO slides right);
 * bottom-right button opens the sample library (PO slides left).
 * Only active on touch / narrow screens; a no-op on desktop.
 */
(function () {
	"use strict";

	var mq = window.matchMedia("(max-width: 720px), (pointer: coarse)");

	var INFO_HTML =
		'<div class="drawerHead"><h2>How to play</h2>' +
			'<button class="drawerClose" data-close aria-label="close">&times;</button></div>' +
		'<div id="infoBody">' +

			'<h3>Basics</h3><ol>' +
			'<li>Tap <span class="tag">PLAY</span> to start the beat. Tap again to stop.</li>' +
			'<li>While stopped, tap any <b>number pad</b> to play the current sound.</li>' +
			'<li>The screen always shows the mode you’re in and the selected sound.</li>' +
			'</ol>' +

			'<h3>Pick / load a sound</h3><ol>' +
			'<li>Tap <span class="tag">SOUND</span>, then a <b>number pad</b> to choose the slot ' +
				'(1–8 melodic, 9–16 drum).</li>' +
			'<li>Open the <b>Library</b> (button, bottom-right). Tap <b>&#9654;</b> to preview, ' +
				'<b>tap the row</b> to load it onto that slot.</li>' +
			'<li>Tap <span class="tag">SOUND</span> again to leave. The pads now play it.</li>' +
			'</ol>' +

			'<h3>Make a pattern</h3><ol>' +
			'<li>Tap <span class="tag">WRITE</span>.</li>' +
			'<li>Tap number pads 1–16 to place / remove steps.</li>' +
			'<li>Tap <span class="tag">WRITE</span> again to go back; the pads set pitch / sample.</li>' +
			'</ol>' +

			'<h3>Chain patterns</h3><ol>' +
			'<li>Tap <span class="tag">PATTERN</span> (it stays held).</li>' +
			'<li>Tap number pads to pick a pattern, then more to add them to the chain.</li>' +
			'<li>Tap <span class="tag">PATTERN</span> to exit.</li>' +
			'</ol>' +

			'<h3>Tempo, swing, volume</h3><ol>' +
			'<li>Tap <span class="tag">BPM</span>, then drag the two <b>sliders</b> ' +
				'(labels show swing / tempo).</li>' +
			'<li>Double-tap <span class="tag">BPM</span> to cycle 80 / 120 / 140.</li>' +
			'<li>In BPM mode, number pads 1–16 set master volume.</li>' +
			'</ol>' +

			'<h3>Record</h3><ol>' +
			'<li>Choose the target slot (<span class="tag">SOUND</span> + a pad).</li>' +
			'<li>In the Library bar tap <b>&#127897; microphone</b>, then <b>&#9679; record</b> ' +
				'(or tap the orange <span class="tag">RECORD</span> pad).</li>' +
			'<li>Tap <b>&#9632; stop</b> (auto-stops at 20s). The clip loads onto the slot and ' +
				'into <b>&#9733; my recordings</b>.</li>' +
			'<li><i>Tab-audio capture is desktop-Chrome only. Mic works on Android and iOS 14.3+.</i></li>' +
			'</ol>' +

			'<h3>Live record</h3><ol>' +
			'<li>Start <span class="tag">PLAY</span>, then press and hold <span class="tag">WRITE</span> ' +
				'for 3 seconds &mdash; pads you tap get written into the pattern.</li>' +
			'</ol>' +

			'<h3>Effects (hold FX)</h3><ol>' +
			'<li>Press &amp; hold <span class="tag">FX</span>, then tap pads 1&ndash;8 for punch-in effects: ' +
				'<b>1</b> crush · <b>2</b> lo-fi · <b>3</b> filter down · <b>4</b> filter up · ' +
				'<b>5</b> delay · <b>6</b> stutter · <b>7</b> pitch up · <b>8</b> pitch down.</li>' +
			'<li>The effect lasts while you hold the pad.</li>' +
			'</ol>' +

			'<h3>Trim &amp; chop</h3><ol>' +
			'<li>Stop playback, then tap <span class="tag">FX</span> until the screen says ' +
				'<b>TRIM</b> &mdash; the waveform appears with two handles.</li>' +
			'<li>Drag the handles to top &amp; tail the sample. <b>preview</b> hears it, ' +
				'<b>apply to pattern</b> updates steps you already wrote.</li>' +
			'<li><b>chop 4 / 8 / 16</b> slices the sample across the 16 pads of a drum slot. ' +
				'With <b>lay out + match tempo</b> ticked it also writes the slices across the ' +
				'16 steps and sets the BPM so one bar = the loop &mdash; press PLAY and it replays, ' +
				'then move the pads around to re-chop it.</li>' +
			'<li>Just recorded something? Hit <b>&#9986; chop x16</b> next to the download link.</li>' +
			'</ol>' +

			'<h3>Step locks &amp; accent</h3><ol>' +
			'<li>In <span class="tag">WRITE</span>, <b>press and hold a lit step</b> for a moment ' +
				'&mdash; the screen shows <b>LOCK step N</b>.</li>' +
			'<li>That step <b>stays latched</b> &mdash; let go and move a <b>slider</b>. The value ' +
				'is saved to <i>that step only</i>. Which pair the sliders control follows the FX ' +
				'mode: <b>TONE</b> note/volume, <b>FILTER</b> cutoff/res, <b>TRIM</b> start/length.</li>' +
			'<li>Tap the latched pad again to finish (or tap another lit step to jump to it).</li>' +
			'<li>Slider&nbsp;2 in TONE mode is <b>accent / velocity</b>: louder steps show taller on ' +
				'the step bar, quieter ones sit low. Locked steps get a red outline.</li>' +
			'</ol>' +
			'<div id="clearRow">' +
				'<button id="clearLocksBtn" type="button">clear locks on this sound</button>' +
			'</div>' +

			'<h3>Projects</h3>' +
			'<p>Saved in this browser — they survive site updates (only clearing ' +
				'browser data or switching device loses them).</p>' +
			'<div id="clearRow">' +
				'<button id="projOpenBtn" type="button">open project browser (on screen)</button>' +
			'</div>' +

			'<h3>Clear</h3>' +
			'<div id="clearRow">' +
				'<button id="clearPtnBtn" type="button">clear this pattern</button>' +
				'<button id="clearAllBtn" type="button">clear everything (triple-click)</button>' +
			'</div>' +
		'</div>';

	function hwButton(id, label) {
		var d = document.createElement("div");
		d.id = id;
		d.className = "buttonGridItem";
		d.innerHTML =
			'<div class="buttonBG"><div class="square"><div class="circle"></div></div></div>' +
			'<div class="gridHover"></div>' +
			'<div class="btnText">' + label + '</div>';
		return d;
	}

	function build() {
		if (document.getElementById("fabInfo")) { return; }

		var scrim = document.createElement("div");
		scrim.id = "drawerScrim";

		var info = document.createElement("aside");
		info.id = "infoDrawer";
		info.innerHTML = INFO_HTML;

		// two buttons built into the bottom of the unit, styled like the PO's own
		var fabInfo = hwButton("fabInfo", "info");
		var fabLib = hwButton("fabLib", "library");
		var hwRow = document.createElement("div");
		hwRow.className = "hwRow";
		hwRow.append(fabInfo, fabLib);

		var board = document.querySelector(".circuitBoard");
		if (board) { board.appendChild(hwRow); } else { document.body.appendChild(hwRow); }
		document.body.append(scrim, info);

		fabInfo.addEventListener("click", function () { toggle("info"); });
		fabLib.addEventListener("click", function () { toggle("lib"); });
		scrim.addEventListener("click", close);
		info.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]")) { close(); }
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { close(); }
		});
		// "‹ back" row inside the library (rendered by library.js, so delegate)
		document.addEventListener("click", function (e) {
			if (e.target.closest("#libBack")) { close(); }
			if (e.target.id === "clearLocksBtn" && window.PO33 && PO33.locks) { PO33.locks.clearAll(); }
			if (e.target.id === "clearPtnBtn" && window.PO33) { PO33.clearPattern(); }
			if (e.target.id === "clearAllBtn" && window.PO33) { PO33.clearAll(e.target); }
			if (e.target.id === "projOpenBtn" && window.PO33 && PO33.projects) { close(); PO33.projects.show(); }
		});
		// NOTE: the library drawer never auto-closes — you close it with the ×,
		// the scrim, the back row, or the LIBRARY button.
	}

	/* ---- scale the whole unit to fit the viewport, no scrolling, any size ---- */
	var fitPending, fitting = false;
	function fitUnit() {
		var board = document.querySelector(".circuitBoard");
		var art = document.querySelector("article");
		if (!board || !art || fitting) { return; }
		if (!mq.matches) { board.style.transform = ""; board.style.width = ""; return; }
		fitting = true;
		board.style.transform = "none";
		board.style.width = "372px";
		var nh = board.offsetHeight || 700;
		var aw = art.clientWidth - 6;
		var ah = art.clientHeight - 6;
		var s = Math.min(aw / 372, ah / nh);
		s = Math.max(0.3, Math.min(s, 1.25));
		board.style.transform = "scale(" + s + ")";
		setTimeout(function () { fitting = false; }, 0);
	}
	function scheduleFit() {
		clearTimeout(fitPending);
		fitPending = setTimeout(fitUnit, 60);
	}
	function watchFit() {
		fitUnit();
		[120, 400, 900, 1600].forEach(function (t) { setTimeout(fitUnit, t); });
		window.addEventListener("resize", scheduleFit);
		window.addEventListener("orientationchange", function () { setTimeout(fitUnit, 200); });
		if (window.ResizeObserver) {
			var board = document.querySelector(".circuitBoard");
			var art = document.querySelector("article");
			var ro = new ResizeObserver(scheduleFit);
			if (board) { ro.observe(board); }
			if (art) { ro.observe(art); }
		}
	}

	function toggle(which) {
		var b = document.body;
		var open = which === "info" ? "drawer-info" : "drawer-lib";
		var other = which === "info" ? "drawer-lib" : "drawer-info";
		b.classList.remove(other);
		var isOpen = b.classList.toggle(open);
		b.classList.toggle("drawer-open", isOpen);
	}

	function close() {
		document.body.classList.remove("drawer-info", "drawer-lib", "drawer-open");
	}

	var watching = false;
	function sync() {
		if (mq.matches) {
			build();
			if (!watching) { watching = true; watchFit(); }
		} else {
			close();
			fitUnit(); // clears the transform on desktop
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", sync);
	} else { sync(); }
	(mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(sync);
})();
