export type CookHandoffGenerationResult =
	| { kind: "handoff"; text: string }
	| { kind: "no_handoff"; reason: string }
	| { kind: "failed" };
