/* sw.js - service worker for the PO-33 PWA.
 * App shell is precached; wav / sample files are cached on first use so the
 * whole 500-file pack isn't downloaded up front.
 */
var VERSION = "po33-v9";
var SHELL = VERSION + "-shell";
var MEDIA = VERSION + "-media";

var SHELL_FILES = [
	"./",
	"./index.html",
	"./style.css",
	"./po33.css",
	"./replica.css",
	"./library.css",
	"./studio.css",
	"./mobile.css",
	"./js/jquery.min.js",
	"./js/jquery-ui.min.js",
	"./js/Tone.js",
	"./js/tone_sampler_extended.js",
	"./js/po33.js",
	"./js/boot.js",
	"./js/library.js",
	"./js/studio.js",
	"./js/projects.js",
	"./js/mobile.js",
	"./samples.json",
	"./manifest.webmanifest",
	"./icon.svg",
	"./icon-192.png",
	"./icon-512.png",
	"./TeenageEngineering3.svg",
	"./mic.svg"
];

self.addEventListener("install", function (e) {
	self.skipWaiting();
	e.waitUntil(caches.open(SHELL).then(function (c) {
		return Promise.allSettled(SHELL_FILES.map(function (u) { return c.add(u); }));
	}));
});

self.addEventListener("activate", function (e) {
	e.waitUntil(
		caches.keys().then(function (keys) {
			return Promise.all(keys.map(function (k) {
				if (k !== SHELL && k !== MEDIA) { return caches.delete(k); }
			}));
		}).then(function () { return self.clients.claim(); })
	);
});

self.addEventListener("fetch", function (e) {
	var req = e.request;
	if (req.method !== "GET") { return; }
	var url = new URL(req.url);
	if (url.origin !== location.origin) { return; }

	var isMedia = /\.(wav|mp3|ogg|webm)$/i.test(url.pathname) ||
		url.pathname.indexOf("/samples/") !== -1 || url.pathname.indexOf("/wav/") !== -1;

	if (isMedia) {
		// cache-first, then network, store a copy
		e.respondWith(
			caches.match(req).then(function (hit) {
				return hit || fetch(req).then(function (res) {
					var copy = res.clone();
					caches.open(MEDIA).then(function (c) { c.put(req, copy); });
					return res;
				});
			})
		);
		return;
	}

	// shell: stale-while-revalidate
	e.respondWith(
		caches.match(req).then(function (hit) {
			var net = fetch(req).then(function (res) {
				var copy = res.clone();
				caches.open(SHELL).then(function (c) { c.put(req, copy); });
				return res;
			}).catch(function () { return hit; });
			return hit || net;
		})
	);
});
