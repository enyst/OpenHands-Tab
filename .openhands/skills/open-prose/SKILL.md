---
name: open-prose
description: |
  OpenProse is a programming language for AI sessions. An AI session is a Turing-complete
  computer; OpenProse structures English into unambiguous control flow.

  OpenHands-Tab integration:
  - This repo vendors the OpenProse VM docs as an AgentSkills-format skill.
  - When you see a `.prose` program, use `prose.md` for execution semantics and `docs.md` for syntax/validation.

  Activate when: running `.prose` files, mentioning OpenProse, or when a task is best expressed as an orchestrated multi-agent workflow.
---

# OpenProse Skill

OpenProse is a programming language for AI sessions. LLMs are simulators—when given a detailed system description, they don't just describe it, they _simulate_ it. The `prose.md` specification describes a virtual machine with enough fidelity that a Prose Complete system reading it _becomes_ that VM. Simulation with sufficient fidelity is implementation.

## When to Activate

Activate this skill when the user:

- Asks to run a `.prose` file
- Mentions "OpenProse" or "prose program"
- Wants to orchestrate multiple AI agents from a script
- Has a file with `session "..."` or `agent name:` syntax
- Wants to create a reusable workflow

---

## Documentation Files

| File       | Purpose             | When to Read                                     |
| ---------- | ------------------- | ------------------------------------------------ |
| `prose.md` | Execution semantics | Always read for running programs                 |
| `docs.md`  | Full language spec  | For compilation, validation, or syntax questions |

### Typical Workflow

1. **Interpret**: Read `prose.md` to execute a valid program
2. **Compile/Validate**: Read `docs.md` when asked to compile or when syntax is ambiguous

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

The plugin ships with 27 examples in the `examples/` directory:

- **01-08**: Basics (hello world, research, code review, debugging)
- **09-12**: Agents and skills
- **13-15**: Variables and composition
- **16-19**: Parallel execution
- **20**: Fixed loops
- **21**: Pipeline operations
- **22-23**: Error handling
- **24-27**: Advanced (choice, conditionals, blocks, interpolation)

Start with `01-hello-world.prose` or `03-code-review.prose`.

## Execution

To execute a `.prose` file, you become the OpenProse VM:

1. **Read `prose.md`** — this document defines how you embody the VM
2. **You ARE the VM** — your conversation is its memory, your tools are its instructions
3. **Spawn sessions** — each `session` statement triggers a Task tool call
4. **Narrate state** — use the emoji protocol to track execution (📍, 📦, ✅, etc.)
5. **Evaluate intelligently** — `**...**` markers require your judgment

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
