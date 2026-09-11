/* skin.js — device skins.
 *
 * The engine only ever addresses the DOM by id, which is what makes a reskin
 * possible without touching a line of audio code: the chassis is genuinely
 * separable from the machine.
 *
 * Skins are scoped CSS override layers (skins/*.css) selected by a data-skin
 * attribute on <body>, rather than a full tokenisation of the existing
 * stylesheets. That keeps the default PO-33 look literally untouched — it has
 * no data-skin rules pointed at it, so it cannot regress when a skin changes.
 *
 * Exposes window.PO33.skin
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var KEY = "po33.skin";
	var SKINS = [
		{ id: "po33", name: "PO-33", blurb: "the original: bare circuit board, green LCD" },
		{ id: "op1", name: "OP-1 field", blurb: "aluminium body, white keys, black screen" }
	];

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "tip"); } }

	function current() {
		try { return localStorage.getItem(KEY) || "po33"; } catch (e) { return "po33"; }
	}

	function set(id, quiet) {
		if (!SKINS.some(function (s) { return s.id === id; })) { return current(); }
		if (id === "po33") { document.body.removeAttribute("data-skin"); }
		else { document.body.setAttribute("data-skin", id); }
		try { localStorage.setItem(KEY, id); } catch (e) {}

		// the LCD motif takes its ink from the screen's own palette, so the
		// figure is drawn in whatever colour this skin's display uses
		try { if (window.PO33.scene && PO33.scene.reink) { PO33.scene.reink(); } } catch (e) {}

		if (!quiet) {
			var s = SKINS.filter(function (x) { return x.id === id; })[0];
			flash("skin: " + s.name, "warn");
		}
		return id;
	}

	function next() {
		var ids = SKINS.map(function (s) { return s.id; });
		return set(ids[(ids.indexOf(current()) + 1) % ids.length]);
	}

	window.PO33.skin = {
		list: function () { return SKINS.slice(); },
		current: current,
		set: set,
		next: next
	};

	// apply before first paint where possible, so there's no flash of the
	// wrong chassis on load
	function apply() { set(current(), true); }
	if (document.body) { apply(); }
	else { document.addEventListener("DOMContentLoaded", apply); }
})();
