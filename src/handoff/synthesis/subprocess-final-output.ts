import { STRUCTURED_CONTRACTS, getStructuredContract, type StructuredContractParseResult } from "../structured-contracts.ts";
import type { JsonRecord } from "./completion-types.ts";

export type SubprocessFinalOutputSource = "structured_tool";

export type SubprocessFinalOutputResult<T = unknown> = {
	source: SubprocessFinalOutputSource;
	contractId: string;
	payload?: T;
	humanText?: string;
	diagnostics: string[];
};

export type ExtractSubprocessFinalOutputArgs = {
	eventLines?: string[];
	contractId: string;
	assistantText?: string;
};

export class StructuredSubprocessOutputError extends Error {
	readonly contractId: string;
	readonly diagnostics: string[];

	constructor(message: string, contractId: string, diagnostics: string[] = []) {
		super(message);
		this.name = "StructuredSubprocessOutputError";
		this.contractId = contractId;
		this.diagnostics = diagnostics;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): JsonRecord | undefined {
	try {
		const parsed = JSON.parse(line);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

const STRUCTURED_TERMINATING_TOOL_NAMES = new Set(
	Object.values(STRUCTURED_CONTRACTS).map((contract) => contract.terminatingToolName),
);
const MAX_LIVE_EVENT_PARSE_CHARS = 1_000_000;

function hasJsonStringFieldText(line: string, fieldName: string, value: string): boolean {
	return line.includes(`"${fieldName}":"${value}"`) || line.includes(`"${fieldName}": "${value}"`);
}

function hasStructuredTerminatingToolResultText(line: string): boolean {
	const trimmed = line.trimStart();
	if (!trimmed.startsWith("{")) return false;
	if (!hasJsonStringFieldText(trimmed, "type", "tool_execution_end")) return false;
	for (const toolName of STRUCTURED_TERMINATING_TOOL_NAMES) {
		if (hasJsonStringFieldText(trimmed, "toolName", toolName)) return true;
	}
	return false;
}

export function shouldParseSubprocessEventLine(line: string): boolean {
	return line.length <= MAX_LIVE_EVENT_PARSE_CHARS || hasStructuredTerminatingToolResultText(line);
}

export function shouldRetainSubprocessFinalOutputEvent(event: JsonRecord): boolean {
	return asString(event.type) === "tool_execution_end" && STRUCTURED_TERMINATING_TOOL_NAMES.has(asString(event.toolName) ?? "");
}

export function shouldRetainSubprocessFinalOutputLine(line: string): boolean {
	const event = parseJsonLine(line);
	return event ? shouldRetainSubprocessFinalOutputEvent(event) : false;
}

function humanTextFromToolResult(result: unknown): string | undefined {
	if (!isRecord(result)) return undefined;
	const content = result.content;
	if (!Array.isArray(content)) return undefined;
	const parts: string[] = [];
	for (const item of content) {
		if (isRecord(item) && item.type === "text" && typeof item.text === "string") parts.push(item.text);
	}
	const joined = parts.join("\n").trim();
	return joined.length > 0 ? joined : undefined;
}

export function scanTerminatingToolPayload(
	eventLines: string[],
	terminatingToolName: string,
): { details?: unknown; humanText?: string; isError?: boolean } | undefined {
	let lastMatch: { details?: unknown; humanText?: string; isError?: boolean } | undefined;
	for (const line of eventLines) {
		const event = parseJsonLine(line);
		if (!event) continue;
		if (asString(event.type) !== "tool_execution_end") continue;
		if (asString(event.toolName) !== terminatingToolName) continue;
		const result = event.result;
		if (!isRecord(result)) continue;
		lastMatch = {
			details: result.details,
			humanText: humanTextFromToolResult(result),
			isError: result.isError === true,
		};
	}
	return lastMatch;
}

function parseStructuredPayload<T>(contractId: string, details: unknown): StructuredContractParseResult<T> {
	const contract = getStructuredContract(contractId);
	if (!contract) return { ok: false, errors: [`unknown structured contract: ${contractId}`] };
	return contract.parseDetails(details) as StructuredContractParseResult<T>;
}

export function extractSubprocessFinalOutput<T>(args: ExtractSubprocessFinalOutputArgs): SubprocessFinalOutputResult<T> {
	const diagnostics: string[] = [];
	const contract = getStructuredContract(args.contractId);
	if (!contract) {
		diagnostics.push(`unknown structured contract: ${args.contractId}`);
		return { source: "structured_tool", contractId: args.contractId, diagnostics };
	}

	const toolMatch = scanTerminatingToolPayload(args.eventLines ?? [], contract.terminatingToolName);
	if (toolMatch?.isError) diagnostics.push(`terminating tool ${contract.terminatingToolName} returned isError=true`);
	if (toolMatch?.details === undefined) {
		diagnostics.push(`missing terminating tool result for ${contract.terminatingToolName}`);
		return { source: "structured_tool", contractId: args.contractId, diagnostics };
	}

	const parsed = parseStructuredPayload<T>(args.contractId, toolMatch.details);
	if (!parsed.ok) {
		diagnostics.push(...parsed.errors);
		return { source: "structured_tool", contractId: args.contractId, diagnostics };
	}

	return {
		source: "structured_tool",
		contractId: args.contractId,
		payload: parsed.payload,
		humanText: toolMatch.humanText ?? args.assistantText,
		diagnostics,
	};
}

export function hasSubprocessFinalOutput(args: ExtractSubprocessFinalOutputArgs): boolean {
	return extractSubprocessFinalOutput(args).payload !== undefined;
}

export function requireSubprocessFinalOutput<T>(args: ExtractSubprocessFinalOutputArgs): { payload: T; humanText?: string } {
	const result = extractSubprocessFinalOutput<T>(args);
	if (result.payload !== undefined) {
		return { payload: result.payload, humanText: result.humanText };
	}
	throw new StructuredSubprocessOutputError(
		result.diagnostics.join("; ") || `missing structured output for ${args.contractId}`,
		args.contractId,
		result.diagnostics,
	);
}
