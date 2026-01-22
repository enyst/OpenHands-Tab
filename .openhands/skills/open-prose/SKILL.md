---
name: open-prose
description: |
  OpenProse is a programming language for AI sessions. An AI session is a Turing-complete
  computer; OpenProse structures English into unambiguous control flow.

  OpenHands integration:
  - This repo vendors the OpenProse VM docs as your Skill.
  - When you see a `.prose` program, use `runner.md` for OpenHands-specific execution.
  - Use `prose.md` for core VM semantics and `docs.md` for syntax/validation.

  Activate when: running `.prose` files, mentioning OpenProse, or when a task is best expressed as an orchestrated multi-agent workflow.
---

# OpenProse Skill

OpenProse is a programming language for AI sessions. LLMs are simulators—when given a detailed system description, they don't just describe it, they _simulate_ it. The `prose.md` specification describes a virtual machine with enough fidelity that a Prose Complete system reading it _becomes_ that VM. Simulation with sufficient fidelity is implementation.

## When to Activate

Activate this skill when the user:

- Asks to run a `.prose` file
- Uses `prose run`, `prose compile`, or similar commands
- Mentions "OpenProse" or "prose program"
- Wants to orchestrate multiple AI agents from a script
- Has a file with `session "..."` or `agent name:` syntax
- Wants to create a reusable workflow

---

## OpenHands Execution Mode

**Important:** OpenHands does not have a Task tool for spawning subagents. Instead, use the **OpenHands runner** (`runner.md`) which adapts OpenProse for direct execution.

### Key Differences from Standard OpenProse

| Standard OpenProse | OpenHands Adaptation |
|--------------------|---------------------|
| `session` spawns subagent via Task tool | You execute the session directly |
| `parallel:` runs branches concurrently | Execute sequentially, track with `task_tracker` |
| Variables stored in files | Store in conversation context + `task_tracker` |
| Model selection (`model: opus`) | Uses current model |

### Running a .prose Program in OpenHands

1. **Load `runner.md`** — OpenHands-specific execution semantics
2. **Load `prose.md`** — Core VM concepts
3. **Parse the program** — Identify agents, blocks, statements
4. **Execute directly** — You are both VM and worker
5. **Track with `task_tracker`** — Maintain visibility into progress

---

## Documentation Files

| File        | Purpose                    | When to Read                                     |
| ----------- | -------------------------- | ------------------------------------------------ |
| `runner.md` | OpenHands execution        | **Always** for running programs in OpenHands     |
| `prose.md`  | Core VM semantics          | For understanding the execution model            |
| `docs.md`   | Full language spec         | For compilation, validation, or syntax questions |
| `patterns.md` | Best practices           | When authoring or reviewing programs             |
| `antipatterns.md` | Patterns to avoid    | When debugging or improving programs             |

### Typical Workflow

1. **Run**: Load `runner.md` + `prose.md`, execute the program
2. **Compile/Validate**: Load `docs.md` when asked to compile or when syntax is ambiguous
3. **Author**: Load `patterns.md` and `antipatterns.md` when writing new programs

## Quick Reference

### Sessions

```prose
session "Do something"                    # Simple session
session: myAgent                          # With agent
  prompt: "Task prompt"
  context: previousResult                 # Pass context
```

### Agents

```prose
agent researcher:
  model: sonnet                           # sonnet | opus | haiku
  prompt: "You are a research assistant"
```

### Variables

```prose
let result = session "Get result"         # Mutable
const config = session "Get config"       # Immutable
session "Use both"
  context: [result, config]               # Array form
  context: { result, config }             # Object form
```

### Parallel

```prose
parallel:
  a = session "Task A"
  b = session "Task B"
session "Combine" context: { a, b }
```

### Loops

```prose
repeat 3:                                 # Fixed
  session "Generate idea"

for topic in ["AI", "ML"]:                # For-each
  session "Research" context: topic

loop until **done** (max: 10):            # AI-evaluated
  session "Keep working"
```

### Error Handling

```prose
try:
  session "Risky" retry: 3
catch as err:
  session "Handle" context: err
```

### Conditionals

```prose
if **has issues**:
  session "Fix"
else:
  session "Approve"

choice **best approach**:
  option "Quick": session "Quick fix"
  option "Full": session "Refactor"
```

## Examples

The skill includes 10 example programs in the `examples/` directory:

| Example | Description |
|---------|-------------|
| `01-hello-world.prose` | Simplest program - a single session |
| `02-research-and-summarize.prose` | Research a topic, then summarize |
| `03-code-review.prose` | Multi-perspective code review |
| `05-debug-issue.prose` | Step-by-step debugging workflow |
| `09-research-with-agents.prose` | Custom agents with model selection |
| `13-variables-and-context.prose` | Variable bindings and context passing |
| `16-parallel-reviews.prose` | Parallel execution (sequential for now, parallel when we have remote agents) |
| `20-fixed-loops.prose` | Fixed iteration patterns |
| `22-error-handling.prose` | try/catch/finally patterns |
| `25-conditionals.prose` | if/elif/else patterns |

Start with `01-hello-world.prose` to see the basic structure.

> **More examples:** The [upstream OpenProse repository](https://github.com/openprose/prose/tree/main/skills/open-prose/examples) has 50+ examples.

## Execution

To execute a `.prose` file in OpenHands, you become the OpenProse VM with adaptations:

1. **Read `runner.md`** — OpenHands-specific execution semantics
2. **Read `prose.md`** — Core VM concepts and structure
3. **You ARE the VM** — your conversation is its memory, your tools are its instructions
4. **Execute directly** — each `session` is executed by you (no subagent spawning)
5. **Track with `task_tracker`** — use for parallel blocks, loops, and progress visibility
6. **Narrate state** — use the emoji protocol to track execution (📍, 📦, ✅, etc.)
7. **Evaluate intelligently** — `**...**` markers require your judgment

## Syntax at a Glance

```
session "prompt"              # Spawn subagent
agent name:                   # Define agent template
let x = session "..."         # Capture result
parallel:                     # Concurrent execution
repeat N:                     # Fixed loop
for x in items:               # Iteration
loop until **condition**:     # AI-evaluated loop
try: ... catch: ...           # Error handling
if **condition**: ...         # Conditional
choice **criteria**: option   # AI-selected branch
block name(params):           # Reusable block
do blockname(args)            # Invoke block
items | map: ...              # Pipeline
```

For complete syntax and validation rules, see `docs.md`.
