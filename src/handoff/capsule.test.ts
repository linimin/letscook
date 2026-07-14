import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assessCookHandoffStartability,
	COOK_HANDOFF_MAX_AGE_MS,
	isPendingHandoffFresh,
	isTimestampFreshEnough,
	normalizeCookHandoffCapsule,
	validateCookHandoffSchema,
} from "./capsule.ts";
import { buildHandoffConfirmationLayout, formatConfirmationLayoutText } from "./confirmation-layout.ts";
import { synthesizeCookHandoff, validateCookHandoffTool } from "./synthesize.ts";

test("normalizeCookHandoffCapsule supports hint fields and camelCase aliases", () => {
	const capsule = normalizeCookHandoffCapsule({
		mission: "Ship auth redirect",
		scope: ["src/auth/"],
		acceptance: ["tests pass"],
		firstSliceGoal: "Add redirect handler",
		implementationSurfaces: ["src/auth/redirect.ts"],
		verificationCommands: ["npm test"],
	});
	assert.equal(capsule.first_slice_goal, "Add redirect handler");
	assert.deepEqual(capsule.implementation_surfaces, ["src/auth/redirect.ts"]);
	assert.deepEqual(capsule.verification_commands, ["npm test"]);
});

test("unable_to_prepare handoff_kind fails startability", () => {
	const capsule = normalizeCookHandoffCapsule({
		handoff_kind: "unable_to_prepare",
		reason: "Mission unclear",
		mission: "unclear",
		scope: ["<repo>"],
		acceptance: ["clarify"],
	});
	const assessment = assessCookHandoffStartability(capsule);
	assert.equal(assessment.startable, false);
	assert.match(assessment.errors.join(" "), /unable_to_prepare|Mission unclear/);
});

test("confirmation layout includes proposal critique and routing sections", () => {
	const capsule = normalizeCookHandoffCapsule({
		mission: "Add login redirect handling and tests",
		scope: ["src/auth/"],
		acceptance: ["redirect tests pass"],
		first_slice_goal: "Wire redirect route",
	});
	const preview = validateCookHandoffTool(capsule);
	assert.equal(preview.ok, true);
	const layout = buildHandoffConfirmationLayout({
		proposal: assessCookHandoffStartability(capsule).proposal!,
		analysis: assessCookHandoffStartability(capsule).proposal!.analysis,
	});
	const text = formatConfirmationLayoutText(layout);
	assert.match(text, /Startup brief/i);
	assert.match(text, /critique|routing/i);
});

test("handoff freshness TTL honors COOK_HANDOFF_MAX_AGE_MS", () => {
	const fresh = new Date().toISOString();
	assert.equal(isTimestampFreshEnough(fresh), true);
	const stale = new Date(Date.now() - COOK_HANDOFF_MAX_AGE_MS - 1000).toISOString();
	assert.equal(isTimestampFreshEnough(stale), false);
	assert.equal(isPendingHandoffFresh({ preparedAt: stale }), false);
});

test("synthesizeCookHandoff fail-closed without discussion context", () => {
	const result = synthesizeCookHandoff({});
	assert.equal(result.ok, false);
	assert.equal(result.fail_closed, true);
});

test("validateCookHandoffSchema rejects empty acceptance", () => {
	const capsule = normalizeCookHandoffCapsule({
		mission: "x",
		scope: ["src/"],
		acceptance: [],
	});
	const schema = validateCookHandoffSchema(capsule);
	assert.equal(schema.ok, false);
});
