import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";

export type LetscookToolContext = {
	elicitInput?: (params: ElicitRequestFormParams) => Promise<ElicitResult>;
	getClientCapabilities?: () => { elicitation?: { form?: unknown } } | undefined;
};
