/* aiapply.js — letting the assistant change the beat, safely.
 *
 * A language model proposing steps is a suggestion. Applying it to somebody's
 * work is an edit. The gap between those two is this file, and it is built on
 * one assumption: THE MODEL'S OUTPUT IS UNTRUSTED INPUT. Not malicious —
 * just occasionally wrong, out of range, or confidently about a slot that
 * holds something you spent an hour chopping.
 *
 * So every proposal goes through four gates:
 *
 *   1. SCHEMA   — it must be JSON in a shape we defined. Prose is rejected,
 *                 not "best-effort parsed". Guessing what someone meant is
 *                 how you write a kick into the wrong slot.
 *   2. VALIDATE — every number is bounds-checked and rejected if it is out
 *                 of range, never silently clamped. A clamp turns "step 21"
 *                 into a real edit at step 16 that nobody asked for.
 *   3. PREVIEW  — nothing is applied until you read what it will do and say
 *                 yes. This is the actual safety mechanism; the rest is
 *                 hygiene.
 *   4. UNDO     — the whole proposal is marked as ONE undo step before it
 *                 touches anything, so one press puts it back.
 *
 * And one hard rule inherited from the aaa screen: a chopped slot is never
 * written to. Those sixteen pads are your arrangement of your own sample,
 * and a generated hi-hat line over the top destroys work that cannot be
 * recovered from the pattern data.
 *
 * Exposes window.PO33.aiApply
 */
(function () {
	"use strict";

	window.PO33 = window.PO33 || {};

	/* The contract handed to the model. Kept here, next to the validator that
	 * enforces it, so the two cannot drift apart. */
	var SCHEMA_DOC =
		"When (and ONLY when) the user asks you to WRITE, ADD, CHANGE or CLEAR something in the\n" +
		"pattern, reply with a fenced ```json block containing exactly this shape:\n" +
		"{\n" +
		'  "summary": "one short line describing the change",\n' +
		'  "ops": [\n' +
		'    {"op":"setSteps","slot":9,"pitch":0,"steps":[1,7,11]},\n' +
		'    {"op":"addSteps","slot":12,"pitch":4,"steps":[3,7,11,15]},\n' +
		'    {"op":"clearSlot","slot":10},\n' +
		'    {"op":"tempo","bpm":90},\n' +
		'    {"op":"swing","percent":18}\n' +
		"  ]\n" +
		"}\n" +
		"Rules you must follow:\n" +
		"- slot is 1-16. 1-8 are melodic, 9-16 are drums.\n" +
		"- steps are 1-16. pitch is 0-15 (which pad of that slot sounds).\n" +
		"- setSteps REPLACES that slot's steps; addSteps leaves existing ones alone.\n" +
		"- bpm is 40-200. swing percent is 0-60.\n" +
		"- Never propose writing to a slot listed as chopped.\n" +
		"- Put a normal sentence or two OUTSIDE the json block explaining the idea.\n" +
		"- If the user is only asking a question, do NOT emit a json block at all.";

	function g(n, d) { return (typeof window[n] !== "undefined") ? window[n] : d; }

	/* ---------- 1. schema: pull the block out, or don't ---------- */

	function extract(text) {
		if (!text) { return null; }
		var m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\{[\s\S]*?\})\s*```/);
		// A CLOSED block that will not parse is malformed, not cut off. It gets
		// no plan and no excuse — guessing at it is exactly the failure mode
		// this whole file refuses.
		if (m) {
			try { return JSON.parse(m[1]); } catch (e) { return null; }
		}
		/* An answer that hit the length limit ends mid-block: the opening fence
		 * is there, the closing one never arrived. The old code required both,
		 * so a cut-off plan matched nothing, no proposal was ever shown, and the
		 * raw json fell through into the chat bubble as text — which reads as
		 * "it said it changed the tempo and nothing happened".
		 *
		 * We do NOT try to repair the json. Half an ops array is a real edit
		 * nobody asked for, which is the one thing this file exists to prevent.
		 * We only detect it, so the panel can say it was cut off. */
		m = text.match(/```json\s*([\s\S]*)$/i) || text.match(/```\s*(\{[\s\S]*)$/);
		if (!m) { return null; }
		try { return JSON.parse(m[1]); } catch (e) { return { __truncated: true }; }
	}

	// the prose, with the machine-readable part taken out — including an
	// unterminated block, so a truncated plan never leaks into the bubble
	function prose(text) {
		return String(text || "").replace(/```json[\s\S]*?```/gi, "")
			.replace(/```[\s\S]*?```/g, "")
			.replace(/```[\s\S]*$/, "").trim();
	}

	/* ---------- 2. validate: reject, never clamp ---------- */

	function isInt(v, lo, hi) {
		return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi;
	}

	function chopped(slot) {
		try { return !!(window.PO33.chops && PO33.chops.isChopped(slot)); } catch (e) { return false; }
	}

	function validate(plan) {
		var errs = [], ops = [];
		if (!plan || typeof plan !== "object") { return { errs: ["no plan"], ops: [] }; }
		if (plan.__truncated) {
			return { errs: ["the answer was cut off mid-change — nothing was applied; ask again"], ops: [] };
		}
		if (!Array.isArray(plan.ops) || !plan.ops.length) { return { errs: ["no operations"], ops: [] }; }
		if (plan.ops.length > 24) { return { errs: ["too many operations (" + plan.ops.length + ")"], ops: [] }; }

		plan.ops.forEach(function (o, i) {
			var where = "op " + (i + 1) + " (" + (o && o.op) + "): ";
			if (!o || typeof o.op !== "string") { errs.push(where + "malformed"); return; }

			if (o.op === "tempo") {
				if (!isInt(o.bpm, 40, 200)) { errs.push(where + "bpm " + o.bpm + " is out of range 40-200"); return; }
				ops.push(o); return;
			}
			if (o.op === "swing") {
				if (!isInt(o.percent, 0, 60)) { errs.push(where + "swing " + o.percent + " is out of range 0-60"); return; }
				ops.push(o); return;
			}
			if (o.op === "clearSlot" || o.op === "setSteps" || o.op === "addSteps") {
				if (!isInt(o.slot, 1, 16)) { errs.push(where + "slot " + o.slot + " is out of range 1-16"); return; }
				if (chopped(o.slot)) { errs.push(where + "slot " + o.slot + " is chopped — refusing to overwrite it"); return; }
				if (o.op === "clearSlot") { ops.push(o); return; }

				if (!Array.isArray(o.steps) || !o.steps.length) { errs.push(where + "no steps"); return; }
				if (o.steps.length > 16) { errs.push(where + "more than 16 steps"); return; }
				var bad = o.steps.filter(function (s) { return !isInt(s, 1, 16); });
				if (bad.length) { errs.push(where + "steps out of range 1-16: " + bad.join(", ")); return; }
				if (o.pitch != null && !isInt(o.pitch, 0, 15)) {
					errs.push(where + "pitch " + o.pitch + " is out of range 0-15"); return;
				}
				ops.push(o); return;
			}
			errs.push(where + "unknown operation");
		});
		return { errs: errs, ops: ops };
	}

	/* ---------- 3. preview ---------- */

	function describe(ops) {
		return ops.map(function (o) {
			if (o.op === "tempo") { return "set tempo to " + o.bpm + " BPM"; }
			if (o.op === "swing") { return "set swing to " + o.percent + "%"; }
			if (o.op === "clearSlot") { return "clear slot " + o.slot; }
			var verb = o.op === "setSteps" ? "replace" : "add to";
			return verb + " slot " + o.slot +
				(o.pitch != null ? " (pad " + (o.pitch + 1) + ")" : "") +
				": steps " + o.steps.join(" ");
		});
	}

	/* ---------- 4. apply, as one undo ---------- */

	function beat(ch, step) {
		try { return window.newChannelArr[ch][g("currentPattern", 0)][step]; } catch (e) { return null; }
	}

	function apply(ops) {
		// one mark for the whole proposal: undoing a generated part should be
		// one press, not one per step
		try { if (window.PO33.undo) { PO33.undo.markWorld("assistant"); } } catch (e) {}

		var touched = 0;
		ops.forEach(function (o) {
			var ch, i, b;
			/* The clock the machine actually runs on is Tone.Transport, not these
			 * globals. Setting window.tempo alone changes the number the app
			 * reports and nothing you can hear — the transport keeps running at
			 * the old bpm — which is why an applied tempo change did nothing.
			 * Drive both, the same way session restore and the builder do. */
			if (o.op === "tempo") {
				window.tempo = o.bpm;
				try { Tone.Transport.bpm.value = o.bpm; } catch (e) {}
				touched++;
				return;
			}
			/* Swing has a second trap: the model speaks in percent (0-60), but
			 * window.swing is the dial's own 0-1000 unit (Tone.Transport.swing =
			 * swing/1000, and the app prints swing/10 as the percentage). Storing
			 * the percent raw made "18% swing" mean 1.8%, i.e. straight. */
			if (o.op === "swing") {
				var dial = o.percent * 10;
				window.swing = dial;
				try {
					Tone.Transport.swing = dial / 1000;
					Tone.Transport.swingSubdivision = "16n";
				} catch (e) {}
				touched++;
				return;
			}

			ch = o.slot - 1;
			if (o.op === "clearSlot") {
				for (i = 0; i < 16; i++) { b = beat(ch, i); if (b) { b.noteOn = 0; } }
				touched++;
				return;
			}
			if (o.op === "setSteps") {
				for (i = 0; i < 16; i++) { b = beat(ch, i); if (b) { b.noteOn = 0; } }
			}
			o.steps.forEach(function (s) {
				b = beat(ch, s - 1);
				if (!b) { return; }
				b.noteOn = 1;
				if (o.pitch != null) { b.notePitch = o.pitch; }
				touched++;
			});
		});

		try { window.PO33.session.save(true); } catch (e) {}
		try { if (window.updateDisplay) { window.updateDisplay(); } } catch (e) {}
		return touched;
	}

	window.PO33.aiApply = {
		SCHEMA_DOC: SCHEMA_DOC,
		extract: extract,
		prose: prose,
		validate: validate,
		describe: describe,
		apply: apply
	};
})();
