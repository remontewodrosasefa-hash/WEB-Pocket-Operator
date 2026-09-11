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

	// Ethiopian household motifs, line-art. Swapped by mode so the screen has
	// life without competing with the readout.
	var ART = {
		jebena: '<svg viewBox="0 0 100 100"><path d="M50 8c-4 0-6 3-6 6l-2 4h16l-2-4c0-3-2-6-6-6zM38 20c-10 6-16 20-16 34 0 16 12 30 28 30s28-14 28-30c0-14-6-28-16-34zM33 44c6-6 28-6 34 0"/><path d="M66 34c10 2 16 8 12 16"/></svg>',
		mesob: '<svg viewBox="0 0 100 100"><path d="M50 10l14 12H36zM26 24h48l-6 44H32zM22 72h56l-6 16H28z"/><path d="M34 34h32M32 46h36M31 58h38"/></svg>',
		gabi: '<svg viewBox="0 0 100 100"><path d="M14 30h72v40H14z"/><path d="M14 38h72M14 62h72M22 30v40M78 30v40"/><path d="M22 44l56 12M78 44L22 56"/></svg>',
		cross: '<svg viewBox="0 0 100 100"><path d="M50 12v76M28 34h44M24 50h52M28 66h44"/><path d="M50 12c-8 6-8 14 0 20 8-6 8-14 0-20zM50 68c-8 6-8 14 0 20 8-6 8-14 0-20z"/></svg>',
		masinko: '<svg viewBox="0 0 100 100"><path d="M50 14c-9 8-9 44 0 60 9-16 9-52 0-60z"/><path d="M50 74v14M40 88h20M30 24l40 44M70 24L30 68"/></svg>'
	};
	var ART_BY_MODE = { 0: "jebena", 1: "mesob", 2: "cross", 3: "gabi", 4: "masinko", 11: "mesob" };

	// short "what this does" text, shown briefly when a control is used
	var BTN_INFO = {
		btnSound: "SOUND — pick the active sound slot, then a pad",
		btnPattern: "PATTERN — hold to select / chain patterns",
		btnBPM: "BPM — sliders set swing & tempo · double-tap = presets",
		btnFX: "FX — hold for the 16 punch-in effects; tap to cycle slider target",
		btnPlay: "PLAY — start / stop the sequencer",
		btnWrite: "WRITE — edit steps · hold 3s while playing = live record",
		btnRecord: "RECORD — sample the mic / a browser tab onto this slot"
	};

	function g(name, dflt) {
		return (typeof window[name] !== "undefined") ? window[name] : dflt;
	}

	var flashTimer;
	function flash(msg, kind) {
		var el = document.getElementById("hudFlash");
		if (!el) { return; }
		el.textContent = msg;
		el.className = "show " + (kind || "info");
		clearTimeout(flashTimer);
		flashTimer = setTimeout(function () { el.className = el.className.replace("show", "").trim(); }, 2200);
	}
	window.PO33 = window.PO33 || {};
	window.PO33.flash = flash;

	function buildHud() {
		var lcd = document.querySelector(".lcd");
		if (!lcd || document.getElementById("lcdHud")) { return; }
		var hud = document.createElement("div");
		hud.id = "lcdHud";
		hud.innerHTML =
			'<div class="hudTop"><span id="hudMode">PERFORM</span>' +
				'<button id="hudView" type="button">song</button>' +
				'<span id="hudClock"></span></div>' +
			'<div id="hudMain">—</div>' +
			'<div id="hudSub">&nbsp;</div>' +
			'<div id="hudArt"></div>' +
			'<div id="hudSong" hidden></div>' +
			'<div id="hudFlash"></div>' +
			'<div id="hudSteps"></div>';
		lcd.appendChild(hud);
		wireFeedback();

		var steps = hud.querySelector("#hudSteps");
		for (var i = 0; i < 16; i++) {
			var d = document.createElement("i");
			steps.appendChild(d);
		}
		E.mode = document.getElementById("hudMode");
		E.main = document.getElementById("hudMain");
		E.sub = document.getElementById("hudSub");
		E.clock = document.getElementById("hudClock");
		E.art = document.getElementById("hudArt");
		E.song = document.getElementById("hudSong");
		E.view = document.getElementById("hudView");
		E.steps = document.getElementById("hudSteps").children;
		if (E.view) {
			E.view.addEventListener("click", function () {
				songOpen = !songOpen;
				E.view.textContent = songOpen ? "scene" : "song";
				E.view.classList.toggle("on", songOpen);
				E.art.hidden = songOpen;
				E.song.hidden = !songOpen;
				// the mode line stays; the sound name and hint step aside so the
				// grid gets the whole screen
				var hudEl = document.getElementById("lcdHud");
				if (hudEl) { hudEl.classList.toggle("songOn", songOpen); }
				songSig = "";
				if (songOpen) { drawSong(); }
				else if (window.PO33.scene && PO33.scene.dance) { PO33.scene.dance(null); }
			});
		}
		tick();
		setInterval(tick, 130);
	}

	var E = {};

	/* ============================================================
	 * SONG VIEW
	 *
	 * A one-screen answer to "what is actually in this track?". Every sound
	 * that has something on it in this pattern gets a row of sixteen cells —
	 * filled where it hits, hollow where it rests — so the whole arrangement
	 * is readable at a glance, the way a piano roll is, but small enough to
	 * live on the device's own screen.
	 *
	 * Rows only appear for sounds that are in use, so an empty track shows an
	 * empty screen rather than sixteen blank lines.
	 * ============================================================ */

	var songOpen = false, songSig = "", songAnimEl = null;

	function songRows() {
		var pat = g("currentPattern", 0);
		var rows = [];
		for (var ch = 0; ch < 16; ch++) {
			var hits = [], any = false, locks = 0, loud = 0, soft = 0;
			for (var i = 0; i < 16; i++) {
				var on = false;
				try {
					var bt = window.newChannelArr[ch][pat][i];
					on = !!bt.noteOn;
					if (on) {
						if (bt.locked) { locks++; }
						var bv = (bt.fxVolume == null ? -12 : bt.fxVolume);
						if (bv > -8) { loud++; } else if (bv < -18) { soft++; }
					}
				} catch (e) {}
				hits.push(on);
				if (on) { any = true; }
			}
			if (!any) { continue; }
			// average pad index of the notes on this slot; low = probably bass
			var pitchSum = 0, pitchN = 0;
			for (var q = 0; q < 16; q++) {
				try {
					var b2 = window.newChannelArr[ch][pat][q];
					if (b2 && b2.noteOn) { pitchSum += (b2.notePitch || 0); pitchN++; }
				} catch (e) {}
			}
			var lowNotes = ch < 8 && pitchN > 0 && (pitchSum / pitchN) <= 5;

			var name = null;
			try { name = window.PO33Lib && PO33Lib.slotName ? PO33Lib.slotName(ch + 1) : null; } catch (e) {}
			var st = "on";
			try { st = (window.PO33 && PO33.channels) ? PO33.channels.state(ch) : "on"; } catch (e) {}
			rows.push({
				label: String(ch + 1), hits: hits, kind: ch < 8 ? "mel" : "drm",
				name: name ? shortName(name) : null, locks: locks, loud: loud, soft: soft,
				state: st, lowNotes: lowNotes
			});
		}
		// the keyboard's own track, if anything has been played onto it
		var kt = (window.PO33 && PO33.keys && PO33.keys.track) ? PO33.keys.track() : null;
		if (kt) {
			var kh = [], kany = false, voices = {};
			for (var j = 0; j < 16; j++) {
				kh.push(!!kt[j]);
				if (kt[j]) { kany = true; voices[kt[j].voice] = 1; }
			}
			if (kany) {
				rows.push({ label: "\u266a", hits: kh, kind: "key", state: "on",
					name: Object.keys(voices).join("+"), locks: 0, loud: 0, soft: 0 });
			}
		}
		return rows;
	}

	/* Which jobs in the track are covered, and which are missing.
	 *
	 * This replaces a "% full" figure that told you nothing you could act on.
	 * Knowing a bar is 53% full does not tell you what to do next; knowing it
	 * has no bass does.
	 *
	 * The guess is simple and stated as a guess: drum slots (9-16) are drums,
	 * and a melodic slot counts as bass if its notes sit in the bottom third of
	 * the pads, otherwise it is melody. The keyboard track is melody.
	 */
	function roleOf(row) {
		if (row.kind === "drm") { return "drums"; }
		if (row.kind === "key") { return "melody"; }
		return row.lowNotes ? "bass" : "melody";
	}

	function roleSummary(rows) {
		var have = {};
		rows.forEach(function (r) { if (r.state !== "mute") { have[roleOf(r)] = 1; } });
		return ["drums", "bass", "melody"].map(function (k) {
			return "<span class='" + (have[k] ? "roleOk" : "roleGap") + "'>" +
				(have[k] ? "\u2713 " : "\u2013 ") + k + "</span>";
		}).join("");
	}

	function drawSong() {
		if (!E.song) { return; }
		var rows = songRows();
		var pat = g("currentPattern", 0);
		var chain = g("patternChain", [0]);
		var tempo = g("tempo", 120);
		var scaleTxt = (window.PO33 && PO33.scale) ? PO33.scale.label() : "";
		var filled = 0;
		rows.forEach(function (r) { r.hits.forEach(function (h) { if (h) { filled++; } }); });

		// only rebuild when something actually changed
		var swing = g("swing", 0);
		var roles = roleSummary(rows);
		var muted = rows.filter(function (r) { return r.state === "mute"; }).length;
		var soloed = rows.filter(function (r) { return r.state === "solo"; }).length;
		var locks = rows.reduce(function (a, r) { return a + r.locks; }, 0);
		// a 16-step bar at this tempo, in seconds
		var barSecs = tempo > 0 ? (60 / tempo) * 4 : 0;
		var loopSecs = barSecs * chain.length;

		var sig = rows.map(function (r) {
			return r.label + r.state + r.locks + (r.lowNotes ? "L" : "") + (r.name || "") +
				r.hits.map(function (h) { return h ? 1 : 0; }).join("");
		}).join("|") + "#" + pat + "#" + tempo + "#" + swing + "#" +
			chain.join(",") + "#" + scaleTxt;
		if (sig !== songSig) {
			songSig = sig;
			var h = '<div class="songHead">' +
				"<b>PAT " + (pat + 1) + "</b>" +
				"<span>" + tempo + " BPM</span>" +
				(swing ? "<span>swing " + Math.round(swing / 10) + "%</span>" : "") +
				"<span>" + scaleTxt + "</span>" +
				"</div>";
			h += '<div class="songHead songHead2">' +
				"<span>" + rows.length + " part" + (rows.length === 1 ? "" : "s") + "</span>" +
				"<span>" + filled + " hits</span>" +
				"<span class='roleBox'>" + roles + "</span>" +
				(locks ? "<span>" + locks + " locked</span>" : "") +
				(muted ? "<span class='warnTxt'>" + muted + " muted</span>" : "") +
				(soloed ? "<span class='warnTxt'>" + soloed + " solo</span>" : "") +
				"<span class='songLen'>" + barSecs.toFixed(1) + "s bar \u00b7 " +
					loopSecs.toFixed(1) + "s loop</span>" +
				"</div>";
			if (!rows.length) {
				h += '<div class="songEmpty">nothing on this pattern yet &mdash; ' +
					'press WRITE and tap the pads</div>';
			} else {
				h += '<div class="songGrid">';
				rows.forEach(function (r) {
					h += '<div class="songRow" data-kind="' + r.kind +
						'" data-state="' + r.state + '">' +
						'<i class="songLbl">' + r.label + "</i>";
					for (var i = 0; i < 16; i++) {
						h += '<i class="songCell' + (r.hits[i] ? " on" : "") +
							(i % 4 === 0 ? " beat" : "") + '"></i>';
					}
					h += '<i class="songName">' + (r.name || "") + "</i>";
					h += "</div>";
				});
				h += "</div>";
			}
			h += '<div class="songFoot">' +
				'<span class="songChain">chain ' +
				chain.map(function (n, i) {
					return '<i' + (n === pat && i === g("patternCount", 0) ? ' class="on"' : "") +
						">" + (n + 1) + "</i>";
				}).join("") + "</span>" +
				'<canvas id="songAnim"></canvas>' +
				"</div>";
			E.song.innerHTML = h;
			songAnimEl = document.getElementById("songAnim");
		}

		// hand the footer canvas to scene.js, which owns the sprites
		if (songAnimEl && window.PO33.scene && PO33.scene.dance) { PO33.scene.dance(songAnimEl); }

		// the playhead column is cheap to move, so it updates every tick
		var beat = g("beatCount", 0), play = g("play", false);
		var grid = E.song.querySelector(".songGrid");
		if (!grid) { return; }
		Array.prototype.forEach.call(grid.children, function (row) {
			for (var i = 0; i < 16; i++) {
				var cell = row.children[i + 1];
				if (!cell) { continue; }
				var want = play && i === beat;
				if (cell.classList.contains("cur") !== want) { cell.classList.toggle("cur", want); }
			}
		});
	}

	function tick() {
		var modeEl = E.mode;
		if (!modeEl) { return; }
		// an overlay covers the LCD — don't churn behind it
		if (document.body.classList.contains("projOpen") ||
		    document.body.classList.contains("utilOpen") ||
		    document.body.classList.contains("buildOpen") ||
		    document.body.classList.contains("trimOpen")) { updateClock(); return; }

		var mode = g("mode", 0), state = g("state", 0), view = g("view", 0);
		var play = g("play", false);
		var sel = g("selectedChannel", 0);
		var pat = g("currentPattern", 0);
		var tempo = g("tempo", 120), swing = g("swing", 0), vol = g("volume", 8);
		var beat = g("beatCount", 0);
		var fxMode = g("fxMode", 0);

		var effState = state || mode;
		var mainEl = E.main;
		var subEl = E.sub;

		modeEl.textContent = MODE_NAMES[effState] || ("MODE " + effState);

		var slot = sel + 1;
		var kind = slot <= 8 ? "melodic" : "drum";
		var name = (window.PO33Lib && PO33Lib.slotName) ? PO33Lib.slotName(slot) : null;
		var sc = (slot <= 8 && window.PO33 && PO33.scale && PO33.scale.enabled()) ? ("  ♪" + PO33.scale.label()) : "";
		var soundLine = "SOUND " + slot + " · " + kind + (name ? "  " + shortName(name) : "  (default)") + sc;

		if (state === 4) {
			mainEl.textContent = tempo + " BPM";
			subEl.textContent = "swing " + Math.round(swing / 10) + "%   ·   vol " + vol + "/16";
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
		updateClock();
		if (songOpen) { drawSong(); }

		var kids = E.steps;
		var heldLock = (window.PO33 && PO33.locks) ? PO33.locks.held() : -1;
		for (var i = 0; i < 16; i++) {
			var on = false, cur = play && i === beat, lk = false, acc = "";
			try {
				var bt = window.newChannelArr && newChannelArr[sel][pat][i];
				if (bt) {
					on = !!bt.noteOn;
					lk = on && !!bt.locked;
					if (on) {
						var bv = (bt.fxVolume == null ? -12 : bt.fxVolume);
						if (bv > -8) { acc = " acc"; }
						else if (bv < -18) { acc = " ghost"; }
					}
				}
			} catch (e) {}
			var cls = (on ? "on" : "") + (cur ? " cur" : "") + (lk ? " lk" : "") + acc +
				(i === heldLock ? " held" : "");
			if (kids[i].className !== cls) { kids[i].className = cls; }
		}

		if (!window.__sceneOwnsArt) {
			var wantArt = ART_BY_MODE[effState] || "jebena";
			if (E.art && E.art.dataset.art !== wantArt) {
				E.art.dataset.art = wantArt;
				E.art.innerHTML = ART[wantArt];
			}
		}

		// live hint while FX is held
		if (window.fxHeld && !flashTimer) {
			flash("FX held · " + (FX_NAMES[fxMode] || "TONE") + " — release to keep", "tip");
		}

		// recommended next step — nudge on mode changes only, never nagging
		var ctxKey = effState + "|" + mode + "|" + (play ? 1 : 0) + "|" + (name ? 1 : 0);
		if (ctxKey !== tick._ctx) {
			tick._ctx = ctxKey;
			var tip = nextHint(effState, mode, play, name, sel, pat);
			if (tip && !flashTimer) { flash("next → " + tip, "tip"); }
		}
	}

	function updateClock() {
		if (!E.clock) { return; }
		var now = new Date();
		var t = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
		if (E.clock.textContent !== t) { E.clock.textContent = t; }
	}

	function patternHasSteps(pat) {
		try {
			for (var c = 0; c < 16; c++) {
				for (var b = 0; b < 16; b++) { if (newChannelArr[c][pat][b].noteOn) { return true; } }
			}
		} catch (e) {}
		return false;
	}

	function nextHint(state, mode, play, haveSample, sel, pat) {
		if (state === 2) { return "tap a pad to pick the slot, or click a Library sample"; }
		if (state === 4) { return "drag the sliders for swing & tempo"; }
		if (state === 3) { return "tap pads to pick / chain patterns, PATTERN to exit"; }
		if (mode === 1) {
			return patternHasSteps(pat) ? "PLAY to hear it, or WRITE to exit" : "tap pads 1-16 to add steps";
		}
		if (!haveSample && sel < 8) { return "open LIBRARY to load a sound onto this slot"; }
		if (!play && patternHasSteps(pat)) { return "press PLAY"; }
		if (!play) { return "SOUND + a pad to choose a sound, then WRITE to sequence"; }
		return "hold FX + any pad = punch-in effect";
	}

	// screen reacts to every control: show what it does, or that it did nothing
	function wireFeedback() {
		document.addEventListener("click", function (e) {
			var item = e.target.closest("[id^='btn']");
			if (!item) { return; }
			var id = item.id;
			try { if (localStorage.getItem("po33.haptics") !== "0" && navigator.vibrate) { navigator.vibrate(8); } } catch (e) {}
			if (BTN_INFO[id]) { flash(BTN_INFO[id], "info"); return; }
			if (/^btn([1-9]|1[0-6])$/.test(id)) {
				var n = +id.slice(3);
				var st = g("state", 0), md = g("mode", 0);
				if (st === 0 && md === 0 && !g("play", false)) {
					flash("pad " + n + " · playing sound " + (g("selectedChannel", 0) + 1), "info");
				} else if (md === 1) {
					flash("pad " + n + " · step " + n + " toggled", "info");
				}
			}
		}, true);

		// FX press-and-hold: enters punch-in mode; a short tap still cycles the
		// slider target as before.
		var fx = document.getElementById("btnFX");
		if (fx) {
			var downAt = 0;
			var down = function () {
				window.fxHeld = true;
				window.fxWasUsed = false;
				downAt = Date.now();
				buildFxChain(); // lazy — first hold only
				flash("FX held · pads 1-8 = effects", "tip");
			};
			var up = function () {
				window.fxHeld = false;
				// swallow the trailing click (so the mode doesn't cycle) if this
				// was a real hold or a punch-in was triggered
				if (Date.now() - downAt > 250 || window.fxWasUsed) { fx.dataset.eat = "1"; }
			};
			fx.addEventListener("mousedown", down);
			fx.addEventListener("touchstart", down, { passive: true });
			fx.addEventListener("mouseup", up);
			fx.addEventListener("mouseleave", up);
			fx.addEventListener("touchend", up);
			fx.addEventListener("click", function (e) {
				if (fx.dataset.eat) { e.stopImmediatePropagation(); e.preventDefault(); delete fx.dataset.eat; }
			}, true);
		}
	}

	/* ============================================================
	 * Punch-in FX engine — a bypassed master chain spliced between the
	 * meter and Tone.Master. Fully guarded: if the reroute fails, the
	 * app keeps working and FX just does nothing.
	 * ============================================================ */

	var fxNodes = null;

	function distTo(amt) {
		if (!fxNodes) { return; }
		try { fxNodes.dist.wet.rampTo(amt > 0 ? 1 : 0, 0.03); } catch (e) {}
		try { fxNodes.dist.distortion = amt; } catch (e) {}
	}
	function pitchTo(semis) {
		if (!fxNodes) { return; }
		try { fxNodes.pitch.pitch = semis; } catch (e) {}
	}
	function ramp(sig, val, t) { try { sig.rampTo(val, t); } catch (e) { try { sig.value = val; } catch (e2) {} } }

	// Built lazily on the FIRST FX hold so users who never touch FX pay nothing.
	// No BitCrusher (r12's is a main-thread ScriptProcessor → mobile jank).
	var fxTried = false;
	function buildFxChain() {
		if (fxNodes || fxTried || !window.Tone || !window.meter) { return; }
		fxTried = true;
		try {
			var M = Tone.Master;
			var hp     = new Tone.Filter(20, "highpass");
			var lp     = new Tone.Filter(20000, "lowpass");
			var dist   = new Tone.Distortion(0.9);      dist.wet.value = 0;
			var chorus = new Tone.Chorus(4, 2.5, 0.7);  chorus.wet.value = 0;
			var phaser = new Tone.Phaser(0.6, 3, 900);  phaser.wet.value = 0;
			var delay  = new Tone.FeedbackDelay(0.19, 0.34); delay.wet.value = 0;
			var pong   = new Tone.PingPongDelay(0.25, 0.45); pong.wet.value = 0;
			var pitch  = new Tone.PitchShift(0);
			var verb   = new Tone.Freeverb(0.85, 3000); verb.wet.value = 0;
			var wob    = new Tone.AutoFilter(5, 200, 4); wob.wet.value = 0;
			try { wob.start(); } catch (e) {}
			var trem   = new Tone.Tremolo(13, 0);
			try { trem.start(); } catch (e) {}
			// a dedicated, always-in-chain filter driven by an LFO (off by default)
			var lfoFilt = new Tone.Filter(20000, "lowpass");
			var lfo     = new Tone.LFO(4, 400, 6000);
			lfo.type = "sine";
			try { lfo.connect(lfoFilt.frequency); } catch (e) {}
			var kill   = new Tone.Gain(1);

			hp.chain(lp, dist, chorus, phaser, delay, pong, pitch, verb, wob, trem, lfoFilt, kill, M);

			var rerouted = false;
			try {
				try { meter.disconnect(); } catch (e) { try { meter.disconnect(0); } catch (e2) {} }
				meter.connect(hp);
				rerouted = true;
			} catch (e) {
				try { meter.connect(M); } catch (e2) {}
			}
			if (!rerouted) { return; }

			fxNodes = { hp: hp, lp: lp, dist: dist, chorus: chorus, phaser: phaser, lfoFilt: lfoFilt, lfo: lfo,
				delay: delay, pong: pong, pitch: pitch, verb: verb, wob: wob,
				trem: trem, kill: kill };
		} catch (e) {
			fxNodes = null;
		}
	}

	/* ---- persistent LFO -> master filter ---- */
	var lfoOn = false;
	function setLfo(opts) {
		opts = opts || {};
		var toggled = opts.on != null;
		if (toggled) { lfoOn = !!opts.on; }
		if (lfoOn) { buildFxChain(); }
		if (!fxNodes || !fxNodes.lfo) { return lfoState(); }
		var f = fxNodes;
		try {
			if (opts.rate != null) { f.lfo.frequency.value = Math.max(0.05, +opts.rate); }
			if (opts.wave) { f.lfo.type = opts.wave; }
			if (opts.depth != null) {
				var d = Math.max(0, Math.min(1, +opts.depth));   // 0..1
				var floor = 8000 - d * 7800;                      // deeper = lower floor
				f.lfo.min = 20 + floor * 0.05;
				f.lfo.max = Math.max(f.lfo.min + 50, 8000);
			}
			if (lfoOn) { f.lfo.start(); }
			else { f.lfo.stop(); ramp(f.lfoFilt.frequency, 20000, 0.15); }
		} catch (e) {}
		persistLfo();
		if (toggled) { flash("LFO " + (lfoOn ? "on" : "off"), lfoOn ? "warn" : "tip"); }
		return lfoState();
	}
	function lfoState() {
		var f = fxNodes;
		return {
			on: lfoOn,
			rate: f && f.lfo ? Math.round(f.lfo.frequency.value * 100) / 100 : 4,
			wave: f && f.lfo ? f.lfo.type : "sine"
		};
	}
	function persistLfo() {
		try { localStorage.setItem("po33.lfo", JSON.stringify(lfoState())); } catch (e) {}
	}
	function restoreLfo() {
		var v;
		try { v = JSON.parse(localStorage.getItem("po33.lfo") || "null"); } catch (e) {}
		if (v && v.on) { setLfo({ on: true, rate: v.rate, wave: v.wave, depth: 0.6 }); }
	}
	/* ---- hooks for the performance strip ---- */

	// XY pad: x = filter cutoff (low->high), y = resonance
	function xy(nx, ny, on) {
		buildFxChain();
		if (!fxNodes) { return; }
		var f = fxNodes;
		if (!on) {
			ramp(f.lp.frequency, 20000, 0.15);
			ramp(f.hp.frequency, 20, 0.15);
			try { f.lp.Q.value = 1; } catch (e) {}
			return;
		}
		nx = Math.max(0, Math.min(1, nx));
		ny = Math.max(0, Math.min(1, ny));
		// left half sweeps a lowpass down, right half opens a highpass up
		if (nx < 0.5) {
			var lo = Math.exp(Math.log(180) + (Math.log(20000) - Math.log(180)) * (nx / 0.5));
			ramp(f.lp.frequency, lo, 0.03);
			ramp(f.hp.frequency, 20, 0.03);
		} else {
			var hi = Math.exp(Math.log(20) + (Math.log(4000) - Math.log(20)) * ((nx - 0.5) / 0.5));
			ramp(f.hp.frequency, hi, 0.03);
			ramp(f.lp.frequency, 20000, 0.03);
		}
		try { f.lp.Q.value = 0.7 + ny * 12; f.hp.Q.value = 0.7 + ny * 12; } catch (e) {}
	}

	// XY "space" mode: throw echo and reverb over whatever is playing.
	// x = how much echo (and how long it keeps repeating), y = size of the room.
	function space(nx, ny, on) {
		buildFxChain();
		if (!fxNodes) { return; }
		var f = fxNodes;
		if (!on) {
			ramp(f.delay.wet, 0, 0.25);
			ramp(f.verb.wet, 0, 0.35);
			return;
		}
		nx = Math.max(0, Math.min(1, nx));
		ny = Math.max(0, Math.min(1, ny));
		try { f.delay.feedback.value = 0.15 + nx * 0.65; } catch (e) {}
		try { f.delay.delayTime.value = 0.12 + (1 - nx) * 0.22; } catch (e) {}
		ramp(f.delay.wet, nx * 0.7, 0.05);
		try { f.verb.roomSize.value = 0.4 + ny * 0.55; } catch (e) {}
		ramp(f.verb.wet, ny * 0.75, 0.08);
	}

	// one-shot access to the punch-in effects from anywhere
	function punch(n, on) {
		buildFxChain();
		if (on) { fxOn(n); } else { fxOff(); }
	}

	window.PO33.fx = {
		lfo: setLfo, lfoState: lfoState, buildChain: buildFxChain,
		xy: xy, space: space, punch: punch,
		labels: function () { return FX_LABELS; },
		help: function () { return FX_HELP; }
	};

	// LFO controls may live in the info drawer or the UTIL panel — listen globally
	document.addEventListener("click", function (e) {
		if (e.target && e.target.id === "lfoBtn") {
			var st = lfoState();
			var r = document.getElementById("lfoRate"), d = document.getElementById("lfoDepth"),
				w = document.getElementById("lfoWave");
			var now = setLfo({ on: !st.on,
				rate: r ? (+r.value) / 100 : 4,
				depth: d ? (+d.value) / 100 : 0.6,
				wave: w ? w.value : "sine" });
			e.target.textContent = now.on ? "LFO on" : "LFO off";
		}
	});
	document.addEventListener("input", function (e) {
		var id = e.target && e.target.id;
		if (id !== "lfoRate" && id !== "lfoDepth") { return; }
		var r = document.getElementById("lfoRate"), d = document.getElementById("lfoDepth");
		setLfo({ rate: r ? (+r.value) / 100 : 4, depth: d ? (+d.value) / 100 : 0.6 });
	});
	document.addEventListener("change", function (e) {
		if (e.target && e.target.id === "lfoWave") { setLfo({ wave: e.target.value }); }
	});

	/* ============================================================
	 * The sixteen punch-in effects, matched to the real PO-33 KO II.
	 *
	 * Most of them are NOT audio effects at all on the hardware — they bend
	 * the sequencer: they shorten the loop, reverse the step pointer, stutter
	 * it or pin the pattern chain. So they are split in two:
	 *
	 *   step  – remaps the step the sequencer reads (js/po33.js calls
	 *           window.po33Fx.mapStep on every 16th) and can pin the chain
	 *   audio – the master FX chain (unison / octave / scratch)
	 *
	 * Both are momentary: they last exactly as long as the pad is held.
	 * ============================================================ */

	var FX_LABELS = ["",
		"LOOP 16", "LOOP 12", "LOOP SHORT", "LOOP SHORTER",
		"UNISON", "UNISON LOW", "OCTAVE UP", "OCTAVE DOWN",
		"STUTTER 4", "STUTTER 3", "SCRATCH", "SCRATCH FAST",
		"6/8 QUANTIZE", "RETRIGGER", "REVERSED", "NO EFFECT"];

	var FX_HELP = ["",
		"loops the whole 16-step bar and stops the chain moving on",
		"loops the first 12 steps — the bar limps, everything shifts",
		"loops 4 steps around where you are",
		"loops 2 steps — near-machine-gun",
		"thickens the whole beat into one wide layer",
		"unison with the low end pushed, good under drums",
		"whole beat an octave up",
		"whole beat an octave down",
		"holds each step across a group of 4",
		"holds each step across a group of 3 — 3-against-4",
		"pitch-bends the held step like a hand on a record",
		"the same scratch, twice the speed",
		"forces a triplet 6/8 shuffle onto the grid",
		"re-fires the pattern from step 1 every 4 steps",
		"plays the bar backwards",
		"bypass — the safe pad, kills whatever was running"];

	/* ---- step-pointer side ---- */

	// LOOP / RETRIGGER / REVERSE pin the chain so the same pattern repeats
	// instead of walking on to the next link.
	var CHAIN_PINNED = { 1: 1, 2: 1, 3: 1, 4: 1, 11: 1, 12: 1, 14: 1, 15: 1 };

	var stepFx = 0;      // 0 = no step effect
	var stepAnchor = 0;  // raw step the effect was engaged on
	var lastRaw = 0;

	function mapStep(raw) {
		lastRaw = raw;
		switch (stepFx) {
			case 1:  return raw;                                  // loop 16 (chain pinned)
			case 2:  return raw % 12;                             // loop 12
			case 3:  return (stepAnchor & ~3) + (raw % 4);         // loop short  (4 steps)
			case 4:  return (stepAnchor & ~1) + (raw % 2);         // loop shorter (2 steps)
			case 9:  return Math.floor(raw / 4) * 4;               // stutter 4
			case 10: return (Math.floor(raw / 3) * 3) % 16;        // stutter 3
			case 11:
			case 12: return stepAnchor;                            // scratch: one step, bent
			case 14: return raw % 4;                               // retrigger from the top
			case 15: return 15 - raw;                              // reversed
			default: return raw;
		}
	}
	function holdChain() { return !!CHAIN_PINNED[stepFx]; }

	window.po33Fx = { mapStep: mapStep, holdChain: holdChain };

	/* ---- scratch: a hand rocking the record back and forth ---- */
	var scratchTimer = null;
	function scratch(periodMs, depth) {
		clearInterval(scratchTimer);
		var t0 = Date.now();
		scratchTimer = setInterval(function () {
			var ph = ((Date.now() - t0) % periodMs) / periodMs;      // 0..1
			var tri = ph < 0.5 ? (ph * 4 - 1) : (3 - ph * 4);         // -1..1..-1
			pitchTo(tri * depth);
		}, 24);
	}
	function scratchOff() { clearInterval(scratchTimer); scratchTimer = null; pitchTo(0); }

	/* ---- 6/8: a triplet shuffle forced onto the 16ths ---- */
	var swingSaved = null;
	function sixEight(on) {
		if (!window.Tone || !Tone.Transport) { return; }
		try {
			if (on) {
				if (swingSaved == null) {
					swingSaved = { s: Tone.Transport.swing, d: Tone.Transport.swingSubdivision };
				}
				Tone.Transport.swingSubdivision = "8n";
				Tone.Transport.swing = 0.62;
			} else if (swingSaved) {
				Tone.Transport.swing = swingSaved.s;
				Tone.Transport.swingSubdivision = swingSaved.d;
				swingSaved = null;
			}
		} catch (e) {}
	}

	function fxOn(n) {
		window.fxWasUsed = true;
		flash((FX_LABELS[n] || ("FX " + n)) + " — " + (FX_HELP[n] || ""), "warn");

		// every press starts from a clean slate so pads never stack up
		clearStep();
		if (fxNodes) { audioOff(); }

		stepAnchor = lastRaw;
		if (n !== 16) { stepFx = n; }

		if (!fxNodes) { return; }
		var f = fxNodes;
		switch (n) {
			case 5:  // unison — wide, slow chorus plus a touch of drive for glue
				try { f.chorus.frequency.value = 0.8; f.chorus.depth = 0.75; } catch (e) {}
				ramp(f.chorus.wet, 1, 0.03);
				distTo(0.18);
				break;
			case 6:  // unison low — same, weighted to the bottom
				try { f.chorus.frequency.value = 0.6; f.chorus.depth = 0.9; } catch (e) {}
				ramp(f.chorus.wet, 1, 0.03);
				ramp(f.lp.frequency, 2200, 0.05);
				distTo(0.3);
				break;
			case 7:  pitchTo(12); break;
			case 8:  pitchTo(-12); break;
			case 11: scratch(300, 10); break;
			case 12: scratch(130, 7); break;
			case 13: sixEight(true); break;
			case 16: break;   // no effect: the bypass pad
		}
	}

	function clearStep() {
		stepFx = 0;
		scratchOff();
		sixEight(false);
	}

	// reset only the audio chain — used both on release and between presses
	function audioOff() {
		var f = fxNodes;
		if (!f) { return; }
		ramp(f.lp.frequency, 20000, 0.12);
		ramp(f.hp.frequency, 20, 0.12);
		ramp(f.delay.wet, 0, 0.12);
		ramp(f.pong.wet, 0, 0.12);
		ramp(f.verb.wet, 0, 0.15);
		ramp(f.chorus.wet, 0, 0.08);
		ramp(f.phaser.wet, 0, 0.08);
		ramp(f.wob.wet, 0, 0.08);
		ramp(f.trem.depth, 0, 0.06);
		ramp(f.kill.gain, 1, 0.02);
		pitchTo(0);
		distTo(0);
	}

	function fxOff() {
		clearStep();
		audioOff();
	}

	function wireFxPads() {
		for (var n = 1; n <= 16; n++) {
			(function (n) {
				var el = document.getElementById("btn" + n);
				if (!el || el.dataset.fxWired) { return; }
				el.dataset.fxWired = "1";
				el.addEventListener("pointerdown", function (e) {
					if (!window.fxHeld) { return; }
					e.stopImmediatePropagation();
					e.preventDefault();
					el.dataset.fxFired = "1";
					fxOn(n);
					var end = function () {
						fxOff();
						window.removeEventListener("pointerup", end, true);
						window.removeEventListener("pointercancel", end, true);
						setTimeout(function () { delete el.dataset.fxFired; }, 300);
					};
					window.addEventListener("pointerup", end, true);
					window.addEventListener("pointercancel", end, true);
				}, true);
				el.addEventListener("click", function (e) {
					if (window.fxHeld || el.dataset.fxFired) {
						e.stopImmediatePropagation();
						e.preventDefault();
					}
				}, true);
			})(n);
		}
	}

	function shortName(id) {
		return "[" + String(id).replace(/^.*\//, "") + "]";
	}

	/* ============================================================
	 * 2. Recorder
	 * ============================================================ */

	var mediaRec = null, chunks = [], recTimer = null, recStart = 0, recStream = null;
	var recTargetSlot = null;   // the pad that was held when recording started
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
		// lock in whichever pad is held right now — the hardware behaviour
		recTargetSlot = (window.PO33 && PO33.heldPad && PO33.heldPad()) || null;
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

	/* ---- export the mix as MP3 (records the master bus, encodes with lamejs) ---- */

	var expRec = null, expChunks = [], expDest = null;

	function loadLame() {
		return new Promise(function (res, rej) {
			if (window.lamejs) { return res(); }
			var s = document.createElement("script");
			s.src = "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js";
			s.onload = res; s.onerror = rej;
			document.head.appendChild(s);
		});
	}

	function wireExport() {
		var wrap = document.getElementById("recWrap");
		if (!wrap || document.getElementById("expBtn")) { return; }
		var b = document.createElement("button");
		b.id = "expBtn"; b.type = "button"; b.textContent = "⬇ mp3";
		b.title = "record the mix and export as MP3";
		b.addEventListener("click", toggleExport);
		wrap.appendChild(b);
	}

	function toggleExport() {
		var b = document.getElementById("expBtn");
		if (expRec && expRec.state === "recording") { expRec.stop(); return; }
		loadLame().then(function () {
			var raw = (window.Tone && Tone.context && (Tone.context._context || Tone.context)) || null;
			if (!raw || !raw.createMediaStreamDestination) { status("export not supported here"); return; }
			expDest = raw.createMediaStreamDestination();
			try { Tone.Master.connect(expDest); } catch (e) { status("export: routing failed"); return; }
			expChunks = [];
			expRec = new MediaRecorder(expDest.stream);
			expRec.ondataavailable = function (e) { if (e.data.size) { expChunks.push(e.data); } };
			expRec.onstop = finishExport;
			expRec.start();
			b.textContent = "■ stop & save";
			b.classList.add("recording");
			flash("recording the mix — press stop to save MP3", "tip");
		}).catch(function () { status("could not load MP3 encoder (offline?)"); });
	}

	async function finishExport() {
		var b = document.getElementById("expBtn");
		b.textContent = "⬇ mp3";
		b.classList.remove("recording");
		try { Tone.Master.disconnect(expDest); } catch (e) {}
		var raw = Tone.context._context || Tone.context;
		var buf = await new Blob(expChunks).arrayBuffer();
		var audio;
		try { audio = await raw.decodeAudioData(buf.slice(0)); }
		catch (e) { status("export: decode failed"); return; }

		status("encoding MP3…");
		var mp3 = encodeMp3(audio);
		var url = URL.createObjectURL(mp3);
		var a = document.createElement("a");
		a.href = url; a.download = "po33-mix-" + Date.now() + ".mp3"; a.textContent = "download MP3";
		a.className = "recDl";
		var s = document.getElementById("recStatus");
		s.textContent = "mix ready · ";
		s.appendChild(a);
	}

	function encodeMp3(audio) {
		var ch = Math.min(2, audio.numberOfChannels);
		var enc = new lamejs.Mp3Encoder(ch, audio.sampleRate, 128);
		var l = audio.getChannelData(0);
		var r = ch > 1 ? audio.getChannelData(1) : l;
		var block = 1152, out = [];
		var li = new Int16Array(block), ri = new Int16Array(block);
		for (var i = 0; i < l.length; i += block) {
			var n = Math.min(block, l.length - i);
			for (var j = 0; j < n; j++) {
				li[j] = Math.max(-1, Math.min(1, l[i + j])) * 32767;
				ri[j] = Math.max(-1, Math.min(1, r[i + j])) * 32767;
			}
			var chunk = ch > 1 ? enc.encodeBuffer(li.subarray(0, n), ri.subarray(0, n))
			                   : enc.encodeBuffer(li.subarray(0, n));
			if (chunk.length) { out.push(chunk); }
		}
		var end = enc.flush();
		if (end.length) { out.push(end); }
		return new Blob(out, { type: "audio/mp3" });
	}

	/* ---- IndexedDB: recordings survive a reload ---- */

	function idbOpen() {
		return new Promise(function (res, rej) {
			var r = indexedDB.open("po33", 1);
			r.onupgradeneeded = function () {
				if (!r.result.objectStoreNames.contains("rec")) { r.result.createObjectStore("rec"); }
			};
			r.onsuccess = function () { res(r.result); };
			r.onerror = function () { rej(r.error); };
		});
	}
	function idbPut(name, blob, seconds) {
		if (!window.indexedDB) { return; }
		idbOpen().then(function (db) {
			var tx = db.transaction("rec", "readwrite");
			tx.objectStore("rec").put({ blob: blob, seconds: seconds }, name);
		}).catch(function () {});
	}
	window.PO33.idbPut = idbPut;

	function idbRestore() {
		if (!window.indexedDB || !window.PO33Lib) { return; }
		idbOpen().then(function (db) {
			var tx = db.transaction("rec", "readonly");
			var store = tx.objectStore("rec");
			var keys = store.getAllKeys(), vals = store.getAll();
			keys.onsuccess = function () {
				vals.onsuccess = function () {
					keys.result.forEach(function (name, i) {
						var v = vals.result[i];
						if (!v || !v.blob) { return; }
						var url = URL.createObjectURL(v.blob);
						PO33Lib.addUserSample(name, url, v.seconds || null);
					});
				};
			};
		}).catch(function () {});
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

		var slot = recTargetSlot || (window.PO33 && PO33.targetSlot ? PO33.targetSlot() : PO33Lib.currentSlot());
		recTargetSlot = null;
		if (window.PO33Lib) {
			PO33Lib.addUserSample(name, url, secs);
			PO33Lib.assignUrl(slot, url, "recordings/" + name, secs);
		}
		idbPut(name, wavBlob, secs); // persist across reloads

		var s = document.getElementById("recStatus");
		s.innerHTML = "saved " + secs + 's → SOUND ' + slot + ' &nbsp;';
		var dl = document.createElement("a");
		dl.href = url; dl.download = name + ".wav"; dl.textContent = "download .wav";
		dl.className = "recDl";
		s.appendChild(dl);

		// offer to chop the fresh recording across a drum slot's 16 pads
		if (window.PO33 && PO33.slice) {
			var chop = document.createElement("button");
			chop.id = "recSlice";
			chop.type = "button";
			chop.textContent = "\u2702 chop x16";
			chop.title = "slice this recording across the 16 pads of a drum slot";
			chop.addEventListener("click", function () {
				var target = slot >= 9 ? slot : 16;
				PO33.slice.toSlot(audioBuf, target, 16, { layout: true, matchTempo: true });
			});
			s.appendChild(chop);
		}
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
			// dialFunction only writes fxPitch, which playback never reads.
			// In TONE mode slider 1 is PITCH, so drive the note the engine
			// actually plays (notePitch, 0-15) as well.
			if (n === 1 && g("state", 0) !== 4 && g("fxMode", 0) === 0) {
				try {
					var ch = g("selectedChannel", 0);
					var v = Math.max(0, Math.min(15, Math.round(+el.value / 1000 * 15)));
					window.channelSettingsArr[ch].notePitch = v;
					window.selectedPitch = v;
				} catch (e) {}
			}
		};
		el.addEventListener("input", function () { apply(); readout(n); });

		// live tempo preview: hear the click while you drag, on the BPM screen
		// only (bpmPreview itself also checks, so this is just tidy start/stop)
		if (n === 1 || n === 2) {
			var startPreview = function () { if (window.PO33 && PO33.bpmPreview) { PO33.bpmPreview.start(); } };
			var stopPreview = function () { if (window.PO33 && PO33.bpmPreview) { PO33.bpmPreview.stop(); } };
			el.addEventListener("pointerdown", startPreview);
			el.addEventListener("pointerup", stopPreview);
			el.addEventListener("pointercancel", stopPreview);
			el.addEventListener("pointerleave", stopPreview);
		}

		// mouse wheel over a slider also turns it
		el.addEventListener("wheel", function (ev) {
			ev.preventDefault();
			el.value = Math.max(0, Math.min(1000, +el.value + (ev.deltaY < 0 ? 30 : -30)));
			apply();
		}, { passive: false });
	}

	// after dialFunction has run, report what the value actually became
	function readout(n) {
		if (window.PO33 && PO33.locks && PO33.locks.held() >= 0) { return; } // lock bar owns the screen
		var st = g("state", 0), fx = g("fxMode", 0);
		var cs;
		try { cs = window.channelSettingsArr[g("selectedChannel", 0)]; } catch (e) {}
		if (st === 4) {
			flash(n === 1 ? ("swing " + Math.round(g("swing", 0) / 10) + "%")
			              : (g("tempo", 120) + " BPM"), "info");
			return;
		}
		if (!cs) { return; }
		if (fx === 1) {
			flash(n === 1
				? ((cs.fxFilterType === "lowpass" ? "LPF " : "HPF ") + Math.round(cs.fxFilterFreq) + " Hz")
				: ("resonance " + (Math.round((cs.fxFilterRes || 0) * 10) / 10)), "info");
		} else if (fx === 2) {
			flash(n === 1 ? ("start " + Math.round((cs.fxTrim || 0) / 10) + "%")
			              : ("length " + Math.round((cs.fxLength == null ? 1000 : cs.fxLength) / 10) + "%"), "info");
		} else {
			flash(n === 1 ? ("pitch · pad " + ((cs.notePitch || 0) + 1))
			              : ("sample vol " + (Math.round((cs.fxVolume || 0) * 10) / 10) + " dB"), "info");
		}
	}

	var SLIDER_LABELS = {
		4: ["swing", "tempo"],       // BPM mode
		"0": ["pitch", "sample vol"],// FX: tone  (distinct from the master slider)
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

	/* ---- clear helpers (exposed on window.PO33) ---- */

	function clearPattern() {
		// the keyboard track is stored outside newChannelArr, so it has to be
		// cleared alongside it or a "cleared" pattern still plays synth notes
		try { if (window.PO33.keys && PO33.keys.clearPattern) { PO33.keys.clearPattern(); } } catch (e) {}
		var p = g("currentPattern", 0);
		try {
			for (var c = 0; c < 16; c++) {
				for (var b = 0; b < 16; b++) { window.newChannelArr[c][p][b].noteOn = 0; }
			}
			try { window.PO33.session.save(); } catch (e2) {}
			if (window.updateDisplay) { window.updateDisplay(); }
			flash("pattern " + (p + 1) + " cleared", "warn");
		} catch (e) { flash("could not clear pattern", "warn"); }
	}

	var clearAllClicks = 0, clearAllTimer;
	function clearAll(btn) {
		clearAllClicks++;
		clearTimeout(clearAllTimer);
		if (clearAllClicks >= 3) {
			clearAllClicks = 0;
			try { localStorage.clear(); } catch (e) {}
			location.reload();
			return;
		}
		var left = 3 - clearAllClicks;
		flash("clear EVERYTHING — press " + left + " more time" + (left > 1 ? "s" : ""), "warn");
		if (btn) { btn.textContent = "clear all · " + left + " more"; }
		clearAllTimer = setTimeout(function () {
			clearAllClicks = 0;
			if (btn) { btn.textContent = "clear everything (triple-click)"; }
		}, 1500);
	}

	// arm live record without the hidden 3-second WRITE hold
	function liveRec() {
		if (!g("play", false)) { flash("press PLAY first, then arm live rec", "warn"); return false; }
		try {
			window.btnWriteHold = true;
			window.mode = 0;                    // so writeButtonFunction lands on 11
            window.writeButtonFunction();
			window.btnWriteHold = false;
			flash("LIVE REC armed — play the pads", "warn");
			return true;
		} catch (e) { return false; }
	}
	window.PO33.liveRec = liveRec;

	window.PO33.clearPattern = clearPattern;
	window.PO33.clearAll = clearAll;

	/* ---- metronome (Transport-scheduled, so it stays in time) ---- */

	var metroSynth = null, metroId = null;

	function metroOn() { try { return localStorage.getItem("po33.metro") === "1"; } catch (e) { return false; } }

	function setMetro(on) {
		try { localStorage.setItem("po33.metro", on ? "1" : "0"); } catch (e) {}
		try {
            if (on) {
                if (!metroSynth) {
                    metroSynth = new Tone.Synth({
                        oscillator: { type: "square" },
                        envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 }
                    }).toMaster();
                    metroSynth.volume.value = -18;
                }
                if (metroId === null) {
                    var count = 0;
                    metroId = Tone.Transport.scheduleRepeat(function (time) {
                        metroSynth.triggerAttackRelease(count % 4 === 0 ? "C6" : "C5", "64n", time);
                        count++;
                    }, "4n");
                }
            } else if (metroId !== null) {
                Tone.Transport.clear(metroId);
                metroId = null;
            }
		} catch (e) {}
		flash("metronome " + (on ? "on" : "off"), "info");
	}

	window.PO33.metro = {
		toggle: function () { var v = !metroOn(); setMetro(v); return v; },
		isOn: metroOn
	};

	/* ---- grab a slider and it takes the whole row ----
	 * Three sliders side by side on a phone is far too fine for swing or tempo.
	 * While you're holding one, the others collapse and it gets the full width.
	 * You never need two at once — dialFunction only handles one anyway.
	 */
	function wireSliderExpand() {
		var row = document.querySelector(".sliderRow");
		if (!row || row.dataset.expand) { return; }
		row.dataset.expand = "1";
		var active = null;
		var grab = function (e) {
			var w = e.target.closest(".sliderWrap");
			if (!w) { return; }
			active = w;
			row.classList.add("expanded");
			w.classList.add("active");
		};
		var release = function () {
			if (!active) { return; }
			active.classList.remove("active");
			row.classList.remove("expanded");
			active = null;
		};
		row.addEventListener("pointerdown", grab, true);
		window.addEventListener("pointerup", release, true);
		window.addEventListener("pointercancel", release, true);
	}

	function wireVolume() {
		var el = document.getElementById("sliderVol");
		if (!el || el.dataset.wired) { return; }
		el.dataset.wired = "1";
		var apply = function (announce) {
			var pct = +el.value;                 // 0..100
			var db = pct === 0 ? -60 : (pct / 100) * 40 - 40;  // -40..0 dB
			try { if (window.Tone) { Tone.Master.volume.value = db; } } catch (e) {}
			window.volume = Math.round(pct / 100 * 16);
			window.mainVolume = db;
			if (announce) { flash("master volume " + pct + "%", "info"); }
		};
		el.addEventListener("input", function () { apply(true); });
		apply(false);
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
		wireVolume();
		wireSliderExpand();
		wireTouchShims();
		wireFxPads();
		// FX chain is built lazily on the first FX hold — nothing to do here
		var tries = 0;
		var iv = setInterval(function () {
			var haveRec = buildRecorder();
			if (haveRec) { wireRecordPad(); wireExport(); }
			if (haveRec || ++tries > 60) { clearInterval(iv); }
		}, 250);
		setTimeout(idbRestore, 1800);
		setTimeout(function () { if (metroOn()) { setMetro(true); } }, 1200);
		setTimeout(restoreLfo, 1400);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else { boot(); }
})();
