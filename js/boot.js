// boot.js - power-on overlay + web-audio unlock.
// Modern browsers (incl. Safari/Chrome on macOS) start the AudioContext
// suspended until a user gesture. This unlocks it once, up front.
(function () {
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
	if ("serviceWorker" in navigator && window.isSecureContext) {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("sw.js").then(function (reg) {
				// a new version is waiting -> offer a one-tap refresh
				function offer(worker) {
					if (!worker) { return; }
					var bar = document.createElement("div");
					bar.id = "updateBar";
					bar.innerHTML = "new version ready \u00b7 <button type=\"button\">refresh</button>";
					bar.querySelector("button").addEventListener("click", function () {
						worker.postMessage("skipWaiting");
					});
					document.body.appendChild(bar);
				}
				if (reg.waiting) { offer(reg.waiting); }
				reg.addEventListener("updatefound", function () {
					var nw = reg.installing;
					if (!nw) { return; }
					nw.addEventListener("statechange", function () {
						if (nw.state === "installed" && navigator.serviceWorker.controller) { offer(nw); }
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
