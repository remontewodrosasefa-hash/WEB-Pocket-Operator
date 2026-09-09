/* scene.js — ambient pixel-art farm on the LCD.
 * Lives in the #hudArt band (below the readout, above the step bar), never
 * covers text. It grows the longer you use the unit and reacts to every
 * button press. This is the always-visible teaser of the full FARM screen.
 *
 * Art: "Sprout Lands - Basic pack" by Cup Nooble (non-commercial licence).
 * Only the sprites used are committed, in game/sprites/.
 */
(function () {
	"use strict";

	var SRC = "game/sprites/";
	// [sheet, sx, sy, sw, sh]  — tweak here if a crop looks off
	var SPR = {
		ground:  ["grass",   8,  96, 16, 16],
		tuft:    ["grass",  120, 96, 16, 16],
		bush:    ["biome",    0,  60, 30, 20],
		tree:    ["biome",    2,   0, 36, 50],
		rock:    ["biome",  128,   8, 16, 16],
		mush:    ["biome",   96,   0, 16, 16],
		log:     ["biome",   80,  28, 26, 14],
		coop:    ["coop",     0,   0, 48, 48],
		cropA:   ["plants",  16,  16, 16, 16],
		cropB:   ["plants",  32,  16, 16, 16],
		cropC:   ["plants",  48,  16, 16, 16],
		cropD:   ["plants",  64,  16, 16, 16],
		chkIdle0:["chicken",  0,   0, 16, 16],
		chkIdle1:["chicken", 16,   0, 16, 16],
		chkWalk0:["chicken",  0,  16, 16, 16],
		chkWalk1:["chicken", 16,  16, 16, 16]
	};

	// xp milestones -> what's on the farm
	var STAGES = [
		{ xp: 0,   has: ["tuft"] },
		{ xp: 6,   has: ["tuft", "bush"] },
		{ xp: 18,  has: ["tuft", "bush", "rock"] },
		{ xp: 35,  has: ["tuft", "bush", "rock", "tree"] },
		{ xp: 70,  has: ["tuft", "bush", "tree", "chicken", "crop"] },
		{ xp: 140, has: ["tuft", "bush", "tree", "chicken2", "crop"] },
		{ xp: 280, has: ["tuft", "bush", "tree", "chicken2", "crop", "coop"] },
		{ xp: 550, has: ["tuft", "bush", "tree", "chicken3", "cropFull", "coop"] }
	];

	var sheets = {}, ready = false, host, cv, ctx, W = 0, H = 0, DPR = 1;
	var xp = 0, chickens = [], puffs = [], lastTick = 0, reactUntil = 0;

	function loadXp() {
		try { xp = parseInt(localStorage.getItem("po33.scene.xp"), 10) || 0; } catch (e) { xp = 0; }
	}
	function saveXp() {
		try { localStorage.setItem("po33.scene.xp", String(xp)); } catch (e) {}
	}
	window.PO33 = window.PO33 || {};
	window.PO33.scene = {
		xp: function () { return xp; },
		add: function (n) { bump(n || 1); },
		reset: function () { xp = 0; saveXp(); }
	};

	function stage() {
		var st = STAGES[0];
		for (var i = 0; i < STAGES.length; i++) { if (xp >= STAGES[i].xp) { st = STAGES[i]; } }
		return st;
	}
	function nextStageXp() {
		for (var i = 0; i < STAGES.length; i++) { if (xp < STAGES[i].xp) { return STAGES[i].xp; } }
		return null;
	}

	function bump(n) {
		var before = stage();
		xp += n;
		saveXp();
		reactUntil = performance.now() + 260;   // little hop on the chickens
		if (chickens.length) { chickens[0].hop = 8; }
		puffs.push({ x: 10 + Math.random() * (W - 20), y: H - 6, life: 1 });
		if (stage() !== before) {
			puffs.push({ x: W / 2, y: H / 2, life: 1, big: true });
			if (window.PO33 && PO33.flash) { PO33.flash("farm grew — " + newThing(before, stage()), "tip"); }
		}
		syncChickens();
	}
	function newThing(a, b) {
		var added = b.has.filter(function (x) { return a.has.indexOf(x) === -1; });
		return (added[0] || "nice").replace(/\d/, "").replace("cropFull", "harvest");
	}

	function syncChickens() {
		var h = stage().has;
		var want = h.indexOf("chicken3") > -1 ? 3 : h.indexOf("chicken2") > -1 ? 2 : h.indexOf("chicken") > -1 ? 1 : 0;
		while (chickens.length < want) {
			chickens.push({ x: 20 + chickens.length * 22, dir: 1, t: Math.random() * 100, hop: 0, peck: 0 });
		}
		chickens.length = want;
	}

	/* ---------- loading ---------- */

	function loadSheets(done) {
		var names = ["grass", "biome", "plants", "coop", "chicken"];
		var left = names.length;
		names.forEach(function (n) {
			var img = new Image();
			img.onload = img.onerror = function () { if (--left === 0) { done(); } };
			img.src = SRC + n + ".png";
			sheets[n] = img;
		});
	}

	function draw(key, dx, dy, scale) {
		var s = SPR[key];
		if (!s) { return; }
		var img = sheets[s[0]];
		if (!img || !img.width) { return; }
		scale = scale || 1;
		ctx.drawImage(img, s[1], s[2], s[3], s[4],
			Math.round(dx), Math.round(dy), s[3] * scale, s[4] * scale);
	}

	/* ---------- build / size ---------- */

	function build() {
		host = document.getElementById("hudArt");
		if (!host || cv) { return !!host; }
		window.__sceneOwnsArt = true;             // tell studio.js to leave #hudArt alone
		host.innerHTML = "";
		host.style.opacity = "1";
		cv = document.createElement("canvas");
		cv.id = "sceneCanvas";
		host.appendChild(cv);
		ctx = cv.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		cv.addEventListener("pointerdown", function () { bump(2); });
		resize();
		if (window.ResizeObserver) { new ResizeObserver(resize).observe(host); }
		return true;
	}

	function resize() {
		if (!host) { return; }
		var r = host.getBoundingClientRect();
		W = Math.max(80, Math.floor(r.width));
		H = Math.max(28, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
	}

	/* ---------- render loop ---------- */

	function frame(now) {
		requestAnimationFrame(frame);
		if (!ctx || !W) { return; }
		var dt = Math.min(60, now - lastTick); lastTick = now;
		ctx.clearRect(0, 0, W, H);

		var groundY = H - 10;

		// ground strip
		var s = SPR.ground;
		for (var gx = 0; gx < W; gx += 16) { draw("ground", gx, H - 16); }

		var has = stage().has;
		var farRight = W - 4;

		// static-ish props, back to front
		if (has.indexOf("tree") > -1)  { draw("tree", farRight - 30, groundY - 44); }
		if (has.indexOf("coop") > -1)  { draw("coop", 4, groundY - 42); }
		if (has.indexOf("bush") > -1)  { draw("bush", W * 0.32, groundY - 20); }
		if (has.indexOf("rock") > -1)  { draw("rock", W * 0.62, groundY - 12); }
		if (xp > 100) { draw("mush", W * 0.5, groundY - 12); }
		if (xp > 200) { draw("log", W * 0.14, groundY - 12); }
		draw("tuft", 6, groundY - 12);
		draw("tuft", W - 22, groundY - 12);

		// crop patch, grows with xp past its unlock
		if (has.indexOf("crop") > -1 || has.indexOf("cropFull") > -1) {
			var over = xp - 70;
			var st = has.indexOf("cropFull") > -1 ? 3 : Math.max(0, Math.min(3, Math.floor(over / 40)));
			var keys = ["cropA", "cropB", "cropC", "cropD"];
			for (var c = 0; c < 3; c++) { draw(keys[st], W * 0.42 + c * 14, groundY - 14); }
		}

		// chickens
		var reacting = now < reactUntil;
		chickens.forEach(function (ch, i) {
			ch.t += dt * 0.004;
			var bob = Math.sin(ch.t * 4) > 0 ? 0 : 1;
			if (ch.hop > 0) { ch.hop -= dt * 0.06; }
			var hopY = Math.max(0, ch.hop);
			// wander a little
			ch.x += Math.sin(ch.t * 0.6 + i) * 0.15 * (reacting ? 3 : 1);
			ch.x = Math.max(4, Math.min(W - 20, ch.x));
			var flip = Math.cos(ch.t * 0.6 + i) < 0;
			var key = reacting ? (bob ? "chkWalk0" : "chkWalk1") : (bob ? "chkIdle0" : "chkIdle1");
			var sp = SPR[key], img = sheets[sp[0]];
			if (img && img.width) {
				ctx.save();
				ctx.translate(Math.round(ch.x + (flip ? 16 : 0)), Math.round(groundY - 16 - hopY));
				ctx.scale(flip ? -1 : 1, 1);
				ctx.drawImage(img, sp[1], sp[2], sp[3], sp[4], 0, 0, sp[3], sp[4]);
				ctx.restore();
			}
		});

		// dust puffs
		for (var p = puffs.length - 1; p >= 0; p--) {
			var pf = puffs[p];
			pf.life -= dt * 0.003;
			if (pf.life <= 0) { puffs.splice(p, 1); continue; }
			ctx.fillStyle = pf.big ? "rgba(255,215,120," + pf.life + ")" : "rgba(120,110,80," + (pf.life * 0.7) + ")";
			var rad = (pf.big ? 6 : 3) * (1.4 - pf.life);
			ctx.beginPath();
			ctx.arc(pf.x, pf.y - (1 - pf.life) * 10, rad, 0, 7);
			ctx.fill();
		}
	}

	/* ---------- hooks ---------- */

	function wireButtons() {
		// every pad / mode button press feeds the farm (rate-limited)
		var last = 0;
		document.addEventListener("pointerdown", function (e) {
			if (!e.target.closest || !e.target.closest("[id^='btn']")) { return; }
			var now = Date.now();
			if (now - last < 90) { return; }
			last = now;
			bump(1);
		}, true);
	}

	function boot() {
		loadXp();
		loadSheets(function () {
			ready = true;
			var tries = 0;
			var iv = setInterval(function () {
				if (build()) {
					clearInterval(iv);
					syncChickens();
					wireButtons();
					requestAnimationFrame(frame);
				} else if (++tries > 100) { clearInterval(iv); }
			}, 120);
		});
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
