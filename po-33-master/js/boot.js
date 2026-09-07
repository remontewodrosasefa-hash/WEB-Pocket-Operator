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
			navigator.serviceWorker.register("sw.js").catch(function () { /* ignore */ });
		});
	}
})();
