/* mobile.js — phone drawer chrome.
 * Bottom-left button opens a touch-worded guide (PO slides right);
 * bottom-right button opens the sample library (PO slides left).
 * Only active on touch / narrow screens; a no-op on desktop.
 */
(function () {
	"use strict";

	var mq = window.matchMedia("(max-width: 720px), (pointer: coarse)");

	var INFO_HTML = [
		'<div class="drawerHead"><h2>Guide</h2>',
			'<button class="drawerClose" data-close aria-label="close">&times;</button></div>',
		'<div id="infoNav">',
			'<button data-iv="play" class="on">play</button>',
			'<button data-iv="music">make music</button>',
			'<button data-iv="design">sound design</button>',
			'<button data-iv="util">utilities</button>',
		'</div>',
		'<div id="infoBody">',

		/* ============ PLAY ============ */
		'<section data-view="play">',

			'<h3>The one idea</h3>',
			'<p>The 16 pads are <b>two things at once</b>. In normal mode they <b>play sounds</b>. ',
				'In <span class="tag">WRITE</span> mode the same 16 pads become the <b>16 steps</b> ',
				'of the bar. Once that clicks, everything else is easy.</p>',

			'<h3>Basics</h3><ol>',
			'<li>Tap <span class="tag">PLAY</span> to start / stop.</li>',
			'<li>Stopped: tap a <b>pad</b> to play the current sound live.</li>',
			'<li>The screen always shows your mode and selected sound, and flashes a ',
				'<b>next &rarr;</b> hint when you change modes.</li>',
			'</ol>',

			'<h3>Pick a sound</h3><ol>',
			'<li><span class="tag">SOUND</span> &rarr; a <b>pad</b> picks the slot. ',
				'1&ndash;8 melodic, 9&ndash;16 drum.</li>',
			'<li>Open <b>Library</b> (bottom-right). <b>&#9654;</b> previews, <b>tap the row</b> loads ',
				'it onto that slot. On a drum slot it loads onto the <i>current pad</i> &mdash; tap a ',
				'different pad first to build a kit. <b>whole kit</b> fills all 16.</li>',
			'<li><span class="tag">SOUND</span> again to leave.</li>',
			'</ol>',

			'<h3>Write a pattern</h3><ol>',
			'<li><span class="tag">WRITE</span> &rarr; tap pads 1&ndash;16 to place / remove steps.</li>',
			'<li><span class="tag">WRITE</span> again to leave; back in play mode a pad sets the ',
				'pitch / drum sample new steps will use.</li>',
			'</ol>',

			'<h3>Tempo &amp; swing</h3><ol>',
			'<li><span class="tag">BPM</span> &rarr; drag the sliders (screen labels them). ',
				'Double-tap <span class="tag">BPM</span> to cycle 80 / 120 / 140.</li>',
			'<li>The <b>master</b> slider (silver, always live) is overall volume.</li>',
			'</ol>',

			'<h3>Chain patterns into a song</h3><ol>',
			'<li>Hold <span class="tag">PATTERN</span>, tap a pad to pick a pattern, tap more ',
				'to append them to the chain, <span class="tag">PATTERN</span> to exit.</li>',
			'<li>Copy a pattern: in PATTERN mode press <span class="tag">WRITE</span>, pick the ',
				'source, then an empty slot.</li>',
			'</ol>',

			'<h3>Keyboard (desktop)</h3>',
			'<p>Pads = <kbd>1234</kbd> <kbd>QWER</kbd> <kbd>ASDF</kbd> <kbd>ZXCV</kbd>. ',
				'<kbd>Return</kbd> play &middot; <kbd>5</kbd> sound &middot; <kbd>6</kbd> pattern &middot; ',
				'<kbd>7</kbd> bpm &middot; <kbd>8</kbd> fx &middot; <kbd>9</kbd> write.</p>',

		'</section>',

		/* ============ MAKE MUSIC ============ */
		'<section data-view="music" hidden>',

			'<h3>Scale &amp; key</h3>',
			'<p>Melodic slots (1&ndash;8) play through a key + scale, so the 16 pads become ',
				'2&ndash;4 musical octaves. <b>16-pad classic</b> is the original fixed layout.</p>',
			'<div id="scaleRow">',
				'<select id="scaleSel">',
					'<option value="classic">16-pad classic</option>',
					'<option value="major">major</option><option value="minor">minor</option>',
					'<option value="dorian">dorian</option><option value="penta maj">penta maj</option>',
					'<option value="penta min">penta min</option><option value="blues">blues</option>',
					'<option value="chromatic">chromatic</option>',
				'</select>',
				'<span id="scaleKeyWrap">key <select id="scaleKey">',
					'<option value="0">C</option><option value="1">C#</option><option value="2">D</option>',
					'<option value="3">D#</option><option value="4">E</option><option value="5">F</option>',
					'<option value="6">F#</option><option value="7">G</option><option value="8">G#</option>',
					'<option value="9">A</option><option value="10">A#</option><option value="11">B</option>',
				'</select></span>',
				'<button id="scaleOctDn" type="button">&minus;</button>',
				'<span id="scaleOct">oct +0</span>',
				'<button id="scaleOctUp" type="button">+</button>',
			'</div>',

			'<h3>Before you start</h3>',
			'<p>Open <b>utilities &rarr; clear this pattern</b> so you have a blank bar. ',
				'The unit ships with 16 sounds loaded (1&ndash;8 melodic, 9&ndash;16 drum kits), ',
				'so you can build a beat without touching the Library.</p>',

			'<h3>Beat #1 &mdash; boom-bap (beginner)</h3>',
			'<p><b>Tempo:</b> <span class="tag">BPM</span> &rarr; tempo slider to ~<b>90</b>, ',
				'swing to ~<b>18%</b>. Leave BPM mode.</p>',
			'<p><b>Kick.</b> <span class="tag">SOUND</span> &rarr; pad <b>9</b> &rarr; ',
				'<span class="tag">SOUND</span>. Tap pads to audition; land on a deep thump (say pad 1). ',
				'<span class="tag">WRITE</span> &rarr; tap steps <b>1, 7, 11</b> &rarr; ',
				'<span class="tag">WRITE</span>.</p>',
			'<p><b>Snare.</b> Still slot 9. Find a crack (say pad 5). <span class="tag">WRITE</span> ',
				'&rarr; steps <b>5, 13</b> &rarr; <span class="tag">WRITE</span>. One drum slot now ',
				'holds two sounds &mdash; each step remembers its own pad.</p>',
			'<p><b>Hats.</b> Find a tick (pad 9). <span class="tag">WRITE</span> &rarr; ',
				'steps <b>1,3,5,7,9,11,13,15</b> &rarr; <span class="tag">WRITE</span>.</p>',
			'<p><span class="tag">PLAY</span>. That is a beat.</p>',

			'<h3>Make it groove</h3><ul>',
			'<li><b>Accent.</b> WRITE, <b>hold</b> a hat step to latch it, nudge slider&nbsp;2 up ',
				'a little (TONE mode) &mdash; that hit gets louder. Do it on the <b>off-beats</b> for ',
				'bounce. Pull a couple <i>down</i> for ghost notes.</li>',
			'<li><b>Swing</b> lives in BPM mode &mdash; 15&ndash;22% is the pocket for hip-hop, ',
				'0% for techno.</li>',
			'<li><b>Micro-timing.</b> Latch the snare and use the on-screen ',
				'<b>timing &#9664; &#9654;</b> to push it 6&ndash;12ms late &mdash; instant laid-back feel.</li>',
			'<li><b>Less is more.</b> A kick, a snare, and one more element is a whole beat. Add space, ',
				'not layers.</li>',
			'</ul>',

			'<h3>Beat #2 &mdash; four-on-the-floor house (~124)</h3>',
			'<p>BPM <b>124</b>, swing <b>0</b>. Slot 9: kick on <b>1,5,9,13</b>. ',
				'Open hat on <b>3,7,11,15</b> (a different, longer pad). Clap on <b>5,13</b>. ',
				'Slot 1 (melodic): a bass note on <b>1</b> and <b>9</b>, a higher note on <b>7</b> and ',
				'<b>15</b> &mdash; write each pitch separately (pick the pad in play mode, then WRITE ',
				'its steps).</p>',

			'<h3>Beat #3 &mdash; half-time trap (~140)</h3>',
			'<p>BPM <b>140</b> but think in half-time: kick on <b>1</b> and <b>11</b>, snare/clap on ',
				'<b>9</b> only. Hats on every step; then latch a run of 3&ndash;4 hat steps and ',
				'<b>nudge</b> alternate ones for a rolling feel, or drop an <b>auto-slice</b> of a ',
				'vocal on a spare drum slot and trigger chops on the &amp;s.</p>',

			'<h3>Live record (play it in)</h3>',
			'<div class="callout">',
				'<b>The fastest way to write a part.</b> Instead of placing steps one by one, ',
				'play the pads in time and they record themselves onto the bar.',
				'<ol>',
				'<li>Press <span class="tag">PLAY</span> so the pattern is running.</li>',
				'<li><b>Press and hold <span class="tag">WRITE</span> for 3 seconds</b> &mdash; the ',
					'screen changes to <b>&#9679; LIVE REC</b>. (Or tap <i>arm live rec</i> in ',
					'<b>utilities</b> to skip the hold.)</li>',
				'<li>Tap pads in time. Each hit lands on whichever step is passing.</li>',
				'<li>Tap <span class="tag">WRITE</span> again to stop recording.</li>',
				'</ol>',
				'Messy take? Hit <b>&#8630; undo</b> on the screen (or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd>) ',
				'&mdash; the whole take comes off in one go.',
			'</div>',

			'<h3>From beat to song</h3>',
			'<p>Think in <b>sections</b>, each its own pattern:</p><ol>',
			'<li><b>Pattern 1 = the main loop.</b> Get it right.</li>',
			'<li><b>Pattern 2 = a variation.</b> In PATTERN mode press WRITE, pick 1, then an empty ',
				'slot to <b>copy</b> it. Now strip it back &mdash; drop the kick for 2 bars, or mute ',
				'a part (hold its pad in SOUND).</li>',
			'<li><b>Pattern 3 = a fill / turnaround.</b> Busy hats, a snare roll (nudge + accent), ',
				'or a tape-stop right at the end.</li>',
			'<li><b>Chain them.</b> Hold PATTERN and tap, e.g. <b>1 1 1 3 &nbsp; 2 2 2 3</b> &mdash; ',
				'that is an 8-bar loop that breathes.</li>',
			'</ol>',
			'<p>A simple full arrangement: <b>intro</b> (just drums, 4 bars) &rarr; <b>groove</b> ',
				'(everything, 8) &rarr; <b>break</b> (melody + hats, 4) &rarr; <b>groove</b> (8) &rarr; ',
				'<b>outro</b> (filter down with the LFO, 4). Chain the pattern numbers in that order.</p>',

			'<h3>Advanced moves</h3><ul>',
			'<li><b>Fills with locks.</b> Latch the last 2&ndash;4 steps of a pattern and lock a ',
				'higher pitch or shorter <b>TRIM length</b> for a stutter.</li>',
			'<li><b>Motion-record a sweep.</b> Utilities &rarr; arm motion rec, PLAY, and ride the ',
				'FILTER slider through a section &mdash; it bakes onto the steps.</li>',
			'<li><b>Transitions.</b> Hold <span class="tag">FX</span> and use <b>12 tape&nbsp;stop</b>, ',
				'<b>16 kill</b>, or <b>5 delay</b> into the first beat of the next section.</li>',
			'<li><b>Chop a break.</b> Record 1&ndash;2 bars of a drum loop, hit <b>&#9986; chop x16</b>, ',
				'tick <i>lay out + match tempo</i> &mdash; now re-order the pads to flip the break.</li>',
			'<li><b>LFO</b> on a slow triangle at low depth adds movement to a static loop without ',
				'touching a single step.</li>',
			'</ul>',

		'</section>',

		/* ============ SOUND DESIGN ============ */
		'<section data-view="design" hidden>',

			'<h3>Record</h3><ol>',
			'<li>Pick the target slot (<span class="tag">SOUND</span> + a pad).</li>',
			'<li>Library bar: <b>&#127897; microphone</b>, then <b>&#9679; record</b> (or the orange ',
				'<span class="tag">RECORD</span> pad). <b>&#9632; stop</b> (auto at 20s).</li>',
			'<li>Lands on the slot and in <b>&#9733; my recordings</b> (kept in this browser). ',
				'<i>Browser-tab audio is desktop-Chrome only.</i></li>',
			'</ol>',

			'<h3>Live record into a pattern</h3>',
			'<p>PLAY, then <b>hold</b> <span class="tag">WRITE</span> for 3s &mdash; pads you tap ',
				'get written onto the step that is passing.</p>',

			'<h3>Trim</h3><ol>',
			'<li>Stopped, tap <span class="tag">FX</span> until the screen says <b>TRIM</b> &mdash; ',
				'the waveform appears.</li>',
			'<li>Drag the handles. <b>preview</b> hears the region; <b>apply to pattern</b> retro-fits ',
				'steps you already wrote.</li>',
			'</ol>',

			'<h3>Auto-slice / chop</h3>',
			'<p>In the TRIM view: <b>chop 4 / 8 / 16</b> cuts the sample into equal slices across ',
				'the 16 pads of a drum slot. With <b>lay out + match tempo</b> ticked it also writes ',
				'the slices across the 16 steps and sets BPM so one bar = the loop. Melodic sounds ',
				'send their chops to SOUND 16.</p>',

			'<h3>Step parameter locks</h3><ol>',
			'<li>In <span class="tag">WRITE</span>, <b>hold a lit step</b> to latch it (screen: ',
				'<b>LOCK step N</b>).</li>',
			'<li>Let go, move a <b>slider</b> &mdash; the value saves to <i>that step only</i>. ',
				'The FX mode decides the pair: <b>TONE</b> note / volume, <b>FILTER</b> cutoff / res, ',
				'<b>TRIM</b> start / length.</li>',
			'<li>Slider&nbsp;2 in TONE = <b>accent</b> (taller on the step bar) or <b>ghost</b> (low).</li>',
			'<li>Tap the latched pad to finish, or another lit step to jump to it.</li>',
			'</ol>',
			'<div class="btnRow"><button id="clearLocksBtn" type="button">clear locks on this sound</button></div>',

			'<h3>Micro-timing (nudge)</h3>',
			'<p>Latch a step, then use the on-screen <b>timing &#9664; &#9654;</b> to move that hit ',
				'&plusmn;60ms. Desktop: scroll over a lit step.</p>',

			'<h3>Effects &mdash; hold FX + a pad</h3>',
			'<p class="fxGrid">',
				'<b>1</b> crush <b>2</b> lo-fi <b>3</b> filter&nbsp;down <b>4</b> filter&nbsp;up ',
				'<b>5</b> delay <b>6</b> stutter <b>7</b> pitch&nbsp;up <b>8</b> pitch&nbsp;down ',
				'<b>9</b> reverb <b>10</b> wide&nbsp;6/9 <b>11</b> phaser <b>12</b> tape&nbsp;stop ',
				'<b>13</b> roll <b>14</b> ping-pong <b>15</b> wobble <b>16</b> kill',
			'</p>',
			'<p>Each lasts only while you hold the pad.</p>',

		'</section>',

		/* ============ UTILITIES ============ */
		'<section data-view="util" hidden>',

			'<h3>LFO (auto filter sweep)</h3>',
			'<div id="lfoRow">',
				'<button id="lfoBtn" type="button">LFO off</button>',
				'<label>rate <input type="range" id="lfoRate" min="1" max="1200" value="400"></label>',
				'<label>depth <input type="range" id="lfoDepth" min="0" max="100" value="60"></label>',
				'<select id="lfoWave">',
					'<option value="sine">sine</option><option value="triangle">triangle</option>',
					'<option value="square">square</option><option value="sawtooth">saw</option>',
				'</select>',
			'</div>',

			'<h3>Motion recording</h3>',
			'<p>Arm below, <span class="tag">PLAY</span>, then sweep a <b>slider</b> &mdash; the value ',
				'stamps onto each step as the playhead passes. Stop playback to save. The FX mode ',
				'(TONE / FILTER / TRIM) picks which parameter records.</p>',
			'<div class="btnRow">',
				'<button id="liveRecBtn" type="button">arm live rec (play pads into the bar)</button>',
				'<button id="motionBtn" type="button">arm motion rec</button>',
				'<button id="undoDrawerBtn" type="button">undo last change</button>',
			'</div>',

			'<h3>Mute / solo</h3>',
			'<p>In <span class="tag">SOUND</span> mode, <b>hold a pad</b> to cycle that sound ',
				'<b>muted &rarr; solo &rarr; on</b>. Any solo silences the rest.</p>',

			'<h3>Metronome &amp; feel</h3>',
			'<div class="btnRow">',
				'<button id="metroBtn" type="button">metronome on / off</button>',
				'<button id="unmuteBtn" type="button">un-mute everything</button>',
				'<button id="hapticBtn" type="button">haptics on / off</button>',
			'</div>',

			'<h3>Projects</h3>',
			'<p>Saved in this browser &mdash; they survive site updates. Only clearing browser ',
				'data or switching device loses them.</p>',
			'<div class="btnRow"><button id="projOpenBtn" type="button">open project browser</button></div>',

			'<h3>Clear</h3>',
			'<div class="btnRow">',
				'<button id="clearPtnBtn" type="button">clear this pattern</button>',
				'<button id="clearAllBtn" type="button">clear everything (triple-click)</button>',
			'</div>',

		'</section>',

		'</div>'
	].join('');

	function build() {
		// NB: #fabInfo lives in the markup now, so it can't be the "already built"
		// sentinel — the drawer is.
		if (document.getElementById("infoDrawer")) { return; }

		var scrim = document.createElement("div");
		scrim.id = "drawerScrim";

		var info = document.createElement("aside");
		info.id = "infoDrawer";
		info.innerHTML = INFO_HTML;

		// info / library now live in the unit's top row, straight from the markup
		var fabInfo = document.getElementById("fabInfo");
		var fabLib = document.getElementById("fabLib");
		document.body.append(scrim, info);

		if (fabInfo) { fabInfo.addEventListener("click", function () { toggle("info"); }); }
		if (fabLib) { fabLib.addEventListener("click", function () { toggle("lib"); }); }
		scrim.addEventListener("click", close);
		info.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]")) { close(); }
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { close(); }
		});
		// info-drawer tabs
		info.addEventListener("click", function (e) {
			var t = e.target.closest("#infoNav button");
			if (!t) { return; }
			var v = t.getAttribute("data-iv");
			info.querySelectorAll("#infoNav button").forEach(function (b) {
				b.classList.toggle("on", b === t);
			});
			info.querySelectorAll("#infoBody section").forEach(function (sec) {
				sec.hidden = sec.getAttribute("data-view") !== v;
			});
			var body = info.querySelector("#infoBody");
			if (body) { body.scrollTop = 0; }
		});
		document.addEventListener("input", function (e) {
			if (!window.PO33 || !PO33.fx) { return; }
			var id = e.target && e.target.id;
			if (id === "lfoRate" || id === "lfoDepth") {
				PO33.fx.lfo({
					rate: (+document.getElementById("lfoRate").value) / 100,
					depth: (+document.getElementById("lfoDepth").value) / 100
				});
			}
		});
		document.addEventListener("change", function (e) {
			var id = e.target && e.target.id;
			if (id === "lfoWave" && window.PO33 && PO33.fx) {
				PO33.fx.lfo({ wave: e.target.value });
			}
			if ((id === "scaleSel" || id === "scaleKey") && window.PO33 && PO33.scale) {
				PO33.scale.set({
					scale: document.getElementById("scaleSel").value,
					key: +document.getElementById("scaleKey").value
				});
			}
		});
		// "‹ back" row inside the library (rendered by library.js, so delegate)
		document.addEventListener("click", function (e) {
			if (e.target.closest("#libBack")) { close(); }
			if (e.target.id === "clearLocksBtn" && window.PO33 && PO33.locks) { PO33.locks.clearAll(); }
			if (e.target.id === "metroBtn" && window.PO33 && PO33.metro) { PO33.metro.toggle(); }
			if (e.target.id === "liveRecBtn" && window.PO33 && PO33.liveRec) { close(); PO33.liveRec(); }
			if (e.target.id === "undoDrawerBtn" && window.PO33 && PO33.undo) { PO33.undo.undo(); }
			if (e.target.id === "motionBtn" && window.PO33 && PO33.motion) {
				var on = PO33.motion.toggle();
				e.target.textContent = on ? "disarm motion rec" : "arm motion rec";
			}
			if (e.target.id === "lfoBtn" && window.PO33 && PO33.fx) {
				var st = PO33.fx.lfoState();
				var now = PO33.fx.lfo({ on: !st.on,
					rate: (+document.getElementById("lfoRate").value) / 100,
					depth: (+document.getElementById("lfoDepth").value) / 100,
					wave: document.getElementById("lfoWave").value });
				e.target.textContent = now.on ? "LFO on" : "LFO off";
			}
			if (e.target.id === "unmuteBtn" && window.PO33 && PO33.channels) { PO33.channels.clearAll(); }
			if (e.target.id === "hapticBtn" && window.PO33 && PO33.haptics) { PO33.haptics.toggle(); }
			if (e.target.id === "scaleOctUp" && window.PO33 && PO33.scale) { PO33.scale.octave(1); }
			if (e.target.id === "scaleOctDn" && window.PO33 && PO33.scale) { PO33.scale.octave(-1); }
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
		// +12 slack for sub-pixel / any label descenders; a touch of margin all round
		var nh = (board.offsetHeight || 700) + 12;
		var aw = art.clientWidth - 8;
		var ah = art.clientHeight - 10;
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
