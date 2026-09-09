/* projects.js — save / load whole projects to the browser (survives site
 * updates: localStorage is per-origin, not tied to the deployed files) and an
 * on-screen PROJECT browser drawn over the LCD (touch screen inside a touch
 * screen). Exposes window.PO33.projects.
 */
(function () {
	"use strict";

	var KEY = "po33.projects";      // { name: {snapshot} }
	var CUR = "po33.currentProject"; // last-used name
	var view, listEl, nameInput, curLabel;

	function load() {
		try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
	}
	function save(obj) {
		try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) {}
	}
	function currentName() {
		try { return localStorage.getItem(CUR) || ""; } catch (e) { return ""; }
	}
	function setCurrent(n) { try { localStorage.setItem(CUR, n); } catch (e) {} }

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	/* ---------- snapshot / restore of engine state ---------- */

	function snapshot() {
		return {
			t: Date.now(),
			channels: window.newChannelArr,
			chain: window.patternChain || [0],
			tempo: window.tempo || 120,
			swing: window.swing || 0,
			volume: (typeof window.volume === "number") ? window.volume : 8,
			currentPattern: window.currentPattern || 0,
			slots: (window.PO33Lib && PO33Lib.slotIds) ? PO33Lib.slotIds() : null
		};
	}

	function restore(s) {
		if (!s) { return; }
		try {
			if (s.channels) { window.newChannelArr = s.channels; }
			if (s.chain) { window.patternChain = s.chain.slice(); }
			if (typeof s.tempo === "number") {
				window.tempo = s.tempo;
				try { Tone.Transport.bpm.value = s.tempo; } catch (e) {}
			}
			if (typeof s.swing === "number") {
				window.swing = s.swing;
				try { Tone.Transport.swing = s.swing / 1000; } catch (e) {}
			}
			if (typeof s.volume === "number") { window.volume = s.volume; }
			window.currentPattern = s.currentPattern || 0;
			window.patternCount = 0;
			if (s.slots) {
				try { localStorage.setItem("po33.slots", JSON.stringify(s.slots)); } catch (e) {}
				if (window.PO33Lib && PO33Lib.restoreSlots) { PO33Lib.restoreSlots(); }
			}
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) { flash("could not load project", "warn"); }
	}

	/* ---------- public actions ---------- */

	function saveAs(name) {
		name = (name || "").trim() || ("project " + (Object.keys(load()).length + 1));
		var all = load();
		all[name] = snapshot();
		save(all);
		setCurrent(name);
		flash("saved “" + name + "”", "tip");
		render();
	}
	function saveCurrent() {
		var n = currentName();
		if (!n) { saveAs(nameInput && nameInput.value); return; }
		saveAs(n);
	}
	function open(name) {
		var all = load();
		if (!all[name]) { return; }
		restore(all[name]);
		setCurrent(name);
		flash("loaded “" + name + "”", "tip");
		hide();
	}
	function remove(name) {
		var all = load();
		delete all[name];
		save(all);
		if (currentName() === name) { setCurrent(""); }
		render();
	}

	/* ---------- on-screen browser ---------- */

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || document.getElementById("projView")) { return; }

		// PROJ button in the HUD top bar
		var top = hud.querySelector(".hudTop");
		if (top && !document.getElementById("projBtn")) {
			var b = document.createElement("button");
			b.id = "projBtn";
			b.type = "button";
			b.textContent = "PROJ";
			b.addEventListener("click", toggle);
			top.insertBefore(b, top.firstChild.nextSibling);
		}

		view = document.createElement("div");
		view.id = "projView";
		view.hidden = true;
		view.innerHTML =
			'<div class="pvHead"><span>PROJECTS</span>' +
				'<button type="button" data-pv="close">&times;</button></div>' +
			'<div class="pvNew">' +
				'<input id="pvName" type="text" placeholder="name…" maxlength="24">' +
				'<button type="button" data-pv="saveas">save new</button>' +
				'<button type="button" data-pv="save">save</button>' +
			'</div>' +
			'<div id="pvList"></div>' +
			'<div class="pvCur" id="pvCur"></div>';
		hud.appendChild(view);

		listEl = view.querySelector("#pvList");
		nameInput = view.querySelector("#pvName");
		curLabel = view.querySelector("#pvCur");

		view.addEventListener("click", function (e) {
			var a = e.target.getAttribute("data-pv");
			if (a === "close") { hide(); }
			else if (a === "saveas") { saveAs(nameInput.value); nameInput.value = ""; }
			else if (a === "save") { saveCurrent(); }
			else if (a === "open") { open(e.target.closest("[data-name]").dataset.name); }
			else if (a === "del") { e.stopPropagation(); remove(e.target.closest("[data-name]").dataset.name); }
		});
		render();
	}

	function render() {
		if (!listEl) { return; }
		var all = load(), names = Object.keys(all).sort(function (a, b) { return all[b].t - all[a].t; });
		var cur = currentName();
		listEl.innerHTML = names.length ? "" : '<div class="pvEmpty">no saved projects yet</div>';
		names.forEach(function (n) {
			var row = document.createElement("div");
			row.className = "pvRow" + (n === cur ? " cur" : "");
			row.dataset.name = n;
			var d = new Date(all[n].t);
			row.innerHTML =
				'<button type="button" data-pv="open">' + esc(n) + '</button>' +
				'<span class="pvDate">' + (d.getMonth() + 1) + "/" + d.getDate() + '</span>' +
				'<button type="button" data-pv="del" title="delete">&times;</button>';
			listEl.appendChild(row);
		});
		if (curLabel) { curLabel.textContent = cur ? ("current: " + cur) : "unsaved project"; }
	}

	function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }); }

	function isOpen() { return document.body.classList.contains("projOpen"); }
	function show() { build(); if (window.PO33 && PO33.util) { PO33.util.hide(); } if (view) { document.body.classList.add("projOpen"); view.hidden = false; render(); } }
	function hide() { document.body.classList.remove("projOpen"); if (view) { view.hidden = true; } }
	function toggle() { if (isOpen()) { hide(); } else { show(); } }

	window.PO33 = window.PO33 || {};
	window.PO33.projects = { save: saveAs, saveCurrent: saveCurrent, open: open, remove: remove, list: function () { return Object.keys(load()); }, show: show, hide: hide };

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (document.getElementById("lcdHud")) { build(); clearInterval(iv); }
			else if (++tries > 80) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
