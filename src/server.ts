#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleLetscookTool } from "./tools/handler.ts";
import type { LetscookToolContext } from "./tools/context.ts";

const TOOLS = [
	{
		name: "get_cook_workspace_context",
		description: "Detect whether the current checkout is main or a linked worktree; includes isolation_confirm_required for main checkout",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				repo_root: { type: "string" },
			},
		},
	},
	{
		name: "resolve_cook_workspace",
		description:
			"Resolve workspace_root for /cook — main checkout is allowed; confirm_cook_handoff shows an isolation gate on main",
		inputSchema: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["auto", "cursor_native"] },
				workspace_root: { type: "string" },
				repo_root: { type: "string" },
			},
		},
	},
	{
		name: "finish_cook_workflow",
		description: "Return apply/delete worktree guidance after workflow completes (Cursor /apply-worktree, /delete-worktree)",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
			},
			required: ["workspace_root"],
		},
	},
	{
		name: "prepare_cook_handoff",
		description: "Validate and write cook_handoff JSON + pending sidecar in workspace_root",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				branch: { type: "string" },
				capsule: { type: "object" },
			},
			required: ["workspace_root", "capsule"],
		},
	},
	{
		name: "preview_cook_handoff_confirmation",
		description: "Return startup brief confirmation layout for chat review",
		inputSchema: {
			type: "object",
			properties: { workspace_root: { type: "string" } },
			required: ["workspace_root"],
		},
	},
	{
		name: "confirm_cook_handoff",
		description:
			"Show native handoff confirmation UI (MCP elicitation form when supported, otherwise AskQuestion fallback payload). On main checkout, offers start_on_main vs defer_worktree.",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				skip_elicitation: {
					type: "boolean",
					description: "Force AskQuestion fallback even when MCP elicitation is available",
				},
			},
			required: ["workspace_root"],
		},
	},
	{
		name: "start_cook_workflow",
		description: "Confirm handoff and scaffold .agent/ workflow state (Cursor-native, no Pi)",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				confirmation_id: { type: "string" },
				action: { type: "string", enum: ["start", "cancel"] },
				dry_run: { type: "boolean" },
			},
			required: ["workspace_root"],
		},
	},
	{
		name: "get_cook_handoff_status",
		description: "Handoff sidecar and workflow presence for workspace_root",
		inputSchema: {
			type: "object",
			properties: { workspace_root: { type: "string" } },
			required: ["workspace_root"],
		},
	},
	{
		name: "get_cook_handoff_schema",
		description: "Canonical cook_handoff capsule example",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_handoff_synthesis_prompt",
		description: "Return analyst prompt + contract for startup synthesis before prepare_cook_handoff",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				project_name: { type: "string" },
				discussion_summary: { type: "string" },
				inline_intent: { type: "string" },
				workflow_context_lines: { type: "array", items: { type: "string" } },
			},
		},
	},
	{
		name: "submit_startup_analysis",
		description: "Validate completion.startup.analysis.v1 JSON and return startable capsule + confirmation layout",
		inputSchema: {
			type: "object",
			properties: {
				project_name: { type: "string" },
				structured_analysis: { type: "object" },
			},
			required: ["structured_analysis"],
		},
	},
	{
		name: "synthesize_cook_handoff",
		description: "Fail-closed synthesis entry: inline intent, explicit capsule, plan capsule, or structured analysis",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				project_name: { type: "string" },
				discussion_summary: { type: "string" },
				inline_intent: { type: "string" },
				explicit_capsule: { type: "object" },
				plan_capsule: { type: "object" },
				structured_analysis: { type: "object" },
				workflow_context_lines: { type: "array", items: { type: "string" } },
			},
		},
	},
	{
		name: "validate_cook_handoff",
		description: "Independent cook_handoff schema and startability validation",
		inputSchema: {
			type: "object",
			properties: {
				capsule: { type: "object" },
				project_name: { type: "string" },
			},
			required: ["capsule"],
		},
	},
	{
		name: "list_cursor_plans",
		description: "List Cursor Plan mode files under .cursor/plans; optional plan_hint ranks by chat context",
		inputSchema: {
			type: "object",
			properties: {
				repo_root: { type: "string" },
				include_global: { type: "boolean", description: "Also scan ~/.cursor/plans" },
				plan_hint: {
					type: "string",
					description: "Short summary from recent chat to rank matching plans",
				},
			},
		},
	},
	{
		name: "preview_plan_to_cook_handoff",
		description: "Convert a saved Cursor .plan.md file into a cook_handoff capsule draft",
		inputSchema: {
			type: "object",
			properties: {
				plan_path: {
					type: "string",
					description: "Explicit path to .plan.md when known",
				},
				open_plan_path: {
					type: "string",
					description: "Path of a .plan.md file currently open in the editor",
				},
				plan_hint: {
					type: "string",
					description: "Summary from recent chat used to pick the matching plan",
				},
				repo_root: { type: "string" },
				overrides: {
					type: "object",
					description: "Optional partial cook_handoff fields to merge over mapped values",
				},
			},
		},
	},
	{
		name: "get_workflow_dispatch",
		description: "Read .agent/ and return the next mandatory completion role, cursor_agent name, and prompts",
		inputSchema: {
			type: "object",
			properties: { workspace_root: { type: "string" } },
			required: ["workspace_root"],
		},
	},
	{
		name: "submit_role_result",
		description: "Record a completed role output, update canonical state, and return the next dispatch",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				role: { type: "string" },
				raw_output: { type: "string" },
				ok: { type: "boolean" },
				structured: { type: "object" },
			},
			required: ["workspace_root", "role", "raw_output"],
		},
	},
	{
		name: "get_workflow_status",
		description: "Snapshot of active workflow from .agent/current",
		inputSchema: {
			type: "object",
			properties: { workspace_root: { type: "string" } },
			required: ["workspace_root"],
		},
	},
	{
		name: "poll_workflow_updates",
		description: "Poll workflow-events.jsonl deltas for chat monitoring",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				since_event_id: { type: "string" },
			},
			required: ["workspace_root"],
		},
	},
	{
		name: "park_workflow",
		description: "Park an active workflow for ordinary direct edits",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				reason: { type: "string" },
			},
			required: ["workspace_root"],
		},
	},
	{
		name: "resume_workflow",
		description: "Resume a parked workflow (routes through regrounder)",
		inputSchema: {
			type: "object",
			properties: { workspace_root: { type: "string" } },
			required: ["workspace_root"],
		},
	},
	{
		name: "cancel_workflow",
		description: "Cancel and close the active workflow",
		inputSchema: {
			type: "object",
			properties: {
				workspace_root: { type: "string" },
				reason: { type: "string" },
			},
			required: ["workspace_root"],
		},
	},
] as const;

async function main() {
	const server = new Server({ name: "letscook", version: "0.3.0" }, { capabilities: { tools: {} } });
	const toolContext: LetscookToolContext = {
		elicitInput: (params) => server.elicitInput(params),
		getClientCapabilities: () => server.getClientCapabilities(),
	};
	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const args = (request.params.arguments ?? {}) as Record<string, unknown>;
		return await handleLetscookTool(request.params.name, args, toolContext);
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
