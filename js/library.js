/* library.js
 * Sample + slot browser docked under the unit. Talks to the po33.js engine
 * through the globals it already exposes (melodicArr, melodicFilterArr, drumArr,
 * drumFilterArr, meter, noteArray, selectedChannel). Preview playback is fully
 * independent of the sequencer.
 */
(function () {
	"use strict";

	var MANIFEST = null;
	var previewPlayer = null;
	var currentPreviewBtn = null;
	var slotSampleIds = new Array(16).fill(null); // id string per slot, or null
	var els = {};

	function currentSlot() {
		// po33.js: selectedChannel is 0-15 (0-7 melodic, 8-15 drum)
		var c = (typeof window.selectedChannel === "number") ? window.selectedChannel : 0;
		return Math.max(1, Math.min(16, c + 1));
	}

	function toast(msg) {
		var t = els.toast;
		t.textContent = msg;
		t.classList.add("show");
		clearTimeout(toast._t);
		toast._t = setTimeout(function () { t.classList.remove("show"); }, 1600);
	}

	function refreshTarget() {
		if (!els.target) { return; }
		var s = currentSlot();
		els.target.innerHTML = "click a sample &rarr; loads into <b>SOUND " + s +
			"</b> (" + (s <= 8 ? "melodic" : "drum") + ")";
	}

	/* ---------- preview ---------- */

	function stopPreview() {
		if (previewPlayer) {
			try { previewPlayer.stop(); previewPlayer.dispose(); } catch (e) {}
			previewPlayer = null;
		}
		if (currentPreviewBtn) { currentPreviewBtn.classList.remove("playing"); currentPreviewBtn = null; }
	}

	function preview(url, btn) {
		var wasSame = currentPreviewBtn === btn;
		stopPreview();
		if (wasSame) { return; }
		if (window.Tone && Tone.start) { Tone.start(); }
		var p = new Tone.Player(url, function () { try { p.start(); } catch (e) {} });
		if (p.toMaster) { p.toMaster(); } else { p.toDestination(); }
		p.onstop = function () { if (btn === currentPreviewBtn) { stopPreview(); } };
		previewPlayer = p;
		if (btn) { btn.classList.add("playing"); currentPreviewBtn = btn; }
	}

	/* ---------- assign a sample to a slot ---------- */

	function assign(slot1to16, sample, quiet) {
		if (!window.Tone) { toast("audio not ready"); return; }
		Tone.start && Tone.start();

		var idx = slot1to16 - 1;
		var url = sample.url;

		if (slot1to16 <= 8) {
			if (typeof melodicFilterArr[idx] === "undefined") {
				melodicFilterArr[idx] = new Tone.Filter(20, "highpass");
				melodicFilterArr[idx].chain(meter, Tone.Master);
			}
			try { melodicArr[idx] && melodicArr[idx].dispose(); } catch (e) {}
			melodicArr[idx] = new Tone.Sampler({ "C#4": url });
			melodicArr[idx].connect(melodicFilterArr[idx]);
		} else {
			var di = idx - 8;
			if (typeof drumFilterArr[di] === "undefined") {
				drumFilterArr[di] = new Tone.Filter(20, "highpass");
				drumFilterArr[di].chain(meter, Tone.Master);
			}
			try { drumArr[di] && drumArr[di].dispose(); } catch (e) {}
			var map = {};
			for (var k = 0; k < noteArray.length; k++) { map[noteArray[k]] = url; }
			drumArr[di] = new Tone.Players(map);
			drumArr[di].connect(drumFilterArr[di]);
		}

		slotSampleIds[idx] = sample.id;
		saveSlots();
		if (!quiet) { toast("SOUND " + slot1to16 + "  ←  " + sample.id); }
		rerender();
	}

	// auto-fill a run of slots. mixAllPacks=true → a random spread from every
	// pack ("surprise"); otherwise from the pack currently shown.
	function fillSlots(n, mixAllPacks) {
		if (!MANIFEST) { return; }
		var pool = [];
		if (mixAllPacks) {
			MANIFEST.packs.forEach(function (p) {
				if (p.id === "recordings") { return; }
				pool = pool.concat(p.samples);
			});
		} else {
			pool = (MANIFEST.packs[+els.pack.value] || MANIFEST.packs[0]).samples.slice();
		}
		if (!pool.length) { return; }

		// start slot: melodic run (1-8) or drum run (9-16) depending on selection
		var base = currentSlot() <= 8 ? 1 : 9;
		n = Math.min(n, base === 1 ? 8 : 8);

		// shuffle, then spread the picks across the pool so they're not clustered
		for (var i = pool.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
		}
		var step = Math.max(1, Math.floor(pool.length / n));
		for (var k = 0; k < n; k++) {
			var smp = pool[(k * step) % pool.length];
			assign(base + k, smp, true);
		}
		toast("filled slots " + base + "–" + (base + n - 1));
		if (window.PO33 && PO33.flash) { PO33.flash("auto-filled " + n + " " + (base === 1 ? "melodic" : "drum") + " slots", "tip"); }
	}

	function clearSlot(slot1to16) {
		slotSampleIds[slot1to16 - 1] = null;
		saveSlots();
		rerender();
	}

	function saveSlots() {
		try { localStorage.setItem("po33.slots", JSON.stringify(slotSampleIds)); } catch (e) {}
	}

	function userPack() {
		var p = MANIFEST.packs.find(function (x) { return x.id === "recordings"; });
		if (!p) {
			p = { id: "recordings", name: "★ my recordings", count: 0, samples: [] };
			MANIFEST.packs.unshift(p);
			// rebuild the <select>
			if (els.pack) {
				els.pack.innerHTML = "";
				MANIFEST.packs.forEach(function (pk, i) {
					var o = document.createElement("option");
					o.value = i;
					o.textContent = pk.name + "  (" + pk.count + ")";
					els.pack.appendChild(o);
				});
			}
		}
		return p;
	}

	function addUserSample(id, url, seconds) {
		var p = userPack();
		p.samples.unshift({ id: "recordings/" + id, num: id, url: url, seconds: seconds || null });
		p.count = p.samples.length;
		var pi = MANIFEST.packs.indexOf(p);
		if (els.pack) {
			els.pack.options[pi].textContent = p.name + "  (" + p.count + ")";
			els.pack.value = pi;
		}
		renderSamples();
		return p.samples[0];
	}

	function findSample(id) {
		if (!MANIFEST) { return null; }
		for (var p = 0; p < MANIFEST.packs.length; p++) {
			var s = MANIFEST.packs[p].samples;
			for (var i = 0; i < s.length; i++) { if (s[i].id === id) { return s[i]; } }
		}
		return null;
	}

	function restoreSlots() {
		var raw;
		try { raw = localStorage.getItem("po33.slots"); } catch (e) { return; }
		if (!raw) { return; }
		var saved;
		try { saved = JSON.parse(raw); } catch (e) { return; }
		saved.forEach(function (id, idx) {
			var smp = id && findSample(id);
			if (smp) { assign(idx + 1, smp, true); }
		});
	}

	/* ---------- rendering ---------- */

	function rerender() {
		if (els.list.dataset.tab === "slots") { renderSlots(); } else { renderSamples(); }
	}

	function renderSamples() {
		refreshTarget();
		var list = els.list;
		list.dataset.tab = "samples";
		list.innerHTML = "";
		var pack = MANIFEST.packs[+els.pack.value] || MANIFEST.packs[0];
		var q = els.search.value.trim().toLowerCase();

		pack.samples.forEach(function (smp) {
			if (q && smp.num.indexOf(q) === -1) { return; }
			var row = document.createElement("div");
			row.className = "libRow";
			if (slotSampleIds.indexOf(smp.id) !== -1) { row.classList.add("loaded"); }
			row.title = "load into SOUND " + currentSlot();
			row.onclick = function (e) {
				if (e.target.closest(".libPlay") || e.target.closest(".libAssign")) { return; }
				assign(currentSlot(), smp);
			};

			var play = document.createElement("button");
			play.className = "libPlay";
			play.textContent = "▶";
			play.title = "preview";
			play.onclick = function () { preview(smp.url, play); };

			var nm = document.createElement("span");
			nm.className = "libName";
			nm.textContent = smp.num;

			var dur = document.createElement("span");
			dur.className = "libDur";
			dur.textContent = smp.seconds != null ? smp.seconds.toFixed(2) + "s" : "";

			var asn = document.createElement("button");
			asn.className = "libAssign";
			asn.textContent = "slot…";
			asn.title = "load into a specific slot";
			asn.onclick = function () { toggleSlotPicker(row, smp); };

			row.append(play, nm, dur, asn);
			list.appendChild(row);
		});
	}

	function toggleSlotPicker(row, smp) {
		var next = row.nextElementSibling;
		if (next && next.classList.contains("slotPicker")) { next.remove(); return; }
		document.querySelectorAll(".slotPicker").forEach(function (n) { n.remove(); });
		var pick = document.createElement("div");
		pick.className = "slotPicker";
		for (var n = 1; n <= 16; n++) {
			(function (slot) {
				var b = document.createElement("button");
				b.textContent = slot;
				if (slot <= 8) { b.className = "melo"; }
				b.onclick = function () { assign(slot, smp); pick.remove(); };
				pick.appendChild(b);
			})(n);
		}
		row.after(pick);
	}

	function renderSlots() {
		var list = els.list;
		list.dataset.tab = "slots";
		list.innerHTML = "";
		for (var n = 1; n <= 16; n++) {
			(function (slot) {
				var idx = slot - 1;
				var id = slotSampleIds[idx];
				var row = document.createElement("div");
				row.className = "slotRow";

				var play = document.createElement("button");
				play.className = "libPlay";
				play.textContent = "▶";
				play.onclick = function () {
					var smp = id && findSample(id);
					if (smp) { preview(smp.url, play); } else { toast("slot empty"); }
				};

				var i = document.createElement("span");
				i.className = "idx";
				i.textContent = slot;

				var role = document.createElement("span");
				role.className = "role";
				role.textContent = slot <= 8 ? "melodic" : "drum";

				var val = document.createElement("span");
				val.className = "val" + (id ? "" : " empty");
				val.textContent = id || "—";

				var clr = document.createElement("button");
				clr.className = "clr";
				clr.textContent = "×";
				clr.title = "clear slot";
				clr.onclick = function () { clearSlot(slot); };

				row.append(play, i, role, val);
				if (id) { row.append(clr); }
				list.appendChild(row);
			})(n);
		}
	}

	function setTab(tab) {
		els.tabSamples.classList.toggle("active", tab === "samples");
		els.tabSlots.classList.toggle("active", tab === "slots");
		els.controls.style.visibility = tab === "samples" ? "visible" : "hidden";
		rerender.tab = tab;
		if (tab === "samples") { renderSamples(); } else { renderSlots(); }
	}

	/* ---------- boot ---------- */

	function build() {
		var aside = document.getElementById("library");
		if (!aside) { return; }
		aside.innerHTML =
			'<div id="libHead">' +
				'<h2>Library</h2>' +
				'<button class="libTab active" id="libTabSamples">Samples</button>' +
				'<button class="libTab" id="libTabSlots">Slots</button>' +
				'<span id="libTarget"></span>' +
				'<span id="libControls">' +
					'<select id="libPack"></select>' +
					'<input id="libSearch" type="search" placeholder="find #">' +
					'<button class="libFill" data-n="4">fill 4</button>' +
					'<button class="libFill" data-n="8">fill 8</button>' +
					'<button class="libFill" id="libSurprise">surprise</button>' +
				'</span>' +
			'</div>' +
			'<div id="libList" data-tab="samples"></div>';

		els.pack = document.getElementById("libPack");
		els.search = document.getElementById("libSearch");
		els.list = document.getElementById("libList");
		els.controls = document.getElementById("libControls");
		els.target = document.getElementById("libTarget");
		els.tabSamples = document.getElementById("libTabSamples");
		els.tabSlots = document.getElementById("libTabSlots");

		els.toast = document.createElement("div");
		els.toast.id = "libToast";
		document.body.appendChild(els.toast);

		MANIFEST.packs.forEach(function (p, i) {
			var o = document.createElement("option");
			o.value = i;
			o.textContent = p.name + "  (" + p.count + ")";
			els.pack.appendChild(o);
		});

		els.pack.onchange = renderSamples;
		els.search.oninput = renderSamples;
		els.tabSamples.onclick = function () { setTab("samples"); };
		els.tabSlots.onclick = function () { setTab("slots"); };
		aside.querySelectorAll(".libFill").forEach(function (b) {
			b.onclick = function () {
				if (b.id === "libSurprise") { fillSlots(8, true); }
				else { fillSlots(+b.dataset.n, false); }
			};
		});

		// keep the "loads into SOUND n" hint live as the user changes slot
		document.addEventListener("click", function () { setTimeout(refreshTarget, 0); }, true);
		document.addEventListener("keydown", function () { setTimeout(refreshTarget, 0); }, true);

		renderSamples();
		setTimeout(restoreSlots, 1200); // let po33.js finish building its nodes
	}

	function init() {
		fetch("samples.json")
			.then(function (r) { return r.json(); })
			.then(function (json) { MANIFEST = json; build(); })
			.catch(function () {
				var aside = document.getElementById("library");
				if (aside) {
					aside.innerHTML = '<div id="libHead"><h2>Library</h2></div>' +
						'<p style="padding:14px;font-size:13px;color:#888">Could not load samples.json &mdash; serve the folder over HTTP.</p>';
				}
			});
	}

	// API for js/studio.js (recorder)
	window.PO33Lib = {
		currentSlot: currentSlot,
		assign: function (slot, smp, quiet) { assign(slot, smp, quiet); },
		assignUrl: function (slot, url, id, seconds, quiet) {
			assign(slot, { id: id, url: url, seconds: seconds || null }, quiet);
		},
		addUserSample: function (id, url, seconds) { return addUserSample(id, url, seconds); },
		findSample: findSample,
		slotName: function (slot1to16) { return slotSampleIds[slot1to16 - 1] || null; },
		toast: toast
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else { init(); }
})();
