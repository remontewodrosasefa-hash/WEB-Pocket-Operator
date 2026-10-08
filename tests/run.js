/* tests/run.js — integration tests that drive the real app in headless Chrome.
 *
 *   npm test            (from the project root)
 *   node tests/run.js   (from anywhere)
 *
 * Each test gets its own browser context, so storage (localStorage,
 * IndexedDB) is isolated per test. Tests that need to prove something
 * survives a reload call page.reload() inside their context.
 *
 * Nothing here mocks the engine. Taps go through Chrome's real touch input,
 * and audio assertions read the actual AudioBuffers Tone.js is holding.
 */
"use strict";

const puppeteer = require("puppeteer-core");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const PORT = 5199;
const URL = "http://localhost:" + PORT + "/index.html";
const CHROME = process.env.CHROME ||
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Fail extends Error {}
function assert(cond, msg) { if (!cond) throw new Fail(msg); }
function eq(a, b, msg) {
	if (a !== b) throw new Fail((msg || "expected equal") + " — got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b));
}

async function startServer() {
	const proc = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
	for (let i = 0; i < 40; i++) {
		await sleep(150);
		const ok = await new Promise(res => {
			http.get(URL, r => { r.resume(); res(r.statusCode === 200); }).on("error", () => res(false));
		});
		if (ok) return proc;
	}
	proc.kill();
	throw new Error("server did not start on " + PORT);
}

/* open the app in a fresh context and power it on */
async function boot(browser, opts) {
	opts = opts || {};
	const ctx = await browser.createBrowserContext();
	const page = await ctx.newPage();
	page.__errors = [];
	page.on("pageerror", e => page.__errors.push("pageerror: " + e.message));
	page.on("console", m => { if (m.type() === "error") page.__errors.push("console: " + m.text()); });
	page.on("dialog", async d => { try { await d.accept(); } catch (e) {} });
	await page.setViewport({ width: 412, height: 874, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
	await page.goto(URL, { waitUntil: "networkidle2", timeout: 40000 });
	await powerOn(page, opts.settle);
	page.__ctx = ctx;
	return page;
}

async function powerOn(page, settle) {
	await sleep(800);
	await page.evaluate(() => {
		const b = [...document.querySelectorAll("button")].find(x => /power on/i.test(x.textContent));
		if (b) b.click();
	});
	// default: wait past every boot timer (restoreSlots 1200, chopstore 1400,
	// fillDefaults 1500) so tests start from a fully settled engine
	await sleep(settle == null ? 2600 : settle);
}

async function reload(page, settle) {
	await page.reload({ waitUntil: "networkidle2" });
	await powerOn(page, settle);
}

/* Tap the element handle. Deliberately the simple version.
 *
 * Twice now this has been "improved" and both attempts were worse, so the
 * findings are recorded here rather than relearned:
 *
 *  - Retrying on "Node is detached from document" DOUBLE-TAPS. The node
 *    usually detaches BECAUSE the tap landed and triggered a re-render, so
 *    the retry sends a second tap. On a sequencer step that is on-then-off
 *    and the test sees the step it just placed as empty.
 *
 *  - Measuring boundingBox() and tapping the point instead fails on the MIX
 *    chain editor, which rebuilds and relays out its buttons between the
 *    measurement and the dispatch, so the tap lands on whatever moved into
 *    that spot. It failed six runs out of six.
 *
 * elementHandle.tap() scrolls the element into view and taps it in one go,
 * which is the closest thing to atomic that is available here. The rare
 * detached-node error is a genuinely rare race and is better than either
 * cure.
 */
async function tap(page, sel) {
	const el = await page.$(sel);
	assert(el, "no element " + sel);
	await el.tap();
	await sleep(250);
}

const ev = (page, fn, ...args) => page.evaluate(fn, ...args);

/* a synthetic buffer whose 16 sixteenths each carry a distinct DC level, so
 * after a chop every pad can be identified by reading one sample */
const MAKE_SIGNATURE_BUFFER = () => {
	const ctx = Tone.context._context || Tone.context;
	const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 4, sr), d = buf.getChannelData(0);
	for (let i = 0; i < d.length; i++) d[i] = (Math.floor(i / (d.length / 16)) + 1) * 0.02;
	return buf;
};
// read the signature back off a drum slot's pads (sample 2000: well past the ~2ms de-click fade)
const READ_PADS = (di) => {
	const out = [];
	for (let pad = 0; pad < 16; pad++) {
		try {
			const pl = drumArr[di].get(noteArray[pad]);
			const b = pl && pl.buffer && (pl.buffer.get ? pl.buffer.get() : pl.buffer._buffer);
			out.push(b ? +b.getChannelData(0)[2000].toFixed(3) : null);
		} catch (e) { out.push("ERR"); }
	}
	return out;
};
const isSignature = pads => pads.length === 16 && pads.every((v, i) => typeof v === "number" && Math.abs(v - (i + 1) * 0.02) < 0.004);

/* ------------------------------------------------------------------ */
/* the tests                                                           */
/* ------------------------------------------------------------------ */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- core flows ---------- */

test("boot: engine up, no errors, all modules present", async b => {
	const p = await boot(b);
	const mods = await ev(p, () => ["session", "undo", "projects", "slice", "chops", "keys", "fxRec", "build", "scene", "escape", "trim", "util", "hold", "rec", "listen"]
		.filter(k => !window.PO33[k]));
	eq(mods.length, 0, "missing PO33 modules: " + mods.join(","));
	assert(await ev(p, () => Array.isArray(newChannelArr) && newChannelArr.length === 16), "newChannelArr");
	eq(p.__errors.length, 0, "errors on boot: " + p.__errors.slice(0, 3).join(" | "));
});

test("write: WRITE + pad taps place and remove steps", async b => {
	const p = await boot(b);
	await ev(p, () => { PO33.clearPattern(); window.selectedChannel = 0; });
	await tap(p, "#btnWrite");
	await tap(p, "#btn3"); await tap(p, "#btn7");
	let on = await ev(p, () => [3, 7].map(s => newChannelArr[0][currentPattern][s - 1].noteOn));
	eq(on.join(), "1,1", "steps 3 and 7 should be on");
	await tap(p, "#btn3");
	on = await ev(p, () => newChannelArr[0][currentPattern][2].noteOn);
	eq(on, 0, "tapping a lit step removes it");
	await tap(p, "#btnWrite");
});

test("play: transport runs and the playhead advances", async b => {
	const p = await boot(b);
	await tap(p, "#btnPlay");
	await sleep(900);
	const st = await ev(p, () => ({ t: Tone.Transport.state, play: window.play, beat: window.beatCount }));
	eq(st.t, "started"); assert(st.play, "play flag");
	await tap(p, "#btnPlay");
	eq(await ev(p, () => Tone.Transport.state), "stopped");
});

test("chain: MIX editor add / move / remove, undo one link at a time", async b => {
	const p = await boot(b);
	await ev(p, () => { window.patternChain = [0]; document.querySelector('[data-perf="mute"]').click(); });
	await sleep(300);
	const chain = () => ev(p, () => patternChain.map(n => n + 1).join(" "));
	await tap(p, '[data-chainadd="1"]'); await tap(p, '[data-chainadd="2"]');
	eq(await chain(), "1 2 3", "append");
	await tap(p, '[data-chainsel="2"]'); await tap(p, '[data-chainmove="-1"]');
	eq(await chain(), "1 3 2", "move earlier");
	await tap(p, '[data-chaindup="1"]');
	eq(await chain(), "1 3 3 2", "duplicate");
	await ev(p, () => PO33.undo.undo());
	eq(await chain(), "1 3 2", "undo removes one edit");
});

test("live: LIVE starts the transport and arms recording", async b => {
	const p = await boot(b);
	await tap(p, "#btnLive"); await sleep(500);
	const st = await ev(p, () => ({ play: window.play, mode: window.mode }));
	assert(st.play, "LIVE should start playback"); eq(st.mode, 11, "mode 11 = live rec");
});

test("bpm: tap cycles presets; latched BPM slider sets tempo; BPM + pad sets volume", async b => {
	const p = await boot(b);
	const t0 = await ev(p, () => window.tempo);
	await tap(p, "#btnBPM");
	const t1 = await ev(p, () => ({ tempo: window.tempo, state: window.state }));
	assert(t1.tempo !== t0 && [80, 120, 140].includes(t1.tempo), "a tap cycles the preset, got " + t1.tempo);
	eq(t1.state, 0, "a tap does not open BPM mode");
	await ev(p, () => window.tempoButtonFunction());           // keyboard 7 / latched BPM
	await ev(p, () => { const s = document.getElementById("slider2"); s.value = 800; s.dispatchEvent(new Event("input", { bubbles: true })); });
	await sleep(200);
	const tempo = await ev(p, () => window.tempo);
	assert(tempo > 150, "tempo should follow slider, got " + tempo);
	await tap(p, "#btn16");
	const v = await ev(p, () => ({ volume: window.volume, slider: +document.getElementById("sliderVol").value }));
	eq(v.volume, 15, "BPM + pad 16 = full volume"); eq(v.slider, 100, "master slider follows");
	await tap(p, "#btn8");
	eq(await ev(p, () => +document.getElementById("sliderVol").value), 50, "pad 8 = half");
});

test("trim: handles set trim/length; apply-to-steps writes existing steps; BPM match", async b => {
	const p = await boot(b);
	await ev(p, () => { window.selectedChannel = 0; PO33.clearPattern(); window.writeButtonFunction(); document.getElementById("btn1").click(); window.writeButtonFunction(); });
	await tap(p, "#btnTrim"); await sleep(600);
	await ev(p, () => { const cs = channelSettingsArr[0]; cs.fxTrim = 250; cs.fxLength = 700; });
	await sleep(400);
	await tap(p, '[data-tv="all"]');
	const st = await ev(p, () => newChannelArr[0][currentPattern][0]);
	eq(st.fxTrim, 250, "apply-to-steps trim"); eq(st.fxLength, 700, "apply-to-steps length");
	const bpmRow = await ev(p, () => { const r = document.getElementById("tvBpm"); return r ? { hidden: r.hidden, bpm: +r.dataset.bpm } : null; });
	assert(bpmRow && !bpmRow.hidden && bpmRow.bpm > 0, "BPM match row visible");
	await tap(p, "#tvBpmBtn");
	eq(await ev(p, () => window.tempo), bpmRow.bpm, "set BPM applies");
});

test("undo: a step edit, and a whole BUILD, each undo in one press", async b => {
	const p = await boot(b);
	await ev(p, () => { PO33.clearPattern(); PO33.undo.clear(); window.selectedChannel = 0; window.writeButtonFunction(); document.getElementById("btn2").click(); window.writeButtonFunction(); });
	eq(await ev(p, () => newChannelArr[0][currentPattern][1].noteOn), 1);
	await ev(p, () => PO33.undo.undo());
	eq(await ev(p, () => newChannelArr[0][currentPattern][1].noteOn), 0, "step undo");
	await ev(p, () => { PO33.build.show(); document.querySelector('[data-bd="whole"]').click(); });
	await sleep(500);
	const chainLen = await ev(p, () => patternChain.length);
	eq(chainLen, 8, "whole beat chains 8 bars");
	await ev(p, () => PO33.undo.undo());
	eq(await ev(p, () => patternChain.length), 1, "one undo reverts the whole build incl. chain");
});

test("build: whole beat writes 4 patterns, sets tempo, never touches a chopped slot", async b => {
	const p = await boot(b);
	// chop something onto slot 13 first, then build
	await ev(p, (mk) => { const buf = (new Function("return " + mk))()(); PO33.slice.toSlot(buf, 13, 16, { layout: false, matchTempo: false }); }, MAKE_SIGNATURE_BUFFER.toString());
	await sleep(300);
	await ev(p, () => { PO33.build.show(); document.querySelector('[data-bd="whole"]').click(); });
	await sleep(600);
	const r = await ev(p, (rd) => ({ pats: new Set(patternChain).size, tempo: window.tempo, pads: (new Function("return " + rd))()(4) }), READ_PADS.toString());
	eq(r.pats, 4, "four distinct patterns"); assert(r.tempo >= 70 && r.tempo <= 150, "tempo set");
	assert(isSignature(r.pads), "BUILD must not overwrite chopped slot 13");
});

test("keys: rec writes the lane; in-time; a kit loads real audio onto a drum slot", async b => {
	const p = await boot(b);
	await ev(p, () => { PO33.keys.clearTrack(); PO33.keys.toggleArm(); PO33.keys.down(2); PO33.keys.up(2); });
	eq(await ev(p, () => PO33.keys.trackInfo().steps), 1, "one note recorded");
	await ev(p, () => PO33.keys.toggleArm());
	assert(await ev(p, () => PO33.keys.setFit(true) === true), "in-time toggles");
	await ev(p, () => PO33.drumkit.load("808", 16));
	await sleep(800);
	const has = await ev(p, () => { try { const pl = drumArr[7].get(noteArray[0]); const b = pl.buffer.get ? pl.buffer.get() : pl.buffer._buffer; return b && b.length > 256; } catch (e) { return false; } });
	assert(has, "808 kit put real audio on slot 16 pad 1");
});

test("fx: punch-in remaps the step pointer; fx lane records a hold", async b => {
	const p = await boot(b);
	const rev = await ev(p, () => { PO33.fx.punch(15, true); const r = [0, 1, 2].map(s => po33Fx.mapStep(s)); PO33.fx.punch(0, false); return r.join(","); });
	eq(rev, "15,14,13", "reversed maps steps backwards");
	await ev(p, () => { PO33.fxRec.clear(); PO33.fxRec.toggleArm(); PO33.fx.punch(4, true); PO33.fxRec.stamp(6); PO33.fx.punch(0, false); PO33.fxRec.toggleArm(); });
	eq(await ev(p, () => PO33.fxRec.info().steps), 1, "fx lane recorded one step");
});

test("mix: mute / solo cycle per slot", async b => {
	const p = await boot(b);
	await ev(p, () => document.querySelector('[data-perf="mute"]').click()); await sleep(300);
	await tap(p, '[data-mute="0"]');
	eq(await ev(p, () => PO33.channels.state(0)), "mute");
	await tap(p, '[data-mute="0"]');
	eq(await ev(p, () => PO33.channels.state(0)), "solo");
	assert(await ev(p, () => po33Silenced(1)), "other slots silenced while 1 is soloed");
	await tap(p, '[data-mute="0"]');
	eq(await ev(p, () => PO33.channels.state(0)), "on");
});

test("projects: save includes keys+fx, new is empty, open restores, rename/copy/folder/export", async b => {
	const p = await boot(b);
	await ev(p, () => {
		PO33.keys.clearTrack(); PO33.keys.toggleArm(); PO33.keys.down(1); PO33.keys.up(1); PO33.keys.toggleArm();
		PO33.fxRec.clear(); PO33.fxRec.toggleArm(); PO33.fx.punch(2, true); PO33.fxRec.stamp(3); PO33.fx.punch(0, false); PO33.fxRec.toggleArm();
		window.tempo = 133; PO33.projects.save("alpha");
	});
	const s = await ev(p, () => { const a = JSON.parse(localStorage.getItem("po33.projects")).alpha; return { k: !!a.keys, f: !!a.fx, t: a.tempo }; });
	assert(s.k && s.f && s.t === 133, "snapshot has keys, fx, tempo");
	await ev(p, () => { PO33.keys.clearTrack(); PO33.fxRec.clear(); window.tempo = 90; PO33.projects.open("alpha"); });
	await sleep(400);
	const back = await ev(p, () => ({ k: PO33.keys.trackInfo().steps, f: PO33.fxRec.info().steps, t: window.tempo }));
	eq(back.k, 1, "keys restored"); eq(back.f, 1, "fx restored"); eq(back.t, 133, "tempo restored");
	await ev(p, () => PO33.projects.newProject("blank"));
	eq(await ev(p, () => { let n = 0; for (let c = 0; c < 16; c++) for (let q = 0; q < 16; q++) for (let i = 0; i < 16; i++) n += newChannelArr[c][q][i].noteOn ? 1 : 0; return n; }), 0, "new project is empty");
	await ev(p, () => { PO33.projects.rename("blank", "renamed"); PO33.projects.duplicate("renamed"); });
	const list = await ev(p, () => PO33.projects.list().sort().join(","));
	eq(list, "alpha,renamed,renamed copy");
	// folders are covered by the dedicated step-by-step test below
	const dl = await ev(p, () => new Promise(res => { const o = URL.createObjectURL; let n = 0; URL.createObjectURL = function (b) { n++; return o.call(URL, b); }; PO33.projects.exportOne("alpha"); setTimeout(() => { URL.createObjectURL = o; res(n); }, 300); }));
	eq(dl, 1, "export produced a file blob");
});

test("projects: folder survives rename → duplicate → new folder → move (step by step)", async b => {
	const p = await boot(b);
	const L = () => ev(p, () => JSON.parse(localStorage.getItem("po33.projects") || "{}"));
	await ev(p, () => { window.tempo = 133; PO33.projects.save("alpha"); PO33.projects.open("alpha"); });
	await ev(p, () => PO33.projects.newProject("blank"));
	assert((await L()).blank, "after newProject: 'blank' exists");
	await ev(p, () => PO33.projects.rename("blank", "renamed"));
	assert((await L()).renamed && !(await L()).blank, "after rename");
	await ev(p, () => PO33.projects.duplicate("renamed"));
	assert((await L())["renamed copy"], "after duplicate");
	await ev(p, () => PO33.projects.newFolder("beats"));
	eq((await L()).renamed.folder, "beats", "newFolder moves the selected project (renamed) into it");
	await ev(p, () => PO33.projects.moveTo("renamed copy", "beats"));
	eq((await L())["renamed copy"].folder, "beats", "explicit moveTo");
	eq((await ev(p, () => PO33.projects.folders())).join(), "beats", "folder list");
	eq(p.__errors.length, 0, "errors: " + p.__errors.slice(0, 2).join(" | "));
});

test("session: edits survive a reload without saving a project", async b => {
	const p = await boot(b);
	await ev(p, () => { window.selectedChannel = 4; window.currentPattern = 9; PO33.clearPattern(); window.editPattern(4, 3); window.patternChain = [9, 9, 2]; window.tempo = 131; PO33.session.flush(); });
	await reload(p);
	const r = await ev(p, () => ({ on: newChannelArr[4][9][3].noteOn, chain: patternChain.join(","), tempo: window.tempo }));
	eq(r.on, 1, "step"); eq(r.chain, "9,9,2", "chain"); eq(r.tempo, 131, "tempo");
});

test("escape: tap him out, pads still work through him, tap him home", async b => {
	const p = await boot(b);
	await ev(p, () => { const r = PO33.scene.heroRect(); document.getElementById("sceneCanvas").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 })); });
	await sleep(1500);
	assert(await ev(p, () => PO33.escape.isOut()), "he is out");
	eq(await ev(p, () => getComputedStyle(document.getElementById("escapeCanvas")).pointerEvents), "none", "overlay never blocks taps");
	await tap(p, "#btn6");
	eq(await ev(p, () => window.selectedPitch), 5, "pad works through him");
	await ev(p, () => { const s = PO33.escape.state(); document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: s.x + 20, clientY: s.y + 20 })); });
	await sleep(500);
	assert(!(await ev(p, () => PO33.escape.isOut())), "went home");
});

test("guide: opens, search filters across tabs, closes", async b => {
	const p = await boot(b);
	await tap(p, "#fabInfo"); await sleep(400);
	assert(await ev(p, () => document.body.classList.contains("drawer-info")), "open");
	await ev(p, () => { const i = document.getElementById("infoSearch"); i.value = "chop"; i.dispatchEvent(new Event("input", { bubbles: true })); });
	const n = await ev(p, () => [...document.querySelectorAll(".infoItem")].filter(x => !x.hidden).length);
	assert(n >= 2 && n < 15, "search narrows results, got " + n);
	await tap(p, ".drawerClose");
	assert(!(await ev(p, () => document.body.classList.contains("drawer-info"))), "closed");
});

/* The apply layer is the only place a language model can change the user's work,
 * so it is the only place where being "roughly right" is not good enough. Every
 * one of these must be REJECTED, not clamped: clamping step 21 to step 16 makes
 * a real edit nobody asked for. */
test("listen: measures real properties of a known buffer", async b => {
	const p = await boot(b);
	const r = await ev(p, () => {
		const ctx = Tone.context._context || Tone.context;
		const sr = ctx.sampleRate;
		// 2.0s buffer: 0.25s of silence, then four evenly spaced clicks
		const buf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
		const d = buf.getChannelData(0);
		for (let k = 0; k < 4; k++) {
			const at = Math.floor(sr * (0.25 + k * 0.4));
			for (let i = 0; i < Math.floor(sr * 0.05); i++) {
				d[at + i] = Math.sin(i / 6) * (1 - i / (sr * 0.05));
			}
		}
		const a = PO33.listen.analyseBuffer(buf);
		return { secs: a.seconds, lead: a.leadIn, hits: a.onsets.length, silent: a.silent,
			first: a.onsets[0] || 0 };
	});
	assert(Math.abs(r.secs - 2) < 0.02, "duration measured: " + r.secs);
	assert(Math.abs(r.lead - 0.25) < 0.03, "lead-in silence measured: " + r.lead);
	assert(r.hits >= 3 && r.hits <= 5, "should find the four clicks, found " + r.hits);
	assert(Math.abs(r.first - 0.25) < 0.05, "first onset located: " + r.first);
	assert(!r.silent, "a buffer with clicks is not silent");
});

test("guide: all 25 sections render in the drawer on phone and desktop", async b => {
	const p = await boot(b);

	for (const [label, vp] of [
		["desktop", { width: 1440, height: 900 }],
		["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]
	]) {
		await p.setViewport(vp);
		await sleep(500);
		await ev(p, () => {
			const c = document.getElementById("coachCard"); if (c) { c.remove(); }
			document.getElementById("fabInfo").click();
		});
		await sleep(500);

		const r = await ev(p, () => {
			const d = document.getElementById("infoDrawer");
			const secs = [...document.querySelectorAll("#infoBody .gSec")];
			return {
				built: !!d,
				visible: d ? getComputedStyle(d).display !== "none" : false,
				open: document.body.classList.contains("drawer-info"),
				n: secs.length,
				numbered: secs.filter(x => /^\d\d$/.test((x.querySelector(".gNum") || {}).textContent || "")).length,
				offLeft: d ? Math.round(d.getBoundingClientRect().left) : null
			};
		});
		assert(r.built, label + ": the guide drawer was never built");
		assert(r.visible, label + ": the guide drawer is display:none");
		assert(r.open, label + ": clicking info did not open the guide");
		eq(r.n, 25, label + ": section count");
		eq(r.numbered, 25, label + ": every section carries its 01-25 badge");
		assert(r.offLeft >= -2, label + ": the drawer is still parked off-screen at " + r.offLeft);

		await ev(p, () => document.querySelector(".drawerClose").click());
		await sleep(300);
	}
});

/* A full-screen panel must fill the screen no matter which perform tab is
 * selected. The fx tab caps the LCD so its four rows of effects fit, and that
 * cap has the same CSS specificity as the five rules that expand the screen
 * for a panel — so whichever is written last wins. It was written last, and
 * aaa / util / proj opened at 148px instead of 786px. */
test("a full-screen panel fills the screen on every perform tab", async b => {
	const p = await boot(b);
	await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
	await sleep(400);
	const lcdH = () => ev(p, () => Math.round(document.querySelector(".lcd").getBoundingClientRect().height));

	for (const tab of ["xy", "fx", "mute", "keys"]) {
		await ev(p, t => document.querySelector('[data-perf="' + t + '"]').click(), tab);
		await sleep(350);
		const shut = await lcdH();

		await ev(p, () => PO33.build.show());
		await sleep(400);
		const open = await lcdH();
		await ev(p, () => PO33.build.hide());
		await sleep(250);

		assert(open > shut * 2, "aaa on the " + tab + " tab: screen went " + shut + " -> " + open +
			", expected it to take over the screen");
		assert(open > 400, "aaa on the " + tab + " tab is only " + open + "px tall");
	}
});

test("nothing invisible covers the screen's buttons when panels are closed", async b => {
	const p = await boot(b);
	const blocked = await ev(p, () => ["#projBtn", "#hudView", "#undoBtn", "#btnPlay", "#btn1", "#fabInfo", '[data-perf="fx"]'].filter(s => {
		const e = document.querySelector(s); const r = e.getBoundingClientRect();
		const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return !(h === e || e.contains(h));
	}));
	eq(blocked.length, 0, "covered: " + blocked.join(","));
});

/* ---------- the hardware's button grammar (js/hold.js) ----------
 *
 * These need real multi-touch: a function key held by one finger while
 * another presses a pad. elementHandle.tap() is one finger, so these drive
 * CDP touch events directly. Lifting sends ONLY the finger being lifted —
 * sending the remaining fingers releases those instead. */
async function fingers(p) {
	const cdp = await p.target().createCDPSession();
	const pts = {};
	let id = 1;
	const at = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
	return {
		async down(sel) { const c = await at(sel); pts[sel] = { x: c.x, y: c.y, id: id++ }; await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: Object.values(pts) }); await sleep(50); },
		async up(sel) { const f = pts[sel]; delete pts[sel]; await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [f] }); await sleep(80); },
		async tap(sel, ms) { await this.down(sel); await sleep(ms || 40); await this.up(sel); await sleep(60); }
	};
}

test("hardware: a pad sounds on touch-down, not when the finger lifts", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	await ev(p, () => { window.__plays = 0; const o = window.playSound; window.playSound = function () { window.__plays++; return o.apply(this, arguments); }; });
	await f.down("#btn1");
	eq(await ev(p, () => window.__plays), 1, "sound on touch-down");
	await f.up("#btn1");
	eq(await ev(p, () => window.__plays), 1, "and not again on release");
});

test("hardware: hold SOUND / PATTERN + pads, let go and it returns; a tap still latches", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	const st = () => ev(p, () => ({ state: window.state, sel: window.selectedChannel, chain: patternChain.join(",") }));
	await f.down("#btnSound"); await f.tap("#btn10"); await f.up("#btnSound");
	let s = await st(); eq(s.sel, 9, "SOUND + 10 picks slot 10"); eq(s.state, 0, "release returns");
	await f.down("#btnPattern"); await f.tap("#btn2"); await f.tap("#btn3"); await f.up("#btnPattern");
	s = await st(); eq(s.chain, "1,2", "PATTERN + 2, 3 chains"); eq(s.state, 0, "release returns");
	await f.tap("#btnSound");
	eq((await st()).state, 2, "a tap on SOUND latches");
	await f.tap("#btn12");
	s = await st(); eq(s.sel, 11, "latched SOUND + pad picks"); eq(s.state, 2, "and stays");
	await f.tap("#btnSound");
	eq((await st()).state, 0, "a second tap leaves");
});

test("hardware: WRITE + PATTERN + pad copies the pattern in one undo", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	await ev(p, () => { currentPattern = 0; for (let c = 0; c < 16; c++) for (let x = 0; x < 16; x++) newChannelArr[c][4][x].noteOn = 0; newChannelArr[9][0][3].noteOn = 1; });
	await f.down("#btnWrite"); await f.down("#btnPattern"); await f.tap("#btn5"); await f.up("#btnPattern"); await f.up("#btnWrite");
	const r = await ev(p, () => ({ copied: newChannelArr[9][4][3].noteOn, mode: window.mode, state: window.state, cur: currentPattern }));
	eq(r.copied, 1, "pattern 1 copied to 5"); eq(r.mode, 0, "WRITE not toggled"); eq(r.state, 0, "PATTERN let go"); eq(r.cur, 0, "still on pattern 1");
	await ev(p, () => PO33.undo.undo());
	eq(await ev(p, () => newChannelArr[9][4][3].noteOn), 0, "one undo reverts the copy");
});

test("hardware: RECORD + PATTERN clears; RECORD + SOUND twice deletes and stays deleted", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	await ev(p, () => { newChannelArr[9][currentPattern][3].noteOn = 1; });
	await f.down("#btnRecord"); await f.tap("#btnPattern"); await f.up("#btnRecord");
	const left = await ev(p, () => newChannelArr.reduce((n, ch) => n + ch[currentPattern].filter(x => x.noteOn).length, 0));
	eq(left, 0, "pattern cleared");
	assert(!(await ev(p, () => PO33.rec.isRecording() || PO33.rec.isStarting())), "no recording started");
	await ev(p, () => { selectedChannel = 13; });
	await f.down("#btnRecord"); await f.tap("#btnSound"); await f.up("#btnRecord");
	assert((await ev(p, () => PO33Lib.slotName(14))) !== "empty", "the first press only asks");
	await f.down("#btnRecord"); await f.tap("#btnSound"); await f.up("#btnRecord");
	eq(await ev(p, () => PO33Lib.slotName(14)), "empty", "the second deletes");
	await reload(p);
	eq(await ev(p, () => PO33Lib.slotName(14)), "empty", "fillDefaults must not bring it back");
	eq(await ev(p, () => !!drumArr[5].__empty), true, "the slot is silent after reload");
});

test("hardware: hold WRITE while playing punches in; FX + pad with WRITE on records, FX + 16 clears", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	await ev(p, () => { selectedChannel = 9; patternChain = [0]; currentPattern = 0; for (let x = 0; x < 16; x++) newChannelArr[9][0][x].noteOn = 0; window.playButtonFunction(); });
	await sleep(400);
	await f.down("#btnWrite"); await sleep(350); await f.tap("#btn4"); await f.up("#btnWrite");
	const r = await ev(p, () => ({ hits: newChannelArr[9][0].filter(x => x.noteOn).length, mode: window.mode, motion: PO33.motion.isArmed() }));
	eq(r.hits, 1, "one step punched in"); eq(r.mode, 0, "WRITE not toggled by a used hold"); eq(r.motion, false, "slider recording ends with the hold");
	await f.tap("#btnWrite");
	await f.down("#btnFX"); await sleep(60); await f.down("#btn15"); await sleep(700); await f.up("#btn15"); await f.up("#btnFX");
	assert((await ev(p, () => PO33.fxRec.info().steps)) > 0, "FX + 15 with WRITE on records the lane");
	await f.down("#btnFX"); await sleep(60); await f.tap("#btn16"); await f.up("#btnFX");
	eq(await ev(p, () => PO33.fxRec.info().steps), 0, "FX + 16 clears it");
	await ev(p, () => { PO33.undo.undo(); });
	assert((await ev(p, () => PO33.fxRec.info().steps)) > 0, "undo brings the fx lane back");
	await ev(p, () => { PO33.clearPattern(); });
	eq(await ev(p, () => PO33.fxRec.info().steps), 0, "clear pattern clears the fx lane too");
	await ev(p, () => window.playButtonFunction());
});

test("hardware: RECORD + hold a pad samples into that slot until you let go", async b => {
	const p = await boot(b);
	const f = await fingers(p);
	await ev(p, () => { selectedChannel = 0; });
	const sample = async pad => {
		await f.down("#btnRecord"); await f.down("#btn" + pad);
		await sleep(1400);
		const live = await ev(p, () => PO33.rec.isRecording());
		await f.up("#btn" + pad); await f.up("#btnRecord");
		await sleep(1500);
		return live;
	};
	assert(await sample(3), "recording while RECORD + pad 3 are held");
	const m = await ev(p, () => ({ rec: PO33.rec.isRecording(), name: PO33Lib.slotName(3), sel: selectedChannel }));
	eq(m.rec, false, "letting go of the pad stops it");
	assert(/^recordings\//.test(m.name || ""), "melodic slot 3 holds the recording, got " + m.name);
	eq(m.sel, 0, "the selected sound did not change");
	assert(await sample(13), "recording while RECORD + pad 13 are held");
	eq(await ev(p, () => PO33.chops.isChopped(13)), true, "a drum slot gets the recording as 16 slices, as on the hardware");
});

test("perform strip: starts collapsed; a tab opens it, the same tab closes it", async b => {
	const p = await boot(b);
	const c = () => ev(p, () => document.body.classList.contains("perfCollapsed"));
	eq(await c(), true, "collapsed on load");
	await tap(p, '[data-perf="fx"]');
	eq(await c(), false, "a tab opens it");
	await tap(p, '[data-perf="keys"]');
	eq(await c(), false, "another tab switches, stays open");
	await tap(p, '[data-perf="keys"]');
	eq(await c(), true, "the open tab closes it");
	const fits = await ev(p, () => document.documentElement.scrollHeight <= innerHeight);
	assert(fits, "no page scroll with the strip collapsed");
});

test("trim: auto cuts the silence off the front", async b => {
	const p = await boot(b);
	const r = await ev(p, () => {
		const ctx = Tone.context._context || Tone.context, sr = ctx.sampleRate;
		const buf = ctx.createBuffer(1, Math.floor(sr * 2), sr), d = buf.getChannelData(0);
		for (let k = 0; k < 4; k++) { const at = Math.floor(sr * (0.3 + k * 0.4)); for (let i = 0; i < sr * 0.05; i++) d[at + i] = Math.sin(i / 6); }
		selectedChannel = 0;
		melodicArr[0].dispose();
		melodicArr[0] = new Tone.Sampler({ "C#4": buf }); melodicArr[0].connect(melodicFilterArr[0]);
		return true;
	});
	assert(r);
	await tap(p, "#btnTrim"); await sleep(500);
	await tap(p, '[data-tv="auto"]');
	const t = await ev(p, () => channelSettingsArr[0].fxTrim / 1000 * 2);
	assert(Math.abs(t - 0.3) < 0.03, "trim start lands on the first hit (0.3s), got " + t.toFixed(3) + "s");
});

/* ---------- the sample-loss bugs ---------- */

test("SAMPLE: chop 16 → 16 distinct pads, none duplicated", async b => {
	const p = await boot(b);
	const pads = await ev(p, (mk, rd) => { const buf = (new Function("return " + mk))()(); PO33.slice.toSlot(buf, 9, 16, { layout: false, matchTempo: false }); return (new Function("return " + rd))()(0); }, MAKE_SIGNATURE_BUFFER.toString(), READ_PADS.toString());
	assert(isSignature(pads), "pads should carry the 16 distinct pieces: " + JSON.stringify(pads));
});

test("SAMPLE: chops survive a reload (slot 9, a slot that ships with a kit)", async b => {
	const p = await boot(b);
	await ev(p, (mk) => { const buf = (new Function("return " + mk))()(); PO33.slice.toSlot(buf, 9, 16, { layout: false, matchTempo: false }); }, MAKE_SIGNATURE_BUFFER.toString());
	await sleep(1200);                                  // let chopstore's IDB write land
	await reload(p, 4000);                              // past every boot timer + decode
	const pads = await ev(p, (rd) => (new Function("return " + rd))()(0), READ_PADS.toString());
	assert(isSignature(pads), "after reload slot 9 pads should still be the chops, got " + JSON.stringify(pads));
});

test("SAMPLE: chops survive a reload on slot 13 (fillDefaults must not replace it)", async b => {
	const p = await boot(b);
	await ev(p, (mk) => { const buf = (new Function("return " + mk))()(); PO33.slice.toSlot(buf, 13, 16, { layout: false, matchTempo: false }); }, MAKE_SIGNATURE_BUFFER.toString());
	await sleep(1200);
	await reload(p, 4000);
	const pads = await ev(p, (rd) => (new Function("return " + rd))()(4), READ_PADS.toString());
	assert(isSignature(pads), "after reload slot 13 pads should still be the chops, got " + JSON.stringify(pads));
});

test("SAMPLE: a slot assignment survives TWO reloads with an early edit in between", async b => {
	// run 1: assign a library sample to slot 5
	const p = await boot(b);
	await ev(p, () => PO33Lib.assignUrl(5, "samples/po33/690.wav", "po33/690", 0.24, true));
	await sleep(400);
	eq(await ev(p, () => PO33Lib.slotName(5)), "po33/690", "assigned");
	// run 2: reload and touch a pad BEFORE the 1200ms slot restore has run
	await page_reload_early(p);
	await ev(p, () => { document.getElementById("btn2").click(); PO33.session.flush(); });
	await sleep(3000);
	// run 3: reload again — the sample must still be on slot 5
	await reload(p, 3200);
	eq(await ev(p, () => PO33Lib.slotName(5)), "po33/690", "slot 5 lost its sample after an early edit + reload");
});
async function page_reload_early(p) { await p.reload({ waitUntil: "domcontentloaded" }); await powerOn(p, 350); }

test("SAMPLE: per-pad load lands on the pad you just heard, not the next one", async b => {
	const p = await boot(b);
	await ev(p, () => { window.soundButtonFunction(); });      // SOUND mode
	await sleep(200);
	const before = await ev(p, () => channelSettingsArr[8].notePitch);   // the pad that will sound
	await tap(p, "#btn9");                                     // select slot 9 → plays pad `before`, then advances
	await ev(p, () => PO33Lib.assignUrl(9, "samples/po33/691.wav", "po33/691", 0.43, true));
	await sleep(300);
	const landed = await ev(p, () => Object.keys(JSON.parse(localStorage.getItem("po33.drumpads") || "{}")["8"] || {}).map(Number));
	eq(landed.join(), String(before), "sample should land on the pad that sounded (" + before + "), landed on " + landed.join());
	await ev(p, () => window.soundButtonFunction());
});

test("SAMPLE: assigning a kit while playing never leaves a pad without a buffer", async b => {
	const p = await boot(b);
	await ev(p, () => { PO33.clearPattern(); window.selectedChannel = 8; window.writeButtonFunction(); for (let i = 1; i <= 16; i++) document.getElementById("btn" + i).click(); window.writeButtonFunction(); });
	await tap(p, "#btnPlay"); await sleep(300);
	await ev(p, () => PO33Lib.assignUrl(9, "samples/po33/692.wav", "po33/692", 0.25, true));
	await sleep(900);
	const bad = await ev(p, () => { let n = 0; for (let k = 0; k < 16; k++) { try { const pl = drumArr[0].get(noteArray[k]); if (!pl || !pl.buffer) n++; } catch (e) { n++; } } return n; });
	eq(bad, 0, "pads without a player/buffer during playback");
	eq(p.__errors.filter(e => /dispose|null/i.test(e)).length, 0, "no dispose errors: " + p.__errors.slice(0, 2).join(" | "));
	await tap(p, "#btnPlay");
});

test("SAMPLE: melodic slot plays the trimmed region on a pad tap", async b => {
	const p = await boot(b);
	const r = await ev(p, () => { window.selectedChannel = 0; const cs = channelSettingsArr[0]; cs.fxTrim = 300; cs.fxLength = 200;
		const s = melodicArr[0], seen = []; const o = s.triggerAttackExt.bind(s);
		s.triggerAttackExt = function (n, t, v, off, dur) { seen.push([+off.toFixed(3), +dur.toFixed(3)]); return o(n, t, v, off, dur); };
		const L = s.buffers.get(61).duration; playSound(0, 0);
		return { seen, want: [+(L * 0.3).toFixed(3), +(L * 0.2).toFixed(3)] }; });
	eq(JSON.stringify(r.seen[0]), JSON.stringify(r.want), "offset/duration follow trim");
});

/* ------------------------------------------------------------------ */
/* runner                                                              */
/* ------------------------------------------------------------------ */

(async () => {
	const only = process.argv[2];
	const server = await startServer();
	const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
		args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-gpu",
			// a fake microphone (a steady beep) with no permission prompt, for RECORD + pad
			"--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
	let pass = 0, fail = 0; const failures = [];
	const t0 = Date.now();
	for (const t of tests) {
		if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
		const s = Date.now();
		let page;
		try {
			await t.fn(Object.assign(browser, { __page: null }));
			pass++; console.log("  PASS  " + t.name + "  (" + (Date.now() - s) + "ms)");
		} catch (e) {
			fail++; failures.push([t.name, e.message]);
			console.log("  FAIL  " + t.name + "\n        " + (e.message || e).split("\n")[0]);
		}
		// close any contexts the test left open
		for (const c of browser.browserContexts()) { if (c !== browser.defaultBrowserContext()) { try { await c.close(); } catch (e) {} } }
	}
	await browser.close(); server.kill();
	console.log("\n" + pass + " passed, " + fail + " failed  (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
	if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  - " + f[0] + "\n      " + f[1])); }
	process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
