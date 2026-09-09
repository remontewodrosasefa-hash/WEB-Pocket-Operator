/* scene.js — ambient pixel farm on the LCD.
 *
 * Lives in the #hudArt band, never draws outside it. Every sprite is recoloured
 * to the LCD's two-tone ink on load, so it reads like something actually drawn
 * on this display rather than a colour sticker on top of it.
 *
 * All source rects below were measured off the sheets (transparent-gap scan),
 * not guessed.
 *
 * Art: "Farm RPG FREE 16x16 - Tiny Asset Pack". Only the used sprites ship,
 * in game/sprites/.
 */
(function () {
	"use strict";

	var SRC = "game/sprites/";
	var SHEETS = ["ground", "tree", "hero_idle", "hero_walk", "hen", "chest", "crops", "house2"];

	var INK = [27, 36, 17];               // LCD dark green

	/* measured source rects [x, y, w, h] ------------------------------ */
	var GROUND = [112, 32, 16, 16];
	var HOUSE  = [4, 3, 72, 86];
	var CHEST  = [8, 2, 16, 15];
	var TREE   = [[13, 42, 7, 4], [43, 34, 9, 12], [71, 14, 20, 33], [96, 1, 32, 46]];
	var CROP   = [[2, 23, 11, 8], [35, 23, 10, 9], [50, 20, 11, 12], [66, 18, 12, 14]];
	var HERO = 32, HERO_SIDE_ROW = 2, IDLE_F = 4, WALK_F = 6;
	var HEN = 16;

	/* progression ----------------------------------------------------- */
	var STAGES = [
		{ xp: 0,   has: [] },
		{ xp: 2,   has: ["tree"] },
		{ xp: 6,   has: ["tree", "hen"] },
		{ xp: 12,  has: ["tree", "hen", "crop"] },
		{ xp: 22,  has: ["tree", "hen", "crop", "chest"] },
		{ xp: 36,  has: ["tree", "hen2", "crop", "chest"] },
		{ xp: 60,  has: ["tree", "hen2", "crop", "chest", "house"] },
		{ xp: 100, has: ["treeFull", "hen2", "cropFull", "chest", "house"] }
	];

	var sheet = {}, host, cv, ctx, W = 0, H = 0, DPR = 1, S = 2;
	var xp = 0, hens = [], chips = [], puffs = [], last = 0, booted = false;
	var hero = { x: 40, dir: 1, walking: false, idleT: 0, chop: 0, target: null };

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
		xp += n; saveXp();
		hero.walking = true;
		hero.chop = 60;
		hero.target = treeX() - HERO * S * 0.75;      // stand just left of the tree
		hens.forEach(function (h) { h.hop = 6; });
		if (stage() !== before) {
			puffs.push({ x: W / 2, y: H * 0.45, life: 1 });
			var got = stage().has.filter(function (x) { return before.has.indexOf(x) === -1; })[0];
			if (got && window.PO33.flash) { PO33.flash("farm grew · " + got.replace(/\d|Full/g, ""), "tip"); }
			syncHens();
		}
	}

	function syncHens() {
		var want = has("hen2") ? 2 : has("hen") ? 1 : 0;
		while (hens.length < want) { hens.push({ x: 0, t: Math.random() * 40, hop: 0, home: 0 }); }
		hens.length = want;
		hens.forEach(function (h, i) { h.home = 0.40 + i * 0.07; h.x = W * h.home; });
	}

	/* ---------- sprites → LCD ink ---------- */

	function monoize(im) {
		var c = document.createElement("canvas");
		c.width = im.width; c.height = im.height;
		var x = c.getContext("2d");
		x.drawImage(im, 0, 0);
		try {
			var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
			for (var i = 0; i < p.length; i += 4) {
				if (p[i + 3] < 40) { p[i + 3] = 0; continue; }
				var lum = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
				p[i] = INK[0]; p[i + 1] = INK[1]; p[i + 2] = INK[2];
				p[i + 3] = Math.max(70, Math.min(255, Math.round(255 * (1 - lum * 0.75))));
			}
			x.putImageData(d, 0, 0);
		} catch (e) { /* tainted canvas — fall back to the colour sprite */ }
		return c;
	}

	function blit(name, r, dx, dy, scale) {
		var s = sheet[name];
		if (!s) { return; }
		scale = scale || S;
		var dw = Math.max(1, Math.round(r[2] * scale)), dh = Math.max(1, Math.round(r[3] * scale));
		if (dx > W || dx + dw < 0) { return; }              // never draw outside the band
		ctx.drawImage(s, r[0], r[1], r[2], r[3], Math.round(dx), Math.round(dy), dw, dh);
	}

	/* ---------- layout ---------- */

	function baseY() { return H - 3; }
	function treeX() { return W - TREE[3][2] * S - 6; }

	/* ---------- render ---------- */

	function frame(now) {
		requestAnimationFrame(frame);
		if (!ctx || !W) { return; }
		var dt = Math.min(50, now - last); last = now;
		ctx.clearRect(0, 0, W, H);

		var base = baseY();

		/* hero movement, clamped hard to the band */
		if (hero.chop > 0) { hero.chop -= dt * 0.06; }
		var heroW = HERO * S;
		var minX = 2, maxX = W - heroW - 2;
		if (hero.walking && hero.target != null) {
			var d = hero.target - hero.x;
			if (Math.abs(d) > 4) { hero.dir = d > 0 ? 1 : -1; hero.x += hero.dir * dt * 0.05; }
			else if (hero.chop <= 0) { hero.walking = false; hero.target = null; }
		} else if (!hero.walking) {
			hero.idleT += dt;
			if (hero.idleT > 3400) {
				hero.idleT = 0; hero.walking = true;
				hero.target = minX + Math.random() * Math.max(10, maxX - minX);
			}
		}
		hero.x = Math.max(minX, Math.min(maxX, hero.x));

		/* ground */
		var gw = 16 * S;
		for (var gx = -gw; gx < W + gw; gx += gw) { blit("ground", GROUND, gx, base - gw * 0.55); }

		/* props, back to front */
		if (has("house")) { blit("house2", HOUSE, 2, base - HOUSE[3] * 0.9, 0.9); }
		if (has("chest")) { blit("chest", CHEST, W * 0.29, base - CHEST[3] * 1.5, 1.5); }
		if (has("crop") || has("cropFull")) {
			var cs = has("cropFull") ? 3 : Math.max(0, Math.min(3, Math.floor((xp - 12) / 8)));
			var c = CROP[cs];
			for (var i = 0; i < 3; i++) { blit("crops", c, W * 0.52 + i * 15, base - c[3] * 1.6, 1.6); }
		}
		if (has("tree") || has("treeFull")) {
			var ts = has("treeFull") ? 3 : (xp > 24 ? 3 : xp > 10 ? 2 : 1);
			var t = TREE[ts];
			blit("tree", t, W - t[2] * S - 6, base - t[3] * S);
		}

		/* hens */
		hens.forEach(function (h, i) {
			h.t += dt * 0.003;
			if (h.hop > 0) { h.hop -= dt * 0.05; }
			h.x = W * h.home + Math.sin(h.t + i) * 10;
			h.x = Math.max(2, Math.min(W - HEN * S - 2, h.x));
			var flip = Math.cos(h.t + i) < 0;
			var f = Math.floor(now / 280) % 4;
			ctx.save();
			ctx.translate(Math.round(h.x + (flip ? HEN * S : 0)), Math.round(base - HEN * S - Math.max(0, h.hop)));
			ctx.scale(flip ? -1 : 1, 1);
			var hs = sheet.hen;
			if (hs) { ctx.drawImage(hs, f * HEN, 0, HEN, HEN, 0, 0, HEN * S, HEN * S); }
			ctx.restore();
		});

		/* hero */
		var chopping = hero.chop > 0 && hero.target != null && Math.abs(hero.x - hero.target) <= 6;
		var walking = hero.walking && !chopping;
		var name = walking ? "hero_walk" : "hero_idle";
		var nf = walking ? WALK_F : IDLE_F;
		var f2 = Math.floor(now / (1000 / (walking ? 10 : 5))) % nf;
		var bob = chopping ? (Math.floor(now / 100) % 2 ? 3 : -1) : 0;
		var hs2 = sheet[name];
		if (hs2) {
			ctx.save();
			ctx.translate(Math.round(hero.x + (hero.dir < 0 ? heroW : 0)), Math.round(base - HERO * S + bob));
			ctx.scale(hero.dir < 0 ? -1 : 1, 1);
			ctx.drawImage(hs2, f2 * HERO, HERO_SIDE_ROW * HERO, HERO, HERO, 0, 0, heroW, HERO * S);
			ctx.restore();
		}
		if (chopping && Math.random() < 0.3) {
			chips.push({ x: hero.x + heroW * 0.9, y: base - HERO * S * 0.55,
				vx: 0.5 + Math.random(), vy: -1.1 - Math.random(), life: 1 });
		}

		/* particles, in LCD ink */
		var k, p;
		for (k = chips.length - 1; k >= 0; k--) {
			p = chips[k];
			p.life -= dt * 0.002; p.x += p.vx; p.y += p.vy; p.vy += 0.09;
			if (p.life <= 0 || p.x > W) { chips.splice(k, 1); continue; }
			ctx.fillStyle = "rgba(27,36,17," + p.life + ")";
			ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
		}
		for (k = puffs.length - 1; k >= 0; k--) {
			p = puffs[k];
			p.life -= dt * 0.0016;
			if (p.life <= 0) { puffs.splice(k, 1); continue; }
			ctx.strokeStyle = "rgba(27,36,17," + p.life * 0.8 + ")";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y - (1 - p.life) * 14, 6 + (1 - p.life) * 16, 0, 7);
			ctx.stroke();
		}
	}

	/* ---------- setup ---------- */

	function resize() {
		if (!host || !cv) { return; }
		var r = host.getBoundingClientRect();
		W = Math.max(80, Math.floor(r.width));
		H = Math.max(40, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		// scale so the tallest thing on the ground (the tree) always fits
		S = Math.max(1, Math.min(2.2, (H - 6) / TREE[3][3]));
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
		syncHens();
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
			t = now; bump(1);
		}, true);
	}

	function boot() {
		if (booted) { return; }
		booted = true;
		loadXp();
		var left = SHEETS.length;
		SHEETS.forEach(function (n) {
			var im = new Image();
			im.onload = function () { sheet[n] = monoize(im); if (--left === 0) { start(); } };
			im.onerror = function () { if (--left === 0) { start(); } };
			im.src = SRC + n + ".png";
		});
	}
	function start() {
		var tries = 0;
		var iv = setInterval(function () {
			if (build()) { clearInterval(iv); syncHens(); wireButtons(); requestAnimationFrame(frame); }
			else if (++tries > 100) { clearInterval(iv); }
		}, 120);
	}

	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
