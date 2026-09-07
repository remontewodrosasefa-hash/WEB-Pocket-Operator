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
		// NOTE: the library drawer never auto-closes — you close it with the ×,
		// the scrim, or the LIBRARY button. Picking / previewing a sample keeps
		// it open so you can choose a slot and keep browsing.
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

	function sync() {
		if (mq.matches) { build(); }
		else { close(); }
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", sync);
	} else { sync(); }
	(mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(sync);
})();
