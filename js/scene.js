/* scene.js — the LCD motif.
 *
 * The original PO-33 puts one big flat illustration on its screen with a few
 * segments animating around it. This does the same: a large figure that idles,
 * walks and chops, drawn in the LCD's own ink so it reads as part of the
 * display rather than a colour sticker on top.
 *
 * Deliberately NOT the farm game — no house, no growth, no props. That belongs
 * on the dedicated FARM screen. The activity counter still ticks up quietly in
 * the background so the farm has progress waiting for it.
 *
 * Art: "Farm RPG FREE 16x16 - Tiny Asset Pack". Source rects were measured off
 * the sheets, not guessed.
 */
(function () {
	"use strict";

	var SRC = "game/sprites/";
	var SHEETS = ["hero_idle", "hero_walk", "tree"];
	var INK = [27, 36, 17];

	var HERO = 32, SIDE_ROW = 2, IDLE_F = 4, WALK_F = 6;
	var TREE = [96, 1, 32, 46];            // measured: the full-grown maple

	var sheet = {}, host, cv, ctx, W = 0, H = 0, DPR = 1;
	var heroS = 3, treeS = 2;
	var chips = [], last = 0, booted = false;
	var hero = { x: 0, dir: 1, walking: false, idleT: 0, chop: 0, target: null };
	var xp = 0;

	/* the farm's progress keeps accruing for the FARM screen, just isn't drawn here */
	function loadXp() { try { xp = parseInt(localStorage.getItem("po33.scene.xp"), 10) || 0; } catch (e) { xp = 0; } }
	function saveXp() { try { localStorage.setItem("po33.scene.xp", String(xp)); } catch (e) {} }

	window.PO33 = window.PO33 || {};
	window.PO33.scene = {
		xp: function () { return xp; },
		add: function (n) { bump(n || 1); },
		reset: function () { xp = 0; saveXp(); }
	};

	function treeX() { return W * 0.66; }

	function bump(n) {
		xp += n; saveXp();
		hero.walking = true;
		hero.chop = 70;
		hero.target = treeX() - HERO * heroS * 0.72;   // step up to the tree
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
				p[i + 3] = Math.max(80, Math.min(255, Math.round(255 * (1 - lum * 0.72))));
			}
			x.putImageData(d, 0, 0);
		} catch (e) { /* tainted canvas — keep the colour sprite */ }
		return c;
	}

	/* ---------- render ---------- */

	function frame(now) {
		requestAnimationFrame(frame);
		if (!ctx || !W) { return; }
		var dt = Math.min(50, now - last); last = now;
		ctx.clearRect(0, 0, W, H);

		var base = H - 4;
		var heroW = HERO * heroS, heroH = HERO * heroS;
		var minX = 4, maxX = Math.max(minX, W - heroW - 4);

		/* movement */
		if (hero.chop > 0) { hero.chop -= dt * 0.055; }
		if (hero.walking && hero.target != null) {
			var d = hero.target - hero.x;
			if (Math.abs(d) > 4) { hero.dir = d > 0 ? 1 : -1; hero.x += hero.dir * dt * 0.05; }
			else if (hero.chop <= 0) { hero.walking = false; hero.target = null; }
		} else if (!hero.walking) {
			hero.idleT += dt;
			if (hero.idleT > 3600) {
				hero.idleT = 0; hero.walking = true;
				hero.target = minX + Math.random() * (maxX - minX) * 0.7;
			}
		}
		hero.x = Math.max(minX, Math.min(maxX, hero.x));

		/* the tree — the fixed half of the motif */
		var ts = sheet.tree;
		if (ts) {
			var tw = TREE[2] * treeS, th = TREE[3] * treeS;
			ctx.drawImage(ts, TREE[0], TREE[1], TREE[2], TREE[3],
				Math.round(Math.min(W - tw - 4, treeX())), Math.round(base - th), tw, th);
		}

		/* the figure */
		var chopping = hero.chop > 0 && hero.target != null && Math.abs(hero.x - hero.target) <= 6;
		var walking = hero.walking && !chopping;
		var name = walking ? "hero_walk" : "hero_idle";
		var nf = walking ? WALK_F : IDLE_F;
		var f = Math.floor(now / (1000 / (walking ? 10 : 4))) % nf;
		var bob = chopping ? (Math.floor(now / 100) % 2 ? 3 : -1) : 0;
		var hs = sheet[name];
		if (hs) {
			ctx.save();
			ctx.translate(Math.round(hero.x + (hero.dir < 0 ? heroW : 0)), Math.round(base - heroH + bob));
			ctx.scale(hero.dir < 0 ? -1 : 1, 1);
			ctx.drawImage(hs, f * HERO, SIDE_ROW * HERO, HERO, HERO, 0, 0, heroW, heroH);
			ctx.restore();
		}
		if (chopping && Math.random() < 0.3) {
			chips.push({ x: hero.x + heroW * 0.85, y: base - heroH * 0.5,
				vx: 0.5 + Math.random(), vy: -1.1 - Math.random(), life: 1 });
		}

		/* chips, same ink */
		for (var k = chips.length - 1; k >= 0; k--) {
			var p = chips[k];
			p.life -= dt * 0.002; p.x += p.vx; p.y += p.vy; p.vy += 0.09;
			if (p.life <= 0 || p.x > W || p.y > H) { chips.splice(k, 1); continue; }
			ctx.fillStyle = "rgba(27,36,17," + p.life + ")";
			ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
		}
	}

	/* ---------- setup ---------- */

	function resize() {
		if (!host || !cv) { return; }
		var r = host.getBoundingClientRect();
		W = Math.max(80, Math.floor(r.width));
		H = Math.max(40, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		heroS = Math.max(1.4, Math.min(3.2, (H - 6) / HERO));
		treeS = Math.max(1, Math.min(2.2, (H - 6) / TREE[3]));
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
		if (!hero.x) { hero.x = W * 0.34; }
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
			if (build()) { clearInterval(iv); wireButtons(); requestAnimationFrame(frame); }
			else if (++tries > 100) { clearInterval(iv); }
		}, 120);
	}

	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
