import {
	assessMissionAnchor,
	extractCookHandoffProposalFromText,
	extractJsonObjectFromText,
	isWeakMissionAnchor,
	missionAnchorsStrictlyEquivalent,
	normalizeMissionAnchorText,
	stripCodeBlocks,
} from "./proposal.ts";
import { asString, asStringArray, isRecord } from "../../control-plane/state.ts";
import type { CookProposalDeps } from "./startup-intent.ts";

export { extractCookHandoffProposalFromText };

export function createProposalDeps(): CookProposalDeps {
	return {
		asString,
		asStringArray,
		assessMissionAnchor,
		normalizeMissionAnchorText,
		isWeakMissionAnchor,
		missionAnchorsStrictlyEquivalent,
		stripCodeBlocks,
	};
}

export function createAnalystDeps() {
	return {
		...createProposalDeps(),
		extractJsonObjectFromText,
		isRecord,
	};
}
