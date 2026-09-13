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
	const mods = await ev(p, () => ["session", "undo", "projects", "slice", "chops", "keys", "fxRec", "build", "scene", "escape", "trim", "util"]
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

test("bpm: slider sets tempo; pads on the BPM screen preview, not volume", async b => {
	const p = await boot(b);
	await tap(p, "#btnBPM");
	await ev(p, () => { const s = document.getElementById("slider2"); s.value = 800; s.dispatchEvent(new Event("input", { bubbles: true })); });
	await sleep(200);
	const tempo = await ev(p, () => window.tempo);
	assert(tempo > 150, "tempo should follow slider, got " + tempo);
	const vol = await ev(p, () => window.volume);
	await tap(p, "#btn9");
	eq(await ev(p, () => window.volume), vol, "pad tap must not change master volume");
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

test("nothing invisible covers the screen's buttons when panels are closed", async b => {
	const p = await boot(b);
	const blocked = await ev(p, () => ["#projBtn", "#hudView", "#undoBtn", "#btnPlay", "#btn1", "#fabInfo", '[data-perf="fx"]'].filter(s => {
		const e = document.querySelector(s); const r = e.getBoundingClientRect();
		const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return !(h === e || e.contains(h));
	}));
	eq(blocked.length, 0, "covered: " + blocked.join(","));
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
		args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"] });
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
