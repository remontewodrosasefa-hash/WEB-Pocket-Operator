/* scene.js — ambient pixel-art farm on the LCD.
 * Sits in the #hudArt band (below the readout, above the step bar) and never
 * covers text. A little farmer walks about, chops the tree and tends the crops;
 * the farm grows the more you use the unit, and everything reacts to presses.
 *
 * Art: "Farm RPG FREE 16x16 - Tiny Asset Pack" (32x32 character frames).
 * Only the sprites used are committed, in game/sprites/.
 */
(function () {
	"use strict";

	var SRC = "game/sprites/";
	var SHEETS = ["ground", "tree", "hero_idle", "hero_walk", "hen", "chick", "house2", "crops", "chest"];

	/* frame geometry ------------------------------------------------- */
	var HERO = 32;                       // hero frames are 32x32
	var HERO_ROW = { front: 0, back: 1, side: 2 };
	var IDLE_FRAMES = 4, WALK_FRAMES = 6;
	var TREE_W = 32, TREE_H = 48;        // 5 stages: nub, sprout, small, full, stump
	var HEN = 16;

	// ground fill tile inside the autotile sheet
	var GROUND = [112, 32, 16, 16];
	// a few crop stages out of Spring Crops (16x16 cells)
	var CROP = [[0, 0], [16, 0], [32, 0], [48, 0]];

	/* progression ----------------------------------------------------- */
	// ~80% fewer presses than the first pass, for testing
	var STAGES = [
		{ xp: 0,   has: [] },
		{ xp: 2,   has: ["tree"] },
		{ xp: 6,   has: ["tree", "hen"] },
		{ xp: 12,  has: ["tree", "hen", "crop"] },
		{ xp: 22,  has: ["tree", "hen", "crop", "chest"] },
		{ xp: 36,  has: ["tree", "hen2", "crop", "chest"] },
		{ xp: 60,  has: ["tree", "hen2", "chick", "crop", "chest", "house"] },
		{ xp: 100, has: ["treeFull", "hen2", "chick", "cropFull", "chest", "house"] }
	];

	var img = {}, host, cv, ctx, W = 0, H = 0, DPR = 1, S = 2;
	var xp = 0, hens = [], chips = [], puffs = [], last = 0, booted = false;

	var hero = { x: 40, dir: 1, state: "idle", t: 0, chop: 0, target: null };

	/* ---------- state ---------- */

	function loadXp() { try { xp = parseInt(localStorage.getItem("po33.scene.xp"), 10) || 0; } catch (e) { xp = 0; } }
	function saveXp() { try { localStorage.setItem("po33.scene.xp", String(xp)); } catch (e) {} }

	function stage() {
		var st = STAGES[0];
		for (var i = 0; i < STAGES.length; i++) { if (xp >= STAGES[i].xp) { st = STAGES[i]; } }
		return st;
	}
	function has(k) { return stage().has.indexOf(k) > -1; }

	window.PO33 = window.PO33 || {};
	window.PO33.scene = {
		xp: function () { return xp; },
		add: function (n) { bump(n || 1); },
		reset: function () { xp = 0; saveXp(); syncHens(); }
	};

	function bump(n) {
		var before = stage();
		xp += n;
		saveXp();
		// the farmer reacts: walk to the tree and chop
		hero.state = "walk";
		hero.chop = 46;
		hero.target = treeX();
		hens.forEach(function (h) { h.hop = 7; });
		if (stage() !== before) {
			puffs.push({ x: W / 2, y: H * 0.4, life: 1, big: true });
			var added = stage().has.filter(function (x) { return before.has.indexOf(x) === -1; })[0];
			if (added && window.PO33.flash) { PO33.flash("farm grew · " + added.replace(/\d|Full/g, ""), "tip"); }
			syncHens();
		}
	}

	function syncHens() {
		var want = (has("hen2") ? 2 : has("hen") ? 1 : 0) + (has("chick") ? 1 : 0);
		while (hens.length < want) {
			hens.push({ x: 30 + hens.length * 26, t: Math.random() * 50, hop: 0, baby: hens.length === want - 1 && has("chick") });
		}
		hens.length = want;
	}

	/* ---------- geometry ---------- */

	function baseY() { return H - 4; }
	function treeX()  { return W - 40 * S / 2 - 6; }

	/* ---------- drawing ---------- */

	function blit(sheet, sx, sy, sw, sh, dx, dy, scale) {
		var im = img[sheet];
		if (!im || !im.width) { return; }
		scale = scale || S;
		ctx.drawImage(im, sx, sy, sw, sh, Math.round(dx), Math.round(dy), sw * scale, sh * scale);
	}

	function drawGround() {
		var g = GROUND, tile = 16 * S;
		var y = baseY() - tile * 0.55;
		for (var x = -tile; x < W + tile; x += tile) { blit("ground", g[0], g[1], g[2], g[3], x, y); }
	}

	function drawHero(now) {
		var walking = hero.state === "walk";
		var frames = walking ? WALK_FRAMES : IDLE_FRAMES;
		var sheet = walking ? "hero_walk" : "hero_idle";
		var fps = walking ? 10 : 5;
		var f = Math.floor(now / (1000 / fps)) % frames;
		var row = HERO_ROW.side;
		var chopping = hero.chop > 0 && Math.abs(hero.x - (hero.target || 0)) < 8;
		var bob = chopping ? (Math.floor(now / 90) % 2 ? 2 : -2) : 0;

		var im = img[sheet];
		if (!im || !im.width) { return; }
		var dw = HERO * S, dh = HERO * S;
		var dx = hero.x, dy = baseY() - dh + 4 + bob;
		ctx.save();
		ctx.translate(Math.round(dx + (hero.dir < 0 ? dw : 0)), Math.round(dy));
		ctx.scale(hero.dir < 0 ? -1 : 1, 1);
		ctx.drawImage(im, f * HERO, row * HERO, HERO, HERO, 0, 0, dw, dh);
		ctx.restore();

		if (chopping && Math.random() < 0.35) {
			chips.push({ x: hero.x + dw * 0.8, y: dy + dh * 0.45,
				vx: 0.6 + Math.random(), vy: -1.2 - Math.random(), life: 1 });
		}
	}

	function drawTree() {
		if (!has("tree") && !has("treeFull")) { return; }
		var stg = has("treeFull") ? 3 : (xp > 30 ? 3 : xp > 12 ? 2 : 1);
		blit("tree", stg * TREE_W, 0, TREE_W, TREE_H, treeX(), baseY() - TREE_H * S + 6);
	}

	function drawHens(now, dt) {
		hens.forEach(function (h, i) {
			h.t += dt * 0.004;
			if (h.hop > 0) { h.hop -= dt * 0.05; }
			h.x += Math.sin(h.t * 0.7 + i) * 0.25;
			h.x = Math.max(4, Math.min(W - HEN * S - 4, h.x));
			var flip = Math.cos(h.t * 0.7 + i) < 0;
			var f = Math.floor(now / 260) % 4;
			var sheet = h.baby ? "chick" : "hen";
			var im = img[sheet];
			if (!im || !im.width) { return; }
			var d = HEN * S * (h.baby ? 0.75 : 1);
			ctx.save();
			ctx.translate(Math.round(h.x + (flip ? d : 0)), Math.round(baseY() - d - Math.max(0, h.hop)));
			ctx.scale(flip ? -1 : 1, 1);
			ctx.drawImage(im, f * HEN, 0, HEN, HEN, 0, 0, d, d);
			ctx.restore();
		});
	}

	function drawProps() {
		if (has("house")) { blit("house2", 0, 0, 64, 64, 2, baseY() - 64 * S * 0.7, S * 0.7); }
		if (has("chest")) { blit("chest", 0, 0, 32, 32, W * 0.26, baseY() - 32 * S * 0.6, S * 0.6); }
		if (has("crop") || has("cropFull")) {
			var st = has("cropFull") ? 3 : Math.max(0, Math.min(3, Math.floor((xp - 12) / 12)));
			var c = CROP[st];
			for (var i = 0; i < 3; i++) {
				blit("crops", c[0], c[1], 16, 16, W * 0.44 + i * 16 * S * 0.8, baseY() - 16 * S * 0.8, S * 0.8);
			}
		}
	}

	function drawParticles(dt) {
		var i, p;
		for (i = chips.length - 1; i >= 0; i--) {
			p = chips[i];
			p.life -= dt * 0.002; p.x += p.vx; p.y += p.vy; p.vy += 0.09;
			if (p.life <= 0) { chips.splice(i, 1); continue; }
			ctx.fillStyle = "rgba(150,100,50," + p.life + ")";
			ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
		}
		for (i = puffs.length - 1; i >= 0; i--) {
			p = puffs[i];
			p.life -= dt * 0.0018;
			if (p.life <= 0) { puffs.splice(i, 1); continue; }
			ctx.fillStyle = "rgba(255,220,130," + p.life * 0.9 + ")";
			ctx.beginPath();
			ctx.arc(p.x, p.y - (1 - p.life) * 16, 10 * (1.3 - p.life), 0, 7);
			ctx.fill();
		}
	}

	/* ---------- loop ---------- */

	function frame(now) {
		requestAnimationFrame(frame);
		if (!ctx || !W) { return; }
		var dt = Math.min(50, now - last); last = now;
		ctx.clearRect(0, 0, W, H);

		// hero movement
		if (hero.chop > 0) { hero.chop -= dt * 0.06; }
		var tgt = hero.target;
		if (hero.state === "walk" && tgt != null) {
			var d = tgt - hero.x;
			if (Math.abs(d) > 6) { hero.dir = d > 0 ? 1 : -1; hero.x += hero.dir * dt * 0.045; }
			else if (hero.chop <= 0) { hero.state = "idle"; hero.target = null; }
		} else if (hero.state === "idle") {
			hero.t += dt;
			if (hero.t > 3200) {                      // wander now and then
				hero.t = 0; hero.state = "walk";
				hero.target = 20 + Math.random() * Math.max(20, W - 80);
			}
		}
		hero.x = Math.max(2, Math.min(W - HERO * S - 2, hero.x));

		drawGround();
		drawProps();
		drawTree();
		drawHens(now, dt);
		drawHero(now);
		drawParticles(dt);
	}

	/* ---------- setup ---------- */

	function resize() {
		if (!host || !cv) { return; }
		var r = host.getBoundingClientRect();
		W = Math.max(80, Math.floor(r.width));
		H = Math.max(34, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		// scale so the tallest sprite (tree, 48px) always fits the band
		S = Math.max(1, Math.min(2.4, (H - 6) / TREE_H));
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
	}

	function build() {
		host = document.getElementById("hudArt");
		if (!host) { return false; }
		if (cv) { return true; }
		window.__sceneOwnsArt = true;
		host.innerHTML = "";
		cv = document.createElement("canvas");
		cv.id = "sceneCanvas";
		host.appendChild(cv);
		ctx = cv.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		cv.addEventListener("pointerdown", function () { bump(1); });
		resize();
		if (window.ResizeObserver) { new ResizeObserver(resize).observe(host); }
		window.addEventListener("resize", resize);
		return true;
	}

	function wireButtons() {
		var t = 0;
		document.addEventListener("pointerdown", function (e) {
			if (!e.target.closest || !e.target.closest("[id^='btn']")) { return; }
			var now = Date.now();
			if (now - t < 90) { return; }
			t = now;
			bump(1);
		}, true);
	}

	function boot() {
		if (booted) { return; }
		booted = true;
		loadXp();
		var left = SHEETS.length;
		SHEETS.forEach(function (n) {
			var im = new Image();
			im.onload = im.onerror = function () { if (--left === 0) { start(); } };
			im.src = SRC + n + ".png";
			img[n] = im;
		});
	}
	function start() {
		var tries = 0;
		var iv = setInterval(function () {
			if (build()) {
				clearInterval(iv);
				syncHens();
				wireButtons();
				requestAnimationFrame(frame);
			} else if (++tries > 100) { clearInterval(iv); }
		}, 120);
	}

	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
