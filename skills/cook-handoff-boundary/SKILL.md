---
name: cook-handoff-boundary
description: Ordinary-chat contract for treating `/cook` as an optional workflow mode while requiring `/cook` to synthesize a fresh primary-agent startup handoff and fail closed when that handoff is not startable.
---

# /cook Handoff Boundary

Load or summarize this contract when the primary agent is operating in ordinary main chat before the user has explicitly entered `/cook`.

This skill governs the relationship between:

- ordinary main-chat discussion and direct implementation
- optional transition into long-running completion workflow through `/cook`

## Core Contract

- Ordinary chat may be used to clarify requirements, discuss tradeoffs, refine scope, and directly implement requested repo changes.
- `/cook` is an explicit workflow entrypoint for users who want resumability, review, audit, or canonical `.agent/**` workflow state.
- `/cook` is optional. It is not required just because the work spans multiple files or looks substantial.
- Ordinary chat remains ordinary chat until the user explicitly chooses `/cook`.

## What Ordinary Chat May Do

The primary agent may:

- answer follow-up questions
- discuss tradeoffs
- refine scope and constraints
- summarize likely mission, acceptance, or risks
- directly edit repo files when that is the most helpful response
- complete multi-file implementation in ordinary chat when workflow state is unnecessary

The primary agent should not:

- proactively tell the user to run `/cook` just because the task looks workflow-worthy
- proactively emit a `cook_handoff` capsule by default
- load or follow `completion-protocol` while still in ordinary chat
- call `completion_role` before the user has explicitly entered `/cook`
- act as though workflow has already started when it has not
- silently rewrite ordinary-chat discussion into canonical workflow state

## When `/cook` Is Helpful

The primary agent may mention `/cook` as an optional tool when it would genuinely help, for example when:

- the work should be resumable across sessions
- the user wants a tracked mission in canonical `.agent/**` state
- the task benefits from explicit review / audit / stop-wave flow
- the user wants a confirm-first workflow boundary before a long-running effort

But even in those cases:

- do not force `/cook`
- do not frame `/cook` as mandatory for direct repo edits
- continue helping directly in ordinary chat unless the user explicitly chooses workflow mode

## Required Behavior When The User Explicitly Chooses `/cook`

If the user explicitly runs or clearly chooses `/cook` workflow mode, the system behavior should be:

1. call a primary-agent handoff synthesis step immediately from the current task context
2. if `/cook` includes inline prompt text, treat that inline prompt as the highest-priority startup intent for the synthesis step
3. if no primary-agent-generated handoff is startable, fail closed without rewriting canonical workflow state
4. use the resulting startup brief to show Start / Cancel confirmation in the same `/cook` entry
5. after Start, persist a canonical startup brief in `.agent/**` and treat workflow entry as active
6. let `completion-regrounder` turn that startup brief plus repo truth into canonical slices

That means:

- `/cook` should synthesize a fresh primary-agent startup handoff for the current entry instead of consuming an older session capsule directly
- `/cook` must fail closed when primary-agent synthesis cannot produce a startable handoff
- `/cook` should persist the confirmed startup brief before regrounding begins
- `/cook` should not require a manual rerun just to consume a handoff it can synthesize immediately from the primary-agent view

## Optional Preview Behavior

Only if the user explicitly asks for a preview startup brief or handoff capsule in ordinary chat may the primary agent provide one.

Optional preview capsule format:

````text
```cook_handoff
{
  "kind": "cook_handoff",
  "source": "primary_agent",
  "captured_at": "<ISO-8601 timestamp>",
  "source_turn_id": "<current assistant turn id>",
  "mission": "<workflow-startable implementation mission>",
  "scope": ["..."],
  "constraints": ["..."],
  "non_goals": ["..."],
  "acceptance": ["..."],
  "risks": ["..."],
  "notes": ["..."],
  "handoff_kind": "implementation_workflow_handoff",
  "first_slice_goal": "<optional bounded first slice hint>",
  "first_slice_non_goals": ["..."],
  "implementation_surfaces": ["path/or/surface"],
  "verification_commands": ["npm test -- example"],
  "why_this_slice_first": "<optional why this first slice should start the workflow>",
  "task_type": "completion-workflow",
  "evaluation_profile": "completion-rubric-v1",
  "why_cook_now": "<why the task is ready for /cook now>"
}
```
````

Notes:

- `constraints` may be replaced or supplemented by `non_goals` when clearer.
- `first_slice_goal`, `first_slice_non_goals`, `implementation_surfaces`, `verification_commands`, and `why_this_slice_first` are optional startup hints. Include them when they are clearly supported, but do not treat them as required before `/cook` can start workflow.
- Any capsule is illustrative preview material only. `/cook` still synthesizes the actual startup handoff for the current entry, and the preview is not canonical `.agent/**` state, not active-slice state, and not a second repo contract source.

Suggested wording:

> We can continue directly in ordinary chat if you want. If you prefer workflow mode, run `/cook` and it should synthesize a fresh primary-agent startup brief for that entry. If synthesis still cannot produce a startable handoff, `/cook` should fail closed until the mission is clarified in main chat. Any first-slice details are only hints until regrounding authors the canonical slices.

## Forbidden Behaviors

Before the user explicitly runs `/cook`, the primary agent must not:

- pretend `/cook` has already been invoked
- load or follow `completion-protocol`
- call `completion_role` or any completion subagent
- silently rewrite ordinary-chat discussion into active workflow state
- claim canonical `.agent/**` startup state exists when it does not
- refuse ordinary-chat implementation solely because `/cook` would also be possible

When the user does explicitly choose `/cook`, the system must not:

- let `/cook` replace a missing startup handoff with generic transcript guessing
- rewrite canonical workflow state when primary-agent synthesis has not produced a startable handoff
- require a second `/cook` invocation when same-entry primary-agent handoff synthesis is possible

## Relationship To `completion-protocol`

This skill is only about pre-`/cook` ordinary-chat behavior and `/cook` handoff expectations.

After the user explicitly enters `/cook`, the separate `completion-protocol` skill governs:

- canonical `.agent/**` workflow state
- workflow-driver behavior
- mandatory completion-role dispatch
- review, audit, and stop-wave rules
