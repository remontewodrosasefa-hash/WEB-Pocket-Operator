// boot.js - power-on overlay + web-audio unlock.
// Modern browsers (incl. Safari/Chrome on macOS) start the AudioContext
// suspended until a user gesture. This unlocks it once, up front.
(function () {
	var APP_VERSION = "21";   // keep in sync with sw.js VERSION (po33-v<n>)

	// small always-on version chip at the very top; doubles as the update button
	function versionTag() {
		if (document.getElementById("versionTag")) { return document.getElementById("versionTag"); }
		var t = document.createElement("div");
		t.id = "versionTag";
		t.textContent = "v" + APP_VERSION;
		t.title = "app version";
		document.body.appendChild(t);
		return t;
	}
	function markUpdate(worker) {
		var t = versionTag();
		if (!worker || t.dataset.upd) { return; }
		t.dataset.upd = "1";
		t.classList.add("hasUpdate");
		t.textContent = "v" + APP_VERSION + "  ·  update ready ↻";
		t.onclick = function () { t.textContent = "updating…"; worker.postMessage("skipWaiting"); };
	}

	function unlockAudio() {
		try {
			if (window.Tone) {
				if (typeof Tone.start === "function") { Tone.start(); }
				var ctx = Tone.context && (Tone.context._context || Tone.context);
				if (ctx && typeof ctx.resume === "function") { ctx.resume(); }
			}
		} catch (e) { /* ignore */ }
		try { if (typeof allowSound === "function") { allowSound(); } } catch (e) { /* ignore */ }
	}

	function ready() {
		var overlay = document.getElementById("powerOverlay");
		var btn = document.getElementById("powerBtn");
		if (!overlay || !btn) { return; }

		btn.addEventListener("click", function () {
			unlockAudio();
			overlay.classList.add("hidden");
		});

		// Safety net: any first click/keypress on the page also unlocks audio.
		function once() {
			unlockAudio();
			document.removeEventListener("pointerdown", once, true);
			document.removeEventListener("keydown", once, true);
		}
		document.addEventListener("pointerdown", once, true);
		document.addEventListener("keydown", once, true);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ready);
	} else {
		ready();
	}

	// register the service worker (PWA / offline). Needs a secure context
	// (https:// or localhost) — silently skipped otherwise.
	window.addEventListener("load", versionTag);

	if ("serviceWorker" in navigator && window.isSecureContext) {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("sw.js").then(function (reg) {
				if (reg.waiting) { markUpdate(reg.waiting); }
				reg.addEventListener("updatefound", function () {
					var nw = reg.installing;
					if (!nw) { return; }
					nw.addEventListener("statechange", function () {
						if (nw.state === "installed" && navigator.serviceWorker.controller) { markUpdate(nw); }
					});
				});
				// check for an update whenever the app regains focus
				window.addEventListener("focus", function () { reg.update().catch(function () {}); });
			}).catch(function () { /* ignore */ });

			var reloading = false;
			navigator.serviceWorker.addEventListener("controllerchange", function () {
				if (reloading) { return; }
				reloading = true;
				location.reload();
			});
		});
	}
})();
