/* mobile.js — phone drawer chrome.
 * Bottom-left button opens a touch-worded guide (PO slides right);
 * bottom-right button opens the sample library (PO slides left).
 * Only active on touch / narrow screens; a no-op on desktop.
 */
(function () {
	"use strict";

	var mq = window.matchMedia("(max-width: 720px), (pointer: coarse)");

	/* The guide drawer.
	 *
	 * Content comes from guide.js so there is exactly one copy of it. Each
	 * section is a <details> accordion with a numbered badge, which is the
	 * only shape that works for a 25-section manual on a phone: everything
	 * is one thumb-scroll away collapsed, and opening one does not lose
	 * your place.
	 *
	 * The chips filter by group. Search ignores them and looks everywhere,
	 * because when you have a question you do not know which chip it is
	 * filed under. A search hit opens itself so you can read the answer
	 * without a second tap.
	 */
	function guideData() {
		return window.PO33Guide || { groups: [["all", "all"]], sections: [] };
	}

	function infoMarkup() {
		var G = guideData();
		var h = '<div class="drawerHead"><h2>Guide</h2>' +
			'<button class="drawerClose" data-close aria-label="close">&times;</button></div>' +
			'<div class="gLcd gLcdSlim">' +
				'<span class="gLcdTop">MANUAL</span>' +
				'<span class="gLcdBig">HOW TO PLAY ME!</span>' +
				'<span class="gLcdSub">' + G.sections.length + ' sections &middot; tap one to open</span>' +
				'<i class="gLcdDot"></i>' +
			'</div>' +
			'<input id="infoSearch" type="search" placeholder="search the guide" autocomplete="off">' +
			'<div id="infoNav">';
		G.groups.forEach(function (t, i) {
			h += '<button data-iv="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') + '>' + t[1] + '</button>';
		});
		h += '</div><div id="infoBody">';
		G.sections.forEach(function (e) {
			// .infoItem is what search filters on; data-view is what the chips filter on
			h += '<details class="gSec infoItem" data-view="' + e.g + '">' +
					'<summary><span class="gNum">' + e.n + '</span>' + e.t + '</summary>' +
					'<div class="gBody">' + e.b + '</div>' +
				'</details>';
		});
		h += '</div><div id="infoNone" hidden>nothing matches that</div>';
		return h;
	}

	var INFO_HTML = infoMarkup();

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
		// the library is already on screen on desktop; the link only drives
		// the drawer on a phone
		if (fabLib) { fabLib.addEventListener("click", function () { if (mq.matches) { toggle("lib"); } }); }
		scrim.addEventListener("click", close);
		info.addEventListener("click", function (e) {
			if (e.target.closest("[data-close]")) { close(); }
		});
		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape") { close(); }
		});
		/* search across every entry, in all tabs at once — the fastest way to
		 * find one answer without knowing which tab it lives under */
		function applyGroup(info) {
			var nav = info.querySelector("#infoNav");
			var active = nav ? nav.querySelector("button.on") : null;
			var want = active ? active.getAttribute("data-iv") : "all";
			info.querySelectorAll(".infoItem").forEach(function (it) {
				it.hidden = !(want === "all" || it.getAttribute("data-view") === want);
			});
		}

		/* search across every section, ignoring the chips — the fastest way
		 * to find one answer without knowing which group it lives under. A
		 * hit opens itself: making you tap twice to read a result you already
		 * searched for is a waste of a tap. */
		info.addEventListener("input", function (e) {
			if (!e.target || e.target.id !== "infoSearch") { return; }
			var q = e.target.value.trim().toLowerCase();
			var nav = info.querySelector("#infoNav");
			var none = info.querySelector("#infoNone");
			var hits = 0;

			if (!q) {
				nav.hidden = false;
				none.hidden = true;
				info.querySelectorAll(".infoItem").forEach(function (it) { it.open = false; });
				applyGroup(info);
				return;
			}

			nav.hidden = true;
			info.querySelectorAll(".infoItem").forEach(function (it) {
				var match = it.textContent.toLowerCase().indexOf(q) !== -1;
				it.hidden = !match;
				it.open = match;
				if (match) { hits++; }
			});
			none.hidden = hits > 0;
		});

		// group chips
		info.addEventListener("click", function (e) {
			var t = e.target.closest("#infoNav button");
			if (!t) { return; }
			info.querySelectorAll("#infoNav button").forEach(function (b) {
				b.classList.toggle("on", b === t);
			});
			applyGroup(info);
			var body = info.querySelector("#infoBody");
			if (body) { body.scrollTop = 0; }
		});

		applyGroup(info);

		document.addEventListener("change", function (e) {
			var id = e.target && e.target.id;
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
		// The mobile layout is FLUID now: CSS sizes the unit to the viewport width
		// and the LCD absorbs the leftover height. The old transform: scale()
		// shrank the width whenever height was the binding constraint, which is
		// exactly why it never filled the screen. Just clear any stale inline
		// transform/width an older build may have left pinned on the board.
		fitting = true;
		board.style.transform = "";
		board.style.width = "";
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

	/* ------------------------------------------------------------------
	 * On a phone the library doesn't slide in from the side any more — it
	 * takes over the screen itself, the way a mode change does on the real
	 * unit. The <aside> is MOVED into a slot inside .lcd rather than being
	 * duplicated, so library.js keeps addressing the same nodes by id.
	 * ------------------------------------------------------------------ */
	var libHome = null;

	function dockLibrary(on) {
		var lib = document.getElementById("library");
		var slot = document.getElementById("lcdLibSlot");
		if (!lib || !slot) { return; }
		if (on) {
			if (!libHome) { libHome = { parent: lib.parentNode, next: lib.nextSibling }; }
			if (lib.parentNode !== slot) { slot.appendChild(lib); }
			document.body.classList.add("lib-lcd");
		} else {
			if (libHome && lib.parentNode === slot) {
				libHome.parent.insertBefore(lib, libHome.next);
			}
			document.body.classList.remove("lib-lcd");
		}
	}

	function toggle(which) {
		var b = document.body;
		var open = which === "info" ? "drawer-info" : "drawer-lib";
		var other = which === "info" ? "drawer-lib" : "drawer-info";
		b.classList.remove(other);
		if (other === "drawer-lib") { dockLibrary(false); }
		var isOpen = b.classList.toggle(open);
		b.classList.toggle("drawer-open", isOpen);
		if (which === "lib") { dockLibrary(isOpen && mq.matches); }
	}

	function close() {
		dockLibrary(false);
		document.body.classList.remove("drawer-info", "drawer-lib", "drawer-open");
	}

	var watching = false;
	function sync() {
		// The guide drawer is built on EVERY form factor now. It used to be
		// phone-only, because desktop had its own copy of the manual as a
		// sidebar in index.html — that copy is gone, so gating this on the
		// media query would leave desktop with an info button that does
		// nothing. Only the viewport-fitting work below is phone-only.
		build();
		if (mq.matches) {
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
