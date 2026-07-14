#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleLetscookTool } from "./tools/handler.ts";

const TOOLS = [
	{
		name: "ensure_cook_worktree",
		description: "Create or resolve a dedicated cook git worktree under .worktrees/cook-<slug>/",
		inputSchema: {
			type: "object",
			properties: {
				repo_root: { type: "string" },
				branch: { type: "string" },
				slug: { type: "string" },
				base_ref: { type: "string" },
			},
			required: ["slug"],
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
		name: "get_workflow_dispatch",
		description: "Read .agent/ and return the next mandatory completion role + prompts for a Cursor subagent",
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
	const server = new Server({ name: "letscook", version: "0.1.0" }, { capabilities: { tools: {} } });
	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const args = (request.params.arguments ?? {}) as Record<string, unknown>;
		return await handleLetscookTool(request.params.name, args);
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
