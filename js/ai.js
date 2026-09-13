/* ai.js — the optional AI assistant.
 *
 * ============================ THE HONEST PART ============================
 * The unlock (name + code) HIDES this feature. It does not secure it. This
 * is a static site: every byte of this file is readable with View Source,
 * so the name and the code are readable too, and anyone who wants past the
 * gate can walk past it. That is fine — hiding is what was actually asked
 * for, and the thing worth protecting is not the feature, it is the bill.
 *
 * The bill is protected by BRING YOUR OWN KEY. There is no shared API key
 * anywhere in this repo, because a key shipped to the browser is a key
 * published to the world and drained by strangers within days. Each person
 * pastes their own, it lives in their own localStorage, and it is sent to
 * exactly one place: their provider. You are never billed for anyone else.
 *
 * If this ever needs real gating — accounts, revocation, a key you own and
 * meter — that requires a server (a Cloudflare Worker or Vercel function
 * proxying the call and holding the key). That is a deploy target this
 * project does not have yet, and nothing in the browser substitutes for it.
 * =========================================================================
 *
 * DESIGN RULE, and the reason this is useful at all:
 *
 *     Local code MEASURES. The model TALKS.
 *
 * We never send audio. The browser already holds the pattern arrays, the
 * tempo, the swing, the scale and the slot map, and it can count and
 * measure them exactly, instantly and for free. So we send the model the
 * NUMBERS and ask for judgement about them. Asking a language model to
 * hear a WAV and guess the tempo is slower, costs money, and is worse than
 * the arithmetic we can already do.
 *
 * Exposes window.PO33.ai
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	var K_UNLOCK = "po33.ai.unlocked";
	var K_KEY    = "po33.ai.key";
	var K_PROV   = "po33.ai.provider";
	var K_MODEL  = "po33.ai.model";

	/* The gate. Change these to whatever you like — and read the header
	 * above before assuming they protect anything. */
	var GATE_NAME = "remon";
	var GATE_CODE = "ko33";

	var PROVIDERS = {
		claude: {
			label: "Claude",
			models: [
				["claude-sonnet-5", "Sonnet 5 · fast, cheap"],
				["claude-opus-5", "Opus 5 · strongest"],
				["claude-haiku-4-5-20251001", "Haiku 4.5 · cheapest"]
			],
			keyHint: "sk-ant-...",
			signup: "console.anthropic.com",
			send: function (key, model, system, messages) {
				return fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-api-key": key,
						"anthropic-version": "2023-06-01",
						// without this the browser call is refused by CORS
						"anthropic-dangerous-direct-browser-access": "true"
					},
					body: JSON.stringify({
						model: model, max_tokens: 900, system: system,
						messages: messages.map(function (m) {
							return { role: m.role, content: m.text };
						})
					})
				}).then(readJson).then(function (j) {
					if (j.error) { throw new Error(j.error.message || "api error"); }
					return (j.content || []).map(function (c) { return c.text || ""; }).join("").trim();
				});
			}
		},
		gemini: {
			label: "Gemini",
			models: [
				["gemini-2.0-flash", "2.0 Flash · fast, cheap"],
				["gemini-2.5-pro", "2.5 Pro · strongest"]
			],
			keyHint: "AIza...",
			signup: "aistudio.google.com",
			send: function (key, model, system, messages) {
				return fetch("https://generativelanguage.googleapis.com/v1beta/models/" +
						encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						systemInstruction: { parts: [{ text: system }] },
						contents: messages.map(function (m) {
							return { role: m.role === "assistant" ? "model" : "user",
								parts: [{ text: m.text }] };
						}),
						generationConfig: { maxOutputTokens: 900 }
					})
				}).then(readJson).then(function (j) {
					if (j.error) { throw new Error(j.error.message || "api error"); }
					var c = (j.candidates || [])[0];
					if (!c) { throw new Error("no answer came back"); }
					return (c.content.parts || []).map(function (p) { return p.text || ""; }).join("").trim();
				});
			}
		}
	};

	function readJson(r) {
		return r.text().then(function (t) {
			var j;
			try { j = JSON.parse(t); } catch (e) { j = null; }
			if (!r.ok) {
				var msg = (j && j.error && (j.error.message || j.error.status)) || ("HTTP " + r.status);
				if (r.status === 401 || r.status === 403) { msg = "that key was rejected"; }
				if (r.status === 429) { msg = "rate limited — wait a moment"; }
				throw new Error(msg);
			}
			return j || {};
		});
	}

	/* ---------------- stored settings ---------------- */
	function ls(k, v) {
		try {
			if (v === undefined) { return localStorage.getItem(k); }
			if (v === null) { localStorage.removeItem(k); return null; }
			localStorage.setItem(k, v); return v;
		} catch (e) { return null; }
	}
	function unlocked() { return ls(K_UNLOCK) === "1"; }
	function provider() { return PROVIDERS[ls(K_PROV) || "claude"] ? (ls(K_PROV) || "claude") : "claude"; }
	function model() {
		var p = PROVIDERS[provider()];
		var m = ls(K_MODEL);
		var ok = p.models.some(function (x) { return x[0] === m; });
		return ok ? m : p.models[0][0];
	}
	function hasKey() { return !!(ls(K_KEY) || "").trim(); }

	/* =================================================================
	 * CONTEXT — what the model is told. All of it measured here.
	 * ================================================================= */

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }

	// one channel's steps in the current pattern, as "1 5 9 13"
	function stepsOf(ch, pat) {
		var arr = window.newChannelArr;
		if (!arr || !arr[ch] || !arr[ch][pat]) { return []; }
		var out = [], s = arr[ch][pat];
		for (var i = 0; i < s.length; i++) { if (s[i] && s[i].noteOn) { out.push(i + 1); } }
		return out;
	}

	/* A compact, factual description of what is actually in the machine.
	 * Everything here is counted, not guessed. */
	function describeBeat() {
		var pat = g("currentPattern", 0);
		var lines = [];
		lines.push("TEMPO " + Math.round(g("tempo", 120)) + " BPM, swing " +
			Math.round(g("swing", 0)) + "%, pattern " + (pat + 1) + " of 16.");
		var bar = 240 / Math.max(1, g("tempo", 120));
		lines.push("One bar = 16 steps = " + bar.toFixed(2) + "s, so one step = " +
			(bar / 16).toFixed(3) + "s.");

		try {
			if (window.PO33.scale && PO33.scale.name) { lines.push("Scale: " + PO33.scale.name() + "."); }
		} catch (e) {}

		var any = false, i, st, name, chopped;
		for (i = 0; i < 16; i++) {
			st = stepsOf(i, pat);
			if (!st.length) { continue; }
			any = true;
			name = null;
			try { name = window.PO33Lib ? PO33Lib.slotName(i + 1) : null; } catch (e) {}
			chopped = false;
			try { chopped = !!(window.PO33.chops && PO33.chops.isChopped(i + 1)); } catch (e) {}
			lines.push("slot " + (i + 1) + " (" + (i < 8 ? "melodic" : "drum") +
				(chopped ? ", chopped" : "") + (name ? ", sample " + name : "") +
				") hits on steps: " + st.join(" ") + "  [" + st.length + " hits]");
		}
		if (!any) { lines.push("The current pattern is EMPTY — no slot has any steps."); }

		try {
			var ki = PO33.keys.info();
			if (ki && ki.steps) { lines.push("keyboard lane: " + ki.steps + " steps recorded."); }
		} catch (e) {}
		try {
			var fi = PO33.fxRec.info();
			if (fi && fi.steps) { lines.push("fx lane: " + fi.steps + " steps recorded."); }
		} catch (e) {}

		var chain = g("patternChain", [0]);
		lines.push("chain: " + chain.map(function (n) { return n + 1; }).join(" ") +
			" (" + chain.length + " bar" + (chain.length === 1 ? "" : "s") + ").");
		return lines.join("\n");
	}

	// the manual, flattened, so guide questions are answered from the real text
	function guideText() {
		var G = window.PO33Guide;
		if (!G) { return "(guide unavailable)"; }
		return G.sections.map(function (s) {
			return "## " + s.n + " " + strip(s.t) + "\n" + strip(s.b);
		}).join("\n\n");
	}
	function strip(html) {
		var d = document.createElement("div");
		d.innerHTML = html;
		return (d.textContent || "").replace(/\s+/g, " ").trim();
	}

	var SYSTEM_BASE =
		"You are the built-in assistant for a browser recreation of a 16-pad pocket sampler " +
		"(the PO-33 style workflow): 16 slots, slots 1-8 melodic (one sample at 16 pitches), " +
		"slots 9-16 drum (16 separate pads). Patterns are 16 steps. A bar is 240/BPM seconds.\n\n" +
		"RULES:\n" +
		"- You cannot hear anything. You are given measured numbers about the user's pattern. " +
		"Reason from those numbers; never claim to have listened.\n" +
		"- Be concrete. Name steps by number, slots by number. 'kick on 1, 7, 11' beats 'add some drums'.\n" +
		"- Be short. A few sentences or a short list. This is read on a phone between takes.\n" +
		"- If the user asks how to do something, answer from the MANUAL section when one covers it.\n" +
		"- Never invent controls that do not exist in the manual.";

	/* =================================================================
	 * panel
	 * ================================================================= */

	var view = null, open = false, chat = [], busy = false;

	function esc(s) {
		return String(s).replace(/[&<>"]/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
		});
	}

	function html() {
		var p = PROVIDERS[provider()];
		var h = '<div class="uvHead"><span>ASSISTANT</span>' +
			'<button type="button" data-ai="close">&times;</button></div>' +
			'<div id="aiBody">';

		if (!unlocked()) {
			h += '<div class="uvSec"><h4>locked</h4>' +
				'<div class="aiNote">Enter the name and code to turn the assistant on.</div>' +
				'<div class="uvRow">' +
					'<input id="aiName" type="text" placeholder="name" autocomplete="off">' +
					'<input id="aiCode" type="password" placeholder="code" autocomplete="off">' +
					'<button type="button" data-ai="unlock">unlock</button>' +
				'</div>' +
				'<div id="aiMsg" class="aiNote"></div></div>';
			return h + "</div>";
		}

		if (!hasKey()) {
			h += '<div class="uvSec"><h4>your API key</h4>' +
				'<div class="aiNote">The key stays in this browser and is sent only to ' +
					esc(p.label) + '. Nothing is billed to anyone else. Get one at <b>' +
					esc(p.signup) + '</b>.</div>' +
				'<div class="uvRow">' +
					'<select id="aiProv">' + Object.keys(PROVIDERS).map(function (k) {
						return '<option value="' + k + '"' + (k === provider() ? " selected" : "") +
							">" + PROVIDERS[k].label + "</option>";
					}).join("") + '</select>' +
					'<input id="aiKey" type="password" placeholder="' + esc(p.keyHint) + '" autocomplete="off">' +
					'<button type="button" data-ai="savekey">save</button>' +
				'</div>' +
				'<div id="aiMsg" class="aiNote"></div></div>';
			return h + "</div>";
		}

		h += '<div class="uvSec"><h4>ask</h4>' +
			'<div class="aiQuick">' +
				'<button type="button" data-ai="q" data-q="read">read my beat</button>' +
				'<button type="button" data-ai="q" data-q="missing">what is missing?</button>' +
				'<button type="button" data-ai="q" data-q="next">what should I try next?</button>' +
			'</div>' +
			'<div id="aiLog">' + renderChat() + '</div>' +
			'<div class="uvRow aiAsk">' +
				'<input id="aiInput" type="text" placeholder="ask anything about the app or your beat" autocomplete="off">' +
				'<button type="button" data-ai="send"' + (busy ? " disabled" : "") + '>' +
					(busy ? "…" : "send") + '</button>' +
			'</div>' +
			'<div id="aiMsg" class="aiNote"></div></div>' +

			'<div class="uvSec"><h4>settings</h4><div class="uvRow">' +
				'<select id="aiModel">' + p.models.map(function (m) {
					return '<option value="' + m[0] + '"' + (m[0] === model() ? " selected" : "") +
						">" + esc(m[1]) + "</option>";
				}).join("") + '</select>' +
				'<button type="button" data-ai="forget">forget key</button>' +
				'<button type="button" data-ai="clear">clear chat</button>' +
			'</div></div>';

		return h + "</div>";
	}

	function renderChat() {
		if (!chat.length) {
			return '<div class="aiNote">It cannot hear your audio. It reads the pattern ' +
				'you have written — the steps, tempo, swing and which slots are loaded — ' +
				'and the manual. Ask it about either.</div>';
		}
		return chat.map(function (m) {
			return '<div class="aiMsg ' + m.role + '"><b>' +
				(m.role === "user" ? "you" : "assistant") + '</b>' +
				esc(m.text).replace(/\n/g, "<br>") + "</div>";
		}).join("");
	}

	function paint() {
		if (!view) { return; }
		var log = view.querySelector("#aiLog");
		var atBottom = !log || (log.scrollHeight - log.scrollTop - log.clientHeight < 40);
		view.innerHTML = html();
		log = view.querySelector("#aiLog");
		if (log && atBottom) { log.scrollTop = log.scrollHeight; }
	}

	function note(msg) {
		var el = view && view.querySelector("#aiMsg");
		if (el) { el.textContent = msg || ""; }
	}

	var QUICK = {
		read: "Describe what I have written, in plain language. Say what is working and what is not.",
		missing: "Which of drums, bass and melody is missing or weak here? Name the slot and the exact steps to add.",
		next: "Give me one concrete thing to try next, with the exact steps to press."
	};

	function ask(text) {
		if (busy || !text) { return; }
		busy = true;
		chat.push({ role: "user", text: text });
		paint();
		note("thinking…");

		var p = PROVIDERS[provider()];
		var system = SYSTEM_BASE +
			"\n\n=== THE USER'S CURRENT PATTERN (measured, not heard) ===\n" + describeBeat() +
			"\n\n=== THE MANUAL ===\n" + guideText();

		p.send((ls(K_KEY) || "").trim(), model(), system, chat.slice(-10))
			.then(function (answer) {
				chat.push({ role: "assistant", text: answer || "(empty answer)" });
				busy = false; paint(); note("");
			})
			.catch(function (e) {
				busy = false;
				chat.pop();               // drop the question that got no answer
				paint();
				note(e && e.message ? e.message : "that did not go through");
			});
	}

	function act(what, el) {
		if (what === "close") { hide(); return; }

		if (what === "unlock") {
			var n = (view.querySelector("#aiName") || {}).value || "";
			var c = (view.querySelector("#aiCode") || {}).value || "";
			if (n.trim().toLowerCase() === GATE_NAME && c.trim() === GATE_CODE) {
				ls(K_UNLOCK, "1"); paint(); note("unlocked");
			} else { note("that is not it"); }
			return;
		}
		if (what === "savekey") {
			var prov = (view.querySelector("#aiProv") || {}).value;
			if (prov && PROVIDERS[prov]) { ls(K_PROV, prov); ls(K_MODEL, null); }
			var k = ((view.querySelector("#aiKey") || {}).value || "").trim();
			if (!k) { note("paste a key first"); return; }
			ls(K_KEY, k); paint(); note("saved in this browser only");
			return;
		}
		if (what === "forget") { ls(K_KEY, null); chat = []; paint(); note("key removed"); return; }
		if (what === "clear") { chat = []; paint(); return; }
		if (what === "send") {
			var inp = view.querySelector("#aiInput");
			var t = (inp && inp.value || "").trim();
			if (inp) { inp.value = ""; }
			ask(t);
			return;
		}
		if (what === "q") { ask(QUICK[el.getAttribute("data-q")] || ""); return; }
	}

	function build() {
		var hud = document.getElementById("lcdHud");
		if (!hud || view) { return !!hud; }
		view = document.createElement("div");
		view.id = "aiView";
		view.innerHTML = html();
		hud.appendChild(view);

		view.addEventListener("click", function (e) {
			var t = e.target.closest("[data-ai]");
			if (!t || t.disabled) { return; }
			e.stopPropagation();
			act(t.getAttribute("data-ai"), t);
		});
		// enter sends, in both the ask box and the unlock fields
		view.addEventListener("keydown", function (e) {
			if (e.key !== "Enter") { return; }
			var id = e.target && e.target.id;
			if (id === "aiInput") { e.preventDefault(); act("send"); }
			else if (id === "aiName" || id === "aiCode") { e.preventDefault(); act("unlock"); }
			else if (id === "aiKey") { e.preventDefault(); act("savekey"); }
		});
		view.addEventListener("change", function (e) {
			if (e.target && e.target.id === "aiModel") { ls(K_MODEL, e.target.value); }
			if (e.target && e.target.id === "aiProv") { ls(K_PROV, e.target.value); ls(K_MODEL, null); paint(); }
		});
		return true;
	}

	function show() { build(); open = true; document.body.classList.add("aiOpen"); paint(); }
	function hide() { open = false; document.body.classList.remove("aiOpen"); }
	function toggle() { if (open) { hide(); } else { show(); } }

	window.PO33.ai = {
		show: show, hide: hide, toggle: toggle,
		unlocked: unlocked,
		describeBeat: describeBeat,          // exported so it can be tested without a key
		lock: function () { ls(K_UNLOCK, null); ls(K_KEY, null); chat = []; paint(); }
	};

	function boot() {
		var tries = 0;
		var iv = setInterval(function () {
			if (build() || ++tries > 100) { clearInterval(iv); }
		}, 150);
	}
	if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
	else { boot(); }
})();
