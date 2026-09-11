/* projects.js — save, organise and move whole projects.
 *
 * Projects live in localStorage, which is per-origin and survives site
 * updates, and can also be exported to real files on disk so a beat isn't
 * trapped in one browser on one device.
 *
 * A project is a complete snapshot: patterns, the chain, tempo, swing,
 * volume, which samples are in which slots, AND the keyboard track and the
 * effects lane. Those last two were missing before — you could save a project
 * with a synth part recorded into it, reopen it, and the synth part would be
 * gone. Anything the sequencer can play is in here now.
 *
 * Exposes window.PO33.projects
 */
(function () {
	"use strict";

	var KEY = "po33.projects";        // { name: {snapshot} }
	var CUR = "po33.currentProject";  // last-used name
	var FOLDERS = "po33.folders";     // [names]
	var view, listEl, nameInput, curLabel, fileInput;
	var sel = null;                   // selected project name
	var filter = "";                  // "" = all folders

	function load() {
		try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
	}
	function save(obj) {
		try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
		catch (e) { flash("out of storage space", "warn"); return false; }
	}
	function currentName() {
		try { return localStorage.getItem(CUR) || ""; } catch (e) { return ""; }
	}
	function setCurrent(n) { try { localStorage.setItem(CUR, n); } catch (e) {} }

	function folders() {
		var out = [];
		try { out = JSON.parse(localStorage.getItem(FOLDERS)) || []; } catch (e) {}
		// any folder named on a project counts, even if the list lost it
		var all = load();
		Object.keys(all).forEach(function (n) {
			var f = all[n].folder;
			if (f && out.indexOf(f) === -1) { out.push(f); }
		});
		return out;
	}
	function setFolders(list) {
		try { localStorage.setItem(FOLDERS, JSON.stringify(list)); } catch (e) {}
	}

	function flash(m, k) { if (window.PO33 && PO33.flash) { PO33.flash(m, k || "info"); } }

	/* ---------- snapshot / restore of engine state ---------- */

	function snapshot(keepFolder) {
		var snap = {
			v: 2,
			t: Date.now(),
			folder: keepFolder || "",
			channels: window.newChannelArr,
			chain: window.patternChain || [0],
			tempo: window.tempo || 120,
			swing: window.swing || 0,
			volume: (typeof window.volume === "number") ? window.volume : 8,
			currentPattern: window.currentPattern || 0,
			slots: (window.PO33Lib && PO33Lib.slotIds) ? PO33Lib.slotIds() : null
		};
		// the parts that don't live in newChannelArr
		try { snap.keys = PO33.keys.snapshot(); } catch (e) {}
		try { snap.fx = PO33.fxRec.snapshot(); } catch (e) {}
		return snap;
	}

	function restore(s) {
		if (!s) { return; }
		try {
			if (s.channels) { window.newChannelArr = JSON.parse(JSON.stringify(s.channels)); }
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
			if (s.keys) { try { PO33.keys.restore(s.keys); } catch (e) {} }
			if (s.fx) { try { PO33.fxRec.load(s.fx); } catch (e) {} }
			if (s.slots) {
				try { localStorage.setItem("po33.slots", JSON.stringify(s.slots)); } catch (e) {}
				if (window.PO33Lib && PO33Lib.restoreSlots) { PO33Lib.restoreSlots(); }
			}
			try { PO33.session.save(); } catch (e) {}
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) { flash("could not load project", "warn"); }
	}

	/* ---------- a description of what's inside, for the list ---------- */

	function describe(s) {
		var parts = 0, hits = 0;
		try {
			for (var ch = 0; ch < 16; ch++) {
				var used = false;
				for (var p = 0; p < 16; p++) {
					for (var b = 0; b < 16; b++) {
						if (s.channels[ch][p][b].noteOn) { hits++; used = true; }
					}
				}
				if (used) { parts++; }
			}
		} catch (e) {}
		var d = new Date(s.t);
		return (s.tempo || 120) + " bpm · " + parts + " part" + (parts === 1 ? "" : "s") +
			" · " + (d.getMonth() + 1) + "/" + d.getDate();
	}

	/* ---------- actions ---------- */

	function uniqueName(base) {
		var all = load();
		if (!all[base]) { return base; }
		var i = 2;
		while (all[base + " " + i]) { i++; }
		return base + " " + i;
	}

	function saveAs(name, folder) {
		var all = load();
		name = (name || "").trim() || uniqueName("project " + (Object.keys(all).length + 1));
		all[name] = snapshot(folder != null ? folder : (all[name] && all[name].folder) || filter);
		if (!save(all)) { return; }
		setCurrent(name);
		flash("saved “" + name + "”", "tip");
		render();
	}

	function saveCurrent() {
		var n = currentName();
		if (!n) { saveAs(nameInput && nameInput.value); return; }
		saveAs(n);
	}

	/* Start over: a clean, empty project rather than the shipped demo
	 * patterns. Everything the sequencer can play gets cleared. */
	function newProject(name) {
		try {
			for (var ch = 0; ch < 16; ch++) {
				for (var p = 0; p < 16; p++) {
					for (var b = 0; b < 16; b++) { window.newChannelArr[ch][p][b].noteOn = 0; }
				}
			}
			window.patternChain = [0];
			window.patternCount = 0;
			window.currentPattern = 0;
			try { PO33.keys.restore({}); } catch (e) {}
			try { PO33.fxRec.load({}); } catch (e) {}
			try { PO33.undo.clear(); } catch (e) {}
			try { PO33.session.save(); } catch (e) {}
			if (window.updateDisplay) { window.updateDisplay(); }
		} catch (e) {}
		saveAs(uniqueName((name || "").trim() || "new project"));
		flash("empty project — nothing on any pattern", "warn");
	}

	function open(name) {
		var all = load();
		if (!all[name]) { return; }
		restore(all[name]);
		setCurrent(name);
		flash("loaded “" + name + "”", "tip");
		hide();
	}

	function rename(from, to) {
		to = (to || "").trim();
		if (!to || to === from) { return; }
		var all = load();
		if (!all[from]) { return; }
		if (all[to]) { flash("“" + to + "” already exists", "warn"); return; }
		all[to] = all[from];
		delete all[from];
		if (!save(all)) { return; }
		if (currentName() === from) { setCurrent(to); }
		sel = to;
		flash("renamed to “" + to + "”", "tip");
		render();
	}

	function duplicate(name) {
		var all = load();
		if (!all[name]) { return; }
		var copy = uniqueName(name + " copy");
		all[copy] = JSON.parse(JSON.stringify(all[name]));
		all[copy].t = Date.now();
		if (!save(all)) { return; }
		flash("copied to “" + copy + "”", "tip");
		render();
	}

	function moveTo(name, folder) {
		var all = load();
		if (!all[name]) { return; }
		all[name].folder = folder || "";
		if (!save(all)) { return; }
		flash(folder ? ("moved to " + folder) : "moved out of its folder", "tip");
		render();
	}

	function remove(name) {
		var all = load();
		delete all[name];
		save(all);
		if (currentName() === name) { setCurrent(""); }
		if (sel === name) { sel = null; }
		render();
	}

	function newFolder(name) {
		name = (name || "").trim();
		if (!name) { return; }
		var f = folders();
		if (f.indexOf(name) === -1) { f.push(name); setFolders(f); }
		filter = name;
		if (sel) { moveTo(sel, name); } else { render(); }
	}

	/* ---------- export / import to real files ---------- */

	function exportOne(name) {
		var all = load();
		if (!all[name]) { return; }
		download(name + ".po33.json", JSON.stringify({ name: name, project: all[name] }, null, 1));
		flash("exported “" + name + "”", "tip");
	}

	function exportAll() {
		var all = load();
		if (!Object.keys(all).length) { flash("nothing to export", "warn"); return; }
		download("po33-projects.json", JSON.stringify({ all: all, folders: folders() }, null, 1));
		flash("exported " + Object.keys(all).length + " projects", "tip");
	}

	function download(filename, text) {
		try {
			var blob = new Blob([text], { type: "application/json" });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
		} catch (e) { flash("could not export", "warn"); }
	}

	function importFile(file) {
		if (!file) { return; }
		var fr = new FileReader();
		fr.onload = function () {
			var data;
			try { data = JSON.parse(fr.result); } catch (e) { flash("not a project file", "warn"); return; }
			var all = load(), n = 0;
			if (data.all) {
				Object.keys(data.all).forEach(function (k) {
					all[uniqueName(k)] = data.all[k]; n++;
				});
				if (data.folders) { setFolders(data.folders); }
			} else if (data.project) {
				all[uniqueName(data.name || "imported")] = data.project; n = 1;
			} else { flash("not a project file", "warn"); return; }
			if (!save(all)) { return; }
			flash("imported " + n + " project" + (n === 1 ? "" : "s"), "tip");
			render();
		};
		fr.readAsText(file);
	}

	/* ---------- the on-screen browser ---------- */

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || document.getElementById("projView")) { return; }

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
				'<input id="pvName" type="text" placeholder="name…" maxlength="28">' +
				'<button type="button" data-pv="new">+ new</button>' +
				'<button type="button" data-pv="saveas">save as</button>' +
				'<button type="button" data-pv="save">save</button>' +
			'</div>' +
			'<div class="pvFolders" id="pvFolders"></div>' +
			'<div id="pvList"></div>' +
			'<div class="pvFoot">' +
				'<span class="pvCur" id="pvCur"></span>' +
				'<button type="button" data-pv="import">import</button>' +
				'<button type="button" data-pv="exportall">export all</button>' +
			'</div>' +
			'<input type="file" id="pvFile" accept=".json,application/json" hidden>';
		hud.appendChild(view);

		listEl = view.querySelector("#pvList");
		nameInput = view.querySelector("#pvName");
		curLabel = view.querySelector("#pvCur");
		fileInput = view.querySelector("#pvFile");

		fileInput.addEventListener("change", function () {
			importFile(fileInput.files && fileInput.files[0]);
			fileInput.value = "";
		});

		view.addEventListener("click", function (e) {
			var t = e.target.closest("[data-pv],[data-name],[data-folder]");
			if (!t) { return; }
			var a = t.getAttribute("data-pv");
			var row = t.closest("[data-name]");
			var name = row && row.dataset.name;

			if (t.hasAttribute("data-folder") && !a) {
				filter = t.getAttribute("data-folder");
				sel = null;
				render();
				return;
			}

			switch (a) {
				case "close":     hide(); break;
				case "new":       newProject(nameInput.value); nameInput.value = ""; break;
				case "saveas":    saveAs(nameInput.value); nameInput.value = ""; break;
				case "save":      saveCurrent(); break;
				case "import":    fileInput.click(); break;
				case "exportall": exportAll(); break;
				case "newfolder":
					var fn = prompt("folder name");
					if (fn) { newFolder(fn); }
					break;
				case "pick":      sel = (sel === name) ? null : name; render(); break;
				case "open":      open(sel); break;
				case "rename":
					var nn = prompt("rename “" + sel + "” to", sel);
					if (nn) { rename(sel, nn); }
					break;
				case "dup":       duplicate(sel); break;
				case "export":    exportOne(sel); break;
				case "move":
					var f = folders();
					var target = prompt("move to which folder?\n" +
						(f.length ? f.join(", ") : "(no folders yet)") +
						"\n\nleave blank for none", load()[sel] ? load()[sel].folder || "" : "");
					if (target !== null) {
						target = target.trim();
						if (target) { newFolder(target); }
						moveTo(sel, target);
					}
					break;
				case "del":
					if (confirm("delete “" + sel + "”?")) { remove(sel); }
					break;
				case "done":      sel = null; render(); break;
			}
		});
		render();
	}

	function render() {
		if (!listEl) { return; }
		var all = load();
		var cur = currentName();
		var fs = folders();

		// folder chips
		var fEl = view.querySelector("#pvFolders");
		var counts = {};
		Object.keys(all).forEach(function (n) {
			var f = all[n].folder || "";
			counts[f] = (counts[f] || 0) + 1;
		});
		var chips = '<button type="button" data-folder=""' + (filter === "" ? ' class="on"' : "") +
			">all <i>" + Object.keys(all).length + "</i></button>";
		fs.forEach(function (f) {
			chips += '<button type="button" data-folder="' + esc(f) + '"' +
				(filter === f ? ' class="on"' : "") + ">" + esc(f) +
				" <i>" + (counts[f] || 0) + "</i></button>";
		});
		chips += '<button type="button" data-pv="newfolder" class="pvAddFolder">+ folder</button>';
		fEl.innerHTML = chips;

		// rows
		var names = Object.keys(all)
			.filter(function (n) { return filter === "" || (all[n].folder || "") === filter; })
			.sort(function (a, b) { return all[b].t - all[a].t; });

		listEl.innerHTML = names.length ? "" :
			'<div class="pvEmpty">' + (filter ? "nothing in this folder" : "no saved projects yet") + "</div>";

		names.forEach(function (n) {
			var row = document.createElement("div");
			row.className = "pvRow" + (n === cur ? " cur" : "") + (n === sel ? " sel" : "");
			row.dataset.name = n;
			row.innerHTML =
				'<button type="button" data-pv="pick" class="pvPick">' +
					'<b>' + esc(n) + '</b>' +
					'<span class="pvMeta">' + esc(describe(all[n])) +
					(all[n].folder ? ' · <i>' + esc(all[n].folder) + "</i>" : "") + "</span>" +
				"</button>";
			listEl.appendChild(row);

			if (n === sel) {
				var bar = document.createElement("div");
				bar.className = "pvTools";
				bar.dataset.name = n;
				bar.innerHTML =
					'<button type="button" data-pv="open" class="go">open</button>' +
					'<button type="button" data-pv="rename">rename</button>' +
					'<button type="button" data-pv="move">folder</button>' +
					'<button type="button" data-pv="dup">copy</button>' +
					'<button type="button" data-pv="export">export</button>' +
					'<button type="button" data-pv="del" class="del">delete</button>' +
					'<button type="button" data-pv="done" class="done">done</button>';
				listEl.appendChild(bar);
			}
		});

		if (curLabel) { curLabel.textContent = cur ? ("current: " + cur) : "unsaved project"; }
	}

	function esc(s) {
		return String(s).replace(/[<>&"]/g, function (c) {
			return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
		});
	}

	function isOpen() { return document.body.classList.contains("projOpen"); }
	function show() {
		build();
		if (window.PO33 && PO33.util) { PO33.util.hide(); }
		if (view) { document.body.classList.add("projOpen"); view.hidden = false; render(); }
	}
	function hide() { document.body.classList.remove("projOpen"); if (view) { view.hidden = true; } }
	function toggle() { if (isOpen()) { hide(); } else { show(); } }

	window.PO33 = window.PO33 || {};
	window.PO33.projects = {
		save: saveAs, saveCurrent: saveCurrent, open: open, remove: remove,
		rename: rename, duplicate: duplicate, newProject: newProject,
		moveTo: moveTo, folders: folders, newFolder: newFolder,
		exportOne: exportOne, exportAll: exportAll,
		list: function () { return Object.keys(load()); },
		show: show, hide: hide
	};

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
