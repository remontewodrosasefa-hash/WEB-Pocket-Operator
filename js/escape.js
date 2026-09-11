/* escape.js — the little guy gets out of the screen.
 *
 * Tap him on the LCD and he climbs out, then wanders the actual interface:
 * the real bounding boxes of the pads, the mode row, the sliders and the
 * perform tabs become the ledges he stands on, so he is walking on the
 * instrument rather than on a drawing of one. Sometimes he goes and stands
 * under a blinking red LED for a while.
 *
 * Rules it lives by, so it stays charming instead of irritating:
 *   - the overlay is pointer-events: none, always. It can never eat a tap.
 *   - he moves slowly and idles a lot; he is scenery, not an animation loop
 *     demanding attention.
 *   - tap him and he goes home. He also goes home on his own after a while,
 *     and he never survives a reload.
 *   - nothing about him touches audio, patterns or any saved state.
 *
 * Exposes window.PO33.escape
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var SRC = "game/sprites/";
	var FRAME = 32, IDLE_F = 4, WALK_F = 6;
	var ROW_DOWN = 0, ROW_UP = 1, ROW_SIDE = 2;
	// light warm grey: he has to read against the dark circuit board, where
	// the LCD's dark-green ink would be invisible
	var INK = [214, 210, 198];

	var sheets = {}, cv, ctx, W = 0, H = 0, DPR = 1, raf = null;
	var out = false, last = 0, scale = 1.6;
	var ledges = [], ledgeAt = 0;
	var homeTimer = 0;

	var guy = {
		x: 0, y: 0, vx: 0, vy: 0,
		dir: 1, onGround: false, ledge: null,
		state: "fall", t: 0, target: null,
		row: 2,              // 0 faces you, 1 faces away, 2 is the side profile
		bob: 0,              // beat bounce while dancing
		jumped: false,       // one hop per hop, not one per frame
		lastPoke: 0          // when you last pressed something
	};

	/* is the sequencer running? he dances when it is */
	function playing() {
		return !!(window.Tone && Tone.Transport && Tone.Transport.state === "started");
	}
	var lastBeat = -1, wasPlaying = false;

	// Slow and deliberate. The old JUMP (-0.62) threw him ~120px in the air,
	// and the hop state re-fired it on every grounded frame, so he pogo-sticked
	// across the interface. One hop now, and only as high as the next row up.
	var GRAV = 0.0016, WALK = 0.017, JUMP = -0.40;

	/* ---------- sprites ---------- */

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
				p[i + 3] = Math.max(90, Math.min(255, Math.round(255 * (1 - lum * 0.6))));
			}
			x.putImageData(d, 0, 0);
		} catch (e) {}
		return c;
	}

	function loadSheets(done) {
		var names = ["hero_idle", "hero_walk"], left = names.length;
		names.forEach(function (n) {
			var im = new Image();
			im.onload = function () { sheets[n] = monoize(im); if (!--left) { done(); } };
			im.onerror = function () { if (!--left) { done(); } };
			im.src = SRC + n + ".png";
		});
	}

	/* ---------- the interface as terrain ----------
	 * Every ledge is a real element's box. Re-read on a timer rather than
	 * every frame: the layout only moves when a panel opens or the phone
	 * rotates, and getBoundingClientRect on 40 nodes per frame is wasteful.
	 */
	var TERRAIN = ".buttonGridItem, .perfTabs button, .perfCells button, " +
		".sliderWrap, .lcd, .topLink, .keysBar button, .chainLink";

	function readLedges() {
		ledges = [];
		var seen = document.querySelectorAll(TERRAIN);
		for (var i = 0; i < seen.length; i++) {
			var r = seen[i].getBoundingClientRect();
			if (r.width < 18 || r.height < 8) { continue; }
			if (r.bottom < 0 || r.top > H) { continue; }
			ledges.push({ x: r.left, y: r.top, w: r.width, el: seen[i] });
		}
		ledgeAt = Date.now();
	}

	function ledgeUnder(x, y) {
		// the highest ledge whose top is below him and spans his x
		var best = null;
		for (var i = 0; i < ledges.length; i++) {
			var l = ledges[i];
			if (x < l.x - 4 || x > l.x + l.w + 4) { continue; }
			if (l.y < y - 2) { continue; }
			if (!best || l.y < best.y) { best = l; }
		}
		return best;
	}

	/* ---------- what he's drawn to ---------- */

	// a lit LED on a pad — the blinking red one the sequencer leaves behind
	function blinkingLed() {
		var el = document.querySelector(".ledFlash, .ledOnFull");
		if (!el) { return null; }
		var r = el.getBoundingClientRect();
		if (!r.width || r.top > H || r.bottom < 0) { return null; }
		return { x: r.left + r.width / 2, y: r.top };
	}

	/* ---------- behaviour ---------- */

	// Is there floor ahead of him? Used so he turns at an edge instead of
	// constantly walking off into space.
	function floorAhead() {
		var size = FRAME * scale;
		var probe = guy.x + size / 2 + guy.dir * (size * 0.55);
		return !!ledgeUnder(probe, guy.y + size + 2);
	}

	function pickIdea() {
		guy.t = 0;
		guy.jumped = false;
		guy.row = ROW_SIDE;

		// while the beat is running he'd rather dance than do anything else
		if (playing() && guy.onGround && Math.random() < 0.55) {
			guy.state = "dance";
			guy.row = ROW_DOWN;
			guy.target = 4000 + Math.random() * 6000;
			return;
		}

		// if you just pressed something he looks over at it
		if (Date.now() - guy.lastPoke < 1200 && Math.random() < 0.5) {
			guy.state = "idle";
			guy.row = ROW_DOWN;
			guy.target = 900 + Math.random() * 900;
			return;
		}

		var led = blinkingLed();
		if (led && Math.random() < 0.25) {
			guy.state = "chase";
			guy.target = led.x;
			return;
		}

		var r = Math.random();
		if (r < 0.34) {
			// stand about, mostly looking out at you
			guy.state = "idle";
			guy.row = Math.random() < 0.6 ? ROW_DOWN : ROW_SIDE;
			guy.target = 1400 + Math.random() * 3400;
		} else if (r < 0.78) {
			guy.state = "walk";
			guy.dir = Math.random() < 0.5 ? -1 : 1;
			guy.target = 1600 + Math.random() * 3200;
		} else if (r < 0.9) {
			guy.state = "sit";
			guy.row = ROW_DOWN;
			guy.target = 2500 + Math.random() * 4000;
		} else {
			guy.state = "hop";
		}
	}

	function step(dt) {
		guy.t += dt;

		if (Date.now() - ledgeAt > 700) { readLedges(); }

		// the moment you hit PLAY he drops what he's doing and dances
		var now = playing();
		if (now && !wasPlaying && guy.onGround) {
			guy.state = "dance";
			guy.row = ROW_DOWN;
			guy.t = 0;
			guy.target = 6000 + Math.random() * 8000;
		}
		wasPlaying = now;

		// the beat bounce, whatever he's doing
		if (playing()) {
			var bt = window.beatCount;
			if (typeof bt === "number" && bt !== lastBeat) {
				lastBeat = bt;
				guy.bob = (bt % 4 === 0) ? 1 : 0.55;
			}
		} else { lastBeat = -1; }
		guy.bob = Math.max(0, guy.bob - dt * 0.005);

		switch (guy.state) {
			case "idle":
				guy.vx = 0;
				if (guy.t > guy.target) { pickIdea(); }
				break;

			case "sit":
				guy.vx = 0;
				if (guy.t > guy.target || (playing() && Math.random() < 0.01)) { pickIdea(); }
				break;

			case "dance":
				// stays put and shuffles: a little side-step every half bar,
				// facing you, bouncing on the beat
				guy.vx = 0;
				if (Math.floor(guy.t / 900) % 2 === 0) { guy.row = ROW_DOWN; }
				else { guy.row = ROW_SIDE; guy.dir = (Math.floor(guy.t / 900) % 4 === 1) ? 1 : -1; }
				if (!playing() || guy.t > guy.target) { pickIdea(); }
				break;

			case "walk":
				guy.vx = guy.dir * WALK;
				// turn at an edge rather than stroll off it — though once in a
				// while he misjudges it, which is half the charm
				if (guy.onGround && !floorAhead()) {
					if (Math.random() < 0.85) { guy.dir *= -1; }
					else { guy.state = "fall"; }
				}
				if (guy.t > guy.target) { pickIdea(); }
				break;

			case "chase":
				var d = guy.target - (guy.x + FRAME * scale / 2);
				guy.dir = d > 0 ? 1 : -1;
				if (Math.abs(d) < 12) {
					guy.vx = 0;
					guy.state = "idle";
					guy.row = ROW_UP;          // looking up at the light
					guy.t = 0;
					guy.target = 1200 + Math.random() * 1600;
				} else {
					guy.vx = guy.dir * WALK * 1.2;
					if (guy.onGround && !floorAhead()) { guy.dir *= -1; guy.target = guy.x; }
					if (guy.t > 6000) { pickIdea(); }
				}
				break;

			case "hop":
				// ONE jump, on the frame he leaves the ground
				if (guy.onGround && !guy.jumped) {
					guy.vy = JUMP;
					guy.onGround = false;
					guy.jumped = true;
				}
				guy.vx = guy.dir * WALK * 1.1;
				if (guy.jumped && guy.onGround) { pickIdea(); }
				break;

			case "fall":
				guy.vx *= 0.98;
				break;
		}

		// physics
		guy.vy += GRAV * dt;
		guy.x += guy.vx * dt;
		guy.y += guy.vy * dt;

		var size = FRAME * scale;
		var footX = guy.x + size / 2;
		var footY = guy.y + size;

		// walk off an edge and you fall — that's the fun of it
		if (guy.vy >= 0) {
			var l = ledgeUnder(footX, footY - guy.vy * dt - 1);
			if (l && footY >= l.y && footY - guy.vy * dt <= l.y + 12) {
				guy.y = l.y - size;
				guy.vy = 0;
				guy.onGround = true;
				guy.ledge = l;
			} else {
				guy.onGround = false;
			}
		}

		// the floor of the screen catches him, then he climbs back up
		if (guy.y + size > H - 2) {
			guy.y = H - 2 - size;
			guy.vy = 0;
			guy.onGround = true;
			if (guy.state === "fall") { pickIdea(); }
		}
		if (guy.state === "fall" && guy.onGround) { pickIdea(); }

		// keep him on screen
		if (guy.x < 2) { guy.x = 2; guy.dir = 1; }
		if (guy.x > W - size - 2) { guy.x = W - size - 2; guy.dir = -1; }

		// he lets himself back in eventually
		if (Date.now() > homeTimer) { goHome(); }
	}

	/* ---------- draw ---------- */

	function draw(now) {
		ctx.clearRect(0, 0, W, H);
		var dancing = guy.state === "dance";
		var moving = dancing || Math.abs(guy.vx) > 0.004 || !guy.onGround;
		var sh = sheets[moving ? "hero_walk" : "hero_idle"];
		if (!sh) { return; }
		var nf = moving ? WALK_F : IDLE_F;
		var fps = dancing ? 12 : (moving ? 8 : 3);
		var f = Math.floor(now / (1000 / fps)) % nf;
		var size = FRAME * scale;
		var mirror = guy.row === ROW_SIDE && guy.dir < 0;
		var lift = Math.round(guy.bob * (dancing ? 6 : 2));

		// a soft shadow so he doesn't look pasted on
		if (guy.onGround) {
			ctx.fillStyle = "rgba(0,0,0,0.28)";
			ctx.beginPath();
			ctx.ellipse(guy.x + size / 2, guy.y + size - 1, size * 0.26, 2.5, 0, 0, 7);
			ctx.fill();
		}
		ctx.save();
		ctx.translate(Math.round(guy.x + (mirror ? size : 0)), Math.round(guy.y) - lift);
		ctx.scale(mirror ? -1 : 1, 1);
		ctx.drawImage(sh, f * FRAME, guy.row * FRAME, FRAME, FRAME, 0, 0, size, size);
		ctx.restore();
	}

	function loop(now) {
		if (!out) { raf = null; return; }
		raf = requestAnimationFrame(loop);
		var dt = Math.min(50, now - last); last = now;
		step(dt);
		draw(now);
	}

	/* ---------- in and out ---------- */

	function build() {
		if (cv) { return; }
		cv = document.createElement("canvas");
		cv.id = "escapeCanvas";
		document.body.appendChild(cv);
		ctx = cv.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		size();
		window.addEventListener("resize", size);
	}

	function size() {
		if (!cv) { return; }
		W = window.innerWidth; H = window.innerHeight;
		DPR = Math.min(2, window.devicePixelRatio || 1);
		cv.width = W * DPR; cv.height = H * DPR;
		cv.style.width = W + "px"; cv.style.height = H + "px";
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		ctx.imageSmoothingEnabled = false;
	}

	function release(x, y, heroScale) {
		if (out) { return false; }
		build();
		scale = Math.max(1.2, Math.min(2.2, heroScale || 1.6));
		loadSheets(function () {
			out = true;
			cv.classList.add("on");
			guy.x = x; guy.y = y;
			guy.vx = 0; guy.vy = 0;
			guy.dir = 1;
			guy.state = "fall";
			guy.onGround = false;
			readLedges();
			// two to four minutes of wandering, then he lets himself back in
			homeTimer = Date.now() + 120000 + Math.random() * 120000;
			last = performance.now();
			if (!raf) { raf = requestAnimationFrame(loop); }
			try { PO33.flash("he's out", "tip"); } catch (e) {}
		});
		return true;
	}

	function goHome() {
		if (!out) { return; }
		out = false;
		if (cv) { cv.classList.remove("on"); }
		try { if (PO33.scene && PO33.scene.comeHome) { PO33.scene.comeHome(); } } catch (e) {}
	}

	function isOut() { return out; }

	// tap him to send him back. The canvas can't receive the tap (it must
	// never block the UI), so this listens on the document and checks whether
	// the tap landed on him.
	document.addEventListener("pointerdown", function (e) {
		if (!out) { return; }
		var size2 = FRAME * scale;
		if (e.clientX >= guy.x && e.clientX <= guy.x + size2 &&
			e.clientY >= guy.y && e.clientY <= guy.y + size2) {
			goHome();
		}
	}, true);

	/* He notices you. Pressing a pad makes him look over, and if you press one
	 * near him he'll wander towards it — the interface is his world, so things
	 * happening in it should register. Passive listener, capture phase, never
	 * interferes with the press itself. */
	document.addEventListener("pointerdown", function (e) {
		if (!out || !e.target.closest) { return; }
		var el = e.target.closest("[id^='btn'], .perfCells button, .perfTabs button");
		if (!el) { return; }
		guy.lastPoke = Date.now();
		var r = el.getBoundingClientRect();
		var mid = r.left + r.width / 2;
		var size = FRAME * scale;
		// look towards it, and if it's close by, go and have a look
		guy.dir = mid > guy.x + size / 2 ? 1 : -1;
		if (guy.state !== "dance" && Math.abs(mid - (guy.x + size / 2)) < 160 && Math.random() < 0.4) {
			guy.state = "chase";
			guy.target = mid;
			guy.t = 0;
		}
	}, true);

	window.PO33.escape = {
		release: release, goHome: goHome, isOut: isOut,
		state: function () { return { state: guy.state, row: guy.row, bob: +guy.bob.toFixed(2),
			x: Math.round(guy.x), y: Math.round(guy.y), onGround: guy.onGround }; }
	};
})();
