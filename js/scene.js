/* scene.js — the little scene that lives on the LCD.
 *
 * The original PO-33 keeps one flat illustration on its screen and animates a
 * few parts of it. This does the same thing: a figure wanders the screen with a
 * chicken and a chick trailing behind, all drawn in the display's own dark-green
 * ink so it reads as part of the screen rather than a colour sticker on top.
 *
 * The figure walks in two dimensions now — left, right, up and down — instead of
 * pacing along one line, and there is no tree: it was a fixed lump that ate a
 * third of the screen and never did anything.
 *
 * Deliberately NOT the farm game. The activity counter still ticks up quietly so
 * the dedicated FARM screen has progress waiting for it.
 *
 * Sprite geometry below was measured off the sheets with Pillow, not guessed:
 *   hero_idle  32x32, 4 columns x 3 rows
 *   hero_walk  32x32, 6 columns x 3 rows
 *   hen        16x16, 4 columns x 2 rows
 *   chick      16x16, 4 columns x 3 rows
 * Row 0 faces the viewer, row 1 faces away, row 2 is the side profile (facing
 * right, so it gets mirrored to walk left).
 *
 * Art: "Farm RPG FREE 16x16 - Tiny Asset Pack".
 */
(function () {
	"use strict";

	var SRC = "game/sprites/";
	var SHEETS = ["hero_idle", "hero_walk", "hen", "chick", "mush_idle", "mush_run", "mush_hit"];
	// the LCD's dark-green screen ink
	var INK = [27, 36, 17];

	var HERO = 32, IDLE_F = 4, WALK_F = 6;
	var BIRD = 16, BIRD_F = 4;
	// measured off the sheets after cropping away the padding: 39x35 frames,
	// 7 idle / 8 run / 5 hit
	var MUSH_W = 39, MUSH_H = 35;
	var MUSH_F = { mush_idle: 7, mush_run: 8, mush_hit: 5 };
	var ROW_DOWN = 0, ROW_UP = 1, ROW_SIDE = 2;

	var sheet = {}, host, cv, ctx, W = 0, H = 0, DPR = 1;
	var heroS = 2.4, birdS = 1.6, mushS = 1.4;
	var last = 0, booted = false;
	var xp = 0, excited = 0;

	/* --- what the scene hears ---
	 * beatPulse  fades from 1 to 0 after every sixteenth of the beat
	 * barPulse   the same but only on the first step of each bar
	 * level      0..1 loudness, read off the same meter the level bar uses
	 * notes      little music-note glyphs that float up when a loud step hits
	 */
	var lastBeat = -1, beatPulse = 0, barPulse = 0, level = 0, notes = [];

	function playing() {
		return !!(window.Tone && Tone.Transport && Tone.Transport.state === "started");
	}

	function readLevel() {
		// Tone's meter reports decibels (a negative number, quieter = more
		// negative). Map roughly -50dB..0dB onto 0..1 so it's usable for drawing.
		if (!window.meter || !meter.getLevel) { return 0; }
		var db = meter.getLevel();
		if (!isFinite(db)) { return 0; }
		return Math.max(0, Math.min(1, (db + 50) / 50));
	}

	function listen(dt) {
		beatPulse = Math.max(0, beatPulse - dt * 0.0055);
		barPulse = Math.max(0, barPulse - dt * 0.0022);
		mush.bang = Math.max(0, mush.bang - dt * 0.004);
		var lv = readLevel();
		level += (lv - level) * 0.25;                  // smooth the jitter out

		if (!playing()) { lastBeat = -1; return; }
		var b = window.beatCount;
		if (typeof b !== "number" || b === lastBeat) { return; }
		lastBeat = b;
		beatPulse = 1;
		if (b % 4 === 0) { barPulse = 1; mush.bang = 1; }
		// a loud step throws a note into the air above the figure
		if (level > 0.35 && notes.length < 14) {
			notes.push({
				x: hero.x + HERO * heroS * (0.3 + Math.random() * 0.5),
				y: hero.y + 4,
				vx: (Math.random() - 0.5) * 0.35,
				vy: -0.5 - level * 0.5,
				life: 1,
				big: b % 4 === 0
			});
		}
	}

	// a tiny eighth-note drawn as pixels, so it matches the sprites
	function drawNote(n) {
		var a = Math.max(0, Math.min(1, n.life));
		ctx.fillStyle = "rgba(27,36,17," + (0.35 + a * 0.6) + ")";
		var u = n.big ? 3 : 2;
		var x = Math.round(n.x), y = Math.round(n.y);
		ctx.fillRect(x, y + u * 3, u * 2, u * 2);      // note head
		ctx.fillRect(x + u * 2 - u, y, u, u * 3);      // stem
		ctx.fillRect(x + u * 2, y, u, u);              // flag
	}

	// where the figure is, where it's heading, and the breadcrumb trail the
	// birds walk along behind it
	var hero = { x: 0, y: 0, tx: null, ty: null, dir: 1, row: ROW_SIDE, moving: false, restT: 0 };
	var trail = [];
	var TRAIL_MAX = 90;
	var FOLLOWERS = [
		{ sheet: "hen",   back: 26, peck: 0 },
		{ sheet: "chick", back: 52, peck: 0 }
	];

	/* The mushroom lives on the SONG screen only — the main scene stays the boy
	 * with his chickens. bang still ticks here because the song view's footer
	 * animation reads it. */
	var mush = { bang: 0 };

	function loadXp() { try { xp = parseInt(localStorage.getItem("po33.scene.xp"), 10) || 0; } catch (e) { xp = 0; } }
	function saveXp() { try { localStorage.setItem("po33.scene.xp", String(xp)); } catch (e) {} }

	window.PO33 = window.PO33 || {};
	/* A second, tiny render target. The song view has spare room in its footer,
	 * so the same sprites (already loaded and re-inked) get drawn there too: a
	 * mushroom that headbangs on the downbeat next to a chicken. Nothing is
	 * loaded twice — this just paints the existing sheets onto another canvas. */
	var danceCv = null, danceCtx = null, danceW = 0, danceH = 0;

	function setDanceCanvas(cv) {
		if (!cv) { danceCv = null; danceCtx = null; return; }
		if (cv === danceCv) { return; }
		danceCv = cv;
		danceCtx = cv.getContext("2d");
		danceCtx.imageSmoothingEnabled = false;
		sizeDance();
	}

	function sizeDance() {
		if (!danceCv || !danceCtx) { return; }
		var r = danceCv.getBoundingClientRect();
		danceW = Math.max(20, Math.floor(r.width));
		danceH = Math.max(14, Math.floor(r.height));
		var d = Math.min(2, window.devicePixelRatio || 1);
		danceCv.width = danceW * d; danceCv.height = danceH * d;
		danceCtx.setTransform(d, 0, 0, d, 0, 0);
		danceCtx.imageSmoothingEnabled = false;
	}

	function drawDance(now) {
		if (!danceCv || !danceCtx) { return; }
		if (!danceCv.isConnected) { danceCv = null; danceCtx = null; return; }
		if (danceCv.getBoundingClientRect().width !== danceW) { sizeDance(); }
		danceCtx.clearRect(0, 0, danceW, danceH);

		var sc = Math.max(0.5, (danceH - 2) / MUSH_H);
		var mw = MUSH_W * sc, mh = MUSH_H * sc;

		// the mushroom, headbanging on the downbeat
		var name = mush.bang > 0 ? "mush_hit" : (playing() ? "mush_run" : "mush_idle");
		var sh = sheet[name];
		if (sh) {
			var nf = MUSH_F[name] || 1;
			var fps = name === "mush_hit" ? 16 : (playing() ? 11 : 6);
			var f = Math.floor(now / (1000 / fps)) % nf;
			danceCtx.drawImage(sh, f * MUSH_W, 0, MUSH_W, MUSH_H,
				Math.round(danceW - mw - 2), Math.round(danceH - mh), mw, mh);
		}

		// a hen alongside, hopping on the bar
		var hen = sheet.hen;
		if (hen) {
			var bs = Math.max(0.6, (danceH - 4) / BIRD * 0.8);
			var bw = BIRD * bs;
			var hop = -Math.round(barPulse * 2);
			var bf = Math.floor(now / (1000 / 8)) % BIRD_F;
			danceCtx.drawImage(hen, bf * BIRD, 0, BIRD, BIRD,
				Math.round(danceW - mw - bw - 6), Math.round(danceH - bw) + hop, bw, bw);
		}
	}

	window.PO33.scene = {
		xp: function () { return xp; },
		add: function (n) { bump(n || 1); },
		reset: function () { xp = 0; saveXp(); },
		dance: setDanceCanvas
	};

	/* ---------- the walkable area ---------- */
	// The top of the screen carries the text readout, so the figure stays in the
	// lower band of the canvas and never walks through the words.
	function bounds() {
		var hw = HERO * heroS, hh = HERO * heroS;
		return {
			minX: 4, maxX: Math.max(6, W - hw - 4),
			minY: Math.max(2, H * 0.30), maxY: Math.max(4, H - hh - 2)
		};
	}

	function pickTarget() {
		var b = bounds();
		hero.tx = b.minX + Math.random() * (b.maxX - b.minX);
		hero.ty = b.minY + Math.random() * (b.maxY - b.minY);
		hero.moving = true;
	}

	// called on every button press: the figure perks up and heads somewhere new
	function bump(n) {
		xp += n; saveXp();
		excited = 900;
		if (!hero.moving || Math.random() < 0.25) { pickTarget(); }
	}

	/* ---------- sprites -> LCD ink ---------- */

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

	/* ---------- drawing ---------- */

	function drawHero(now) {
		var hs = sheet[hero.moving ? "hero_walk" : "hero_idle"];
		if (!hs) { return; }
		var nf = hero.moving ? WALK_F : IDLE_F;
		// when the beat is running he moves to it: the walk cycle speeds up and
		// he drops on every step, hardest on the downbeat
		var fps = hero.moving ? (excited > 0 ? 14 : 10) : (playing() ? 8 : 4);
		var f = Math.floor(now / (1000 / fps)) % nf;
		var size = HERO * heroS;
		var mirror = hero.row === ROW_SIDE && hero.dir < 0;
		var bob = -Math.round(beatPulse * 2 + barPulse * 3);
		ctx.save();
		ctx.translate(Math.round(hero.x + (mirror ? size : 0)), Math.round(hero.y) + bob);
		ctx.scale(mirror ? -1 : 1, 1);
		ctx.drawImage(hs, f * HERO, hero.row * HERO, HERO, HERO, 0, 0, size, size);
		ctx.restore();
	}

	function drawBird(b, now) {
		var sh = sheet[b.sheet];
		if (!sh) { return; }
		var size = BIRD * birdS;
		// the bird stops to peck whenever it has caught up and nothing is moving
		var pecking = b.peck > 0;
		var row = pecking ? 1 : 0;
		var f = Math.floor(now / (1000 / (pecking ? 6 : 8))) % BIRD_F;
		var mirror = b.dir < 0;
		var hop = -Math.round(barPulse * 3);      // the birds hop on the downbeat
		ctx.save();
		ctx.translate(Math.round(b.x + (mirror ? size : 0)), Math.round(b.y) + hop);
		ctx.scale(mirror ? -1 : 1, 1);
		ctx.drawImage(sh, f * BIRD, row * BIRD, BIRD, BIRD, 0, 0, size, size);
		ctx.restore();
	}

	function frame(now) {
		requestAnimationFrame(frame);
		if (!ctx || !W) { return; }
		var dt = Math.min(50, now - last); last = now;
		if (excited > 0) { excited -= dt; }
		listen(dt);
		ctx.clearRect(0, 0, W, H);

		/* the floor lights up on the beat — brightest on the first step of a bar */
		if (beatPulse > 0) {
			var glow = beatPulse * 0.10 + barPulse * 0.13;
			var bb0 = bounds();
			var g = ctx.createLinearGradient(0, bb0.minY, 0, H);
			g.addColorStop(0, "rgba(27,36,17,0)");
			g.addColorStop(1, "rgba(27,36,17," + glow.toFixed(3) + ")");
			ctx.fillStyle = g;
			ctx.fillRect(0, bb0.minY, W, H - bb0.minY);
		}

		var b = bounds();

		/* --- the figure decides where to go --- */
		if (hero.moving && hero.tx != null) {
			var dx = hero.tx - hero.x, dy = hero.ty - hero.y;
			var dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < 5) {
				hero.moving = false;
				hero.restT = 500 + Math.random() * (excited > 0 ? 700 : 2600);
			} else {
				var speed = (excited > 0 ? 0.075 : 0.045) * dt;
				hero.x += (dx / dist) * speed * 1.6;
				hero.y += (dy / dist) * speed;
				// face the way you're actually going
				if (Math.abs(dx) > Math.abs(dy) * 1.6) {
					hero.row = ROW_SIDE;
					hero.dir = dx > 0 ? 1 : -1;
				} else {
					hero.row = dy > 0 ? ROW_DOWN : ROW_UP;
				}
			}
		} else {
			hero.restT -= dt;
			if (hero.restT <= 0) { pickTarget(); }
		}
		hero.x = Math.max(b.minX, Math.min(b.maxX, hero.x));
		hero.y = Math.max(b.minY, Math.min(b.maxY, hero.y));

		/* --- breadcrumbs: the birds walk where the figure walked --- */
		trail.unshift({ x: hero.x, y: hero.y, moving: hero.moving });
		if (trail.length > TRAIL_MAX) { trail.length = TRAIL_MAX; }

		var heroSize = HERO * heroS, birdSize = BIRD * birdS;
		var order = [];

		FOLLOWERS.forEach(function (f) {
			var p = trail[Math.min(trail.length - 1, f.back)] || trail[trail.length - 1];
			if (!p) { return; }
			// centre the smaller bird on the footprint the figure left
			var nx = p.x + (heroSize - birdSize) / 2;
			var ny = p.y + heroSize - birdSize;
			if (f.x == null) { f.x = nx; f.y = ny; }
			var mx = nx - f.x;
			if (Math.abs(mx) > 0.6) { f.dir = mx > 0 ? 1 : -1; }
			f.x += mx * 0.16;
			f.y += (ny - f.y) * 0.16;
			// standing still for a moment? have a peck at the ground
			f.peck = (!p.moving && Math.abs(mx) < 1) ? Math.min(1, f.peck + dt * 0.002)
				: Math.max(0, f.peck - dt * 0.006);
			order.push({ y: f.y, draw: function () { drawBird(f, now); } });
		});
		order.push({ y: hero.y, draw: function () { drawHero(now); } });

		// whoever is further down the screen is nearer, so draw them last
		order.sort(function (a, c) { return a.y - c.y; });
		order.forEach(function (o) { o.draw(); });

		/* the notes drift up and fade */
		for (var i = notes.length - 1; i >= 0; i--) {
			var n = notes[i];
			n.x += n.vx * dt * 0.06;
			n.y += n.vy * dt * 0.06;
			n.life -= dt * 0.0013;
			if (n.life <= 0 || n.y < -12) { notes.splice(i, 1); continue; }
			drawNote(n);
		}

		drawDance(now);
	}

	/* ---------- setup ---------- */

	function resize() {
		if (!host || !cv) { return; }
		var r = host.getBoundingClientRect();
		W = Math.max(80, Math.floor(r.width));
		H = Math.max(40, Math.floor(r.height));
		DPR = Math.min(2, window.devicePixelRatio || 1);
		heroS = Math.max(1.3, Math.min(2.6, (H * 0.52) / HERO));
		birdS = Math.max(1, heroS * 0.62);
		mushS = Math.max(0.9, heroS * 0.6);
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
		var b = bounds();
		if (!hero.x) { hero.x = W * 0.4; hero.y = (b.minY + b.maxY) / 2; }
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
		// tap the screen and the figure sets off somewhere new
		cv.addEventListener("pointerdown", function (e) {
			var r = cv.getBoundingClientRect();
			var bb = bounds();
			hero.tx = Math.max(bb.minX, Math.min(bb.maxX, e.clientX - r.left - HERO * heroS / 2));
			hero.ty = Math.max(bb.minY, Math.min(bb.maxY, e.clientY - r.top - HERO * heroS / 2));
			hero.moving = true;
			bump(1);
		});
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
