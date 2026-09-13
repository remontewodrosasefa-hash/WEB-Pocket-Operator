/* chopstore.js — chopped and sliced audio survives a reload.
 *
 * THE BUG THIS FIXES
 * Recordings were already persisted (studio.js writes them to IndexedDB as
 * blobs and re-adds them to the library on boot). Chops were not. A chop
 * builds brand-new AudioBuffers in memory and pushes them straight onto a
 * drum slot's 16 pads — nothing on disk, no library entry, no URL. So the
 * pattern data survived a reload and the audio it referenced did not: your
 * steps came back pointing at pads that were now silent.
 *
 * This stores every chopped pad as a WAV blob in the same IndexedDB the
 * recordings use, and puts them back on their pads at startup.
 *
 * Exposes window.PO33.chops
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var DB = "po33", STORE = "chop";
	// which slots currently hold chopped/synthesised audio, so other modules
	// (BUILD especially) know not to write over your own material
	var chopped = {};

	function idb() {
		return new Promise(function (res, rej) {
			if (!window.indexedDB) { rej(); return; }
			// version 2: the recordings store was version 1, so opening higher
			// runs onupgradeneeded and adds ours alongside it without touching it
			var r = indexedDB.open(DB, 2);
			r.onupgradeneeded = function () {
				var d = r.result;
				if (!d.objectStoreNames.contains("rec")) { d.createObjectStore("rec"); }
				if (!d.objectStoreNames.contains(STORE)) { d.createObjectStore(STORE); }
			};
			r.onsuccess = function () { res(r.result); };
			r.onerror = function () { rej(r.error); };
		});
	}

	/* ---------- WAV encoding (16-bit PCM) ---------- */

	function encodeWav(buf) {
		var numCh = Math.min(2, buf.numberOfChannels);
		var len = buf.length, rate = buf.sampleRate;
		var out = new DataView(new ArrayBuffer(44 + len * numCh * 2));
		var p = 0;
		function str(s) { for (var i = 0; i < s.length; i++) { out.setUint8(p++, s.charCodeAt(i)); } }
		function u32(v) { out.setUint32(p, v, true); p += 4; }
		function u16(v) { out.setUint16(p, v, true); p += 2; }
		str("RIFF"); u32(36 + len * numCh * 2); str("WAVE");
		str("fmt "); u32(16); u16(1); u16(numCh); u32(rate);
		u32(rate * numCh * 2); u16(numCh * 2); u16(16);
		str("data"); u32(len * numCh * 2);
		var chans = [];
		for (var c = 0; c < numCh; c++) { chans.push(buf.getChannelData(c)); }
		for (var i = 0; i < len; i++) {
			for (var c2 = 0; c2 < numCh; c2++) {
				var v = Math.max(-1, Math.min(1, chans[c2][i]));
				out.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
				p += 2;
			}
		}
		return new Blob([out], { type: "audio/wav" });
	}

	function rawCtx() {
		try { return Tone.context._context || Tone.context; } catch (e) { return null; }
	}

	/* ---------- save ---------- */

	// Called once per chop with the whole set, so one transaction covers the
	// lot instead of sixteen racing writes.
	function saveSlot(slot, buffers) {
		chopped[slot] = true;
		if (!window.indexedDB || !buffers || !buffers.length) { return; }
		var blobs = [];
		try {
			for (var i = 0; i < buffers.length; i++) {
				blobs.push(buffers[i] ? encodeWav(buffers[i]) : null);
			}
		} catch (e) { return; }

		idb().then(function (db) {
			var tx = db.transaction(STORE, "readwrite");
			var st = tx.objectStore(STORE);
			st.put({ t: Date.now(), pads: blobs }, "slot" + slot);
		}).catch(function () {});
	}

	function clearSlot(slot) {
		delete chopped[slot];
		if (!window.indexedDB) { return; }
		idb().then(function (db) {
			db.transaction(STORE, "readwrite").objectStore(STORE).delete("slot" + slot);
		}).catch(function () {});
	}

	function clearAll() {
		chopped = {};
		if (!window.indexedDB) { return; }
		idb().then(function (db) {
			db.transaction(STORE, "readwrite").objectStore(STORE).clear();
		}).catch(function () {});
	}

	/* ---------- restore ---------- */

	function blobToBuffer(blob) {
		return blob.arrayBuffer().then(function (ab) {
			var ctx = rawCtx();
			if (!ctx) { return null; }
			return new Promise(function (res) {
				ctx.decodeAudioData(ab, function (b) { res(b); }, function () { res(null); });
			});
		});
	}

	function restore() {
		if (!window.indexedDB) { return Promise.resolve(0); }
		return idb().then(function (db) {
			return new Promise(function (res) {
				var tx = db.transaction(STORE, "readonly");
				var st = tx.objectStore(STORE);
				var keys = st.getAllKeys(), vals = st.getAll();
				keys.onsuccess = function () {
					vals.onsuccess = function () {
						var jobs = [];
						keys.result.forEach(function (key, i) {
							var rec = vals.result[i];
							if (!rec || !rec.pads) { return; }
							var slot = parseInt(String(key).replace("slot", ""), 10);
							if (!(slot >= 9 && slot <= 16)) { return; }
							chopped[slot] = true;
							jobs.push(applySlot(slot, rec.pads));
						});
						Promise.all(jobs).then(function (r) { res(r.length); });
					};
					vals.onerror = function () { res(0); };
				};
				keys.onerror = function () { res(0); };
			});
		}).catch(function () { return 0; });
	}

	function applySlot(slot, padBlobs) {
		var di = slot - 9;
		// slice.js owns creating an empty Players for a slot that has none yet
		try {
			if (!window.drumArr[di] && window.PO33.slice && PO33.slice.ensureSlot) {
				PO33.slice.ensureSlot(di);
			}
		} catch (e) {}
		if (!window.drumArr || !window.drumArr[di]) { return Promise.resolve(false); }

		var jobs = padBlobs.map(function (blob, pad) {
			if (!blob || pad > 15) { return Promise.resolve(); }
			return blobToBuffer(blob).then(function (audio) {
				if (!audio) { return; }
				try {
					window.drumArr[di].add(window.noteArray[pad], audio);
					window.drumArr[di].get(window.noteArray[pad]).playbackRate = 1;
				} catch (e) {}
			}).catch(function () {});
		});
		return Promise.all(jobs).then(function () { return true; });
	}

	window.PO33.chops = {
		isChopped: function (slot) { return !!chopped[slot]; },
		choppedSlots: function () { return Object.keys(chopped).map(Number); },
		saveSlot: saveSlot,
		clearSlot: clearSlot,
		clearAll: clearAll,
		restore: restore
	};

	// Put the chops back only AFTER the library has restored and filled its
	// slots, so nothing can dispose a Players we just wrote into. If the
	// library isn't present (it always is), fall back to the old timer.
	function boot() {
		var lib = window.PO33Lib;
		if (lib && lib.ready) { lib.ready().then(function () { restore(); }); }
		else { setTimeout(function () { restore(); }, 1400); }
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
