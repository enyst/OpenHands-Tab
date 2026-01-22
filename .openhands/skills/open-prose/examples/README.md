# OpenProse Examples for OpenHands

These examples demonstrate OpenProse workflows that work well with OpenHands' direct execution model.

> **Note:** In OpenHands, sessions are executed directly (no subagent spawning).
> See `runner.md` for OpenHands-specific execution semantics.

## Available Examples

### Basics

| File | Description |
|------|-------------|
| `01-hello-world.prose` | Simplest possible program - a single session |
| `02-research-and-summarize.prose` | Research a topic, then summarize findings |
| `03-code-review.prose` | Multi-perspective code review pipeline |
| `05-debug-issue.prose` | Step-by-step debugging workflow |

### Agents & Variables

| File | Description |
|------|-------------|
| `09-research-with-agents.prose` | Custom agents with model selection |
| `13-variables-and-context.prose` | let/const bindings, context passing |

### Control Flow

| File | Description |
|------|-------------|
| `16-parallel-reviews.prose` | Parallel execution pattern (sequential in OpenHands for now) |
| `20-fixed-loops.prose` | repeat, for-each patterns |
| `22-error-handling.prose` | try/catch/finally patterns |
| `25-conditionals.prose` | if/elif/else patterns |

## Running Examples

Ask the agent to run any example:

```
Run the hello world example from the OpenProse examples
```

Or reference the file directly:

```
Execute examples/01-hello-world.prose
```

## More Examples

The [upstream OpenProse repository](https://github.com/openprose/prose/tree/main/skills/open-prose/examples) has 50+ additional examples including orchestration systems, production workflows, and advanced patterns. Note that some of those rely on features (true parallel execution, subagent spawning) that aren't available in OpenHands.

## Quick Syntax Reference

```prose
# Comments
session "prompt"                    # Simple session
let x = session "..."               # Variable binding

# Agents
agent name:
  model: sonnet                     # haiku, sonnet, opus
  prompt: "System prompt"

# Loops
repeat 3:                           # Fixed iterations
  session "..."

for item in items:                  # For-each
  session "..."

loop until **condition** (max: 10): # Unbounded with AI condition
  session "..."

# Error handling
try:
  session "..."
catch as err:
  session "..."

# Conditionals
if **condition**:
  session "..."
else:
  session "..."
```

See `docs.md` in the skill directory for the complete language specification.
