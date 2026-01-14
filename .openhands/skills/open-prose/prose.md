---
role: execution-semantics
summary: |
  How to execute OpenProse programs. You embody the OpenProse VM—a virtual machine that
  spawns sessions via the Task tool, manages state in working memory, and coordinates
  parallel execution. Read this file to run .prose programs.
see-also:
  - SKILL.md: Activation triggers, onboarding, telemetry
  - docs.md: Full syntax grammar, validation rules, compilation
---

# OpenProse VM

This document defines how to execute OpenProse programs. You are the OpenProse VM—an intelligent virtual machine that spawns subagent sessions according to a structured program.

## Why This Is a VM

Large language models are simulators. When given a detailed description of a system, they don't just *describe* that system—they *simulate* it. This document leverages that property: it describes a virtual machine with enough specificity that reading it causes a Prose Complete system to simulate that VM.

But simulation with sufficient fidelity *is* implementation. When the simulated VM spawns real subagents, produces real artifacts, and maintains real state, the distinction between "simulating a VM" and "being a VM" collapses.

### Component Mapping

A traditional VM has concrete components. The OpenProse VM has analogous structures that emerge from the simulation:

| Traditional VM | OpenProse VM | Substrate |
|----------------|--------------|-----------|
| Instructions | `.prose` statements | Executed via tool calls (Task) |
| Program counter | Execution position | Tracked via narration (`📍 Statement 3 of 7`) |
| Working memory | Conversation history | The context window holds ephemeral state |
| Persistent storage | `.prose/` directory | Files hold durable state across sessions |
| Call stack | Block invocation chain | Tracked via narration protocol |
| Registers/variables | Named bindings | `📦 let research = <value>` |
| I/O | Tool calls and results | Task spawns sessions, returns outputs |

### What Makes It Real

The OpenProse VM isn't a metaphor. Each `session` statement triggers a *real* Task tool call that spawns a *real* subagent. The outputs are *real* artifacts. The simulation produces actual computation—it just happens through a different substrate than silicon executing bytecode.

---

## Embodying the VM

When you execute a `.prose` program, you ARE the virtual machine. This is not a metaphor—it's a mode of operation:

| You | The VM |
|-----|--------|
| Your conversation history | The VM's working memory |
| Your tool calls (Task) | The VM's instruction execution |
| Your narration (emoji markers) | The VM's execution trace |
| Your judgment on `**...**` | The VM's intelligent evaluation |

**What this means in practice:**
- You don't *simulate* execution—you *perform* it
- Each `session` spawns a real subagent via the Task tool
- Your state persists in what you say (narration protocol)
- You follow the program structure strictly, but apply intelligence where marked

### The VM as Intelligent Container

Traditional dependency injection containers wire up components from configuration. You do the same—but with understanding:

| Declared Primitive | Your Responsibility |
|--------------------|---------------------|
| `use "@handle/slug" as name` | Fetch program from p.prose.md, register in Import Registry |
| `input topic: "..."` | Bind value from caller, make available as variable |
| `output findings = ...` | Mark value as output, return to caller on completion |
| `agent researcher:` | Register this agent template for later use |
| `session: researcher` | Resolve the agent, merge properties, spawn the session |
| `context: { a, b }` | Wire the outputs of `a` and `b` into this session's input |
| `parallel:` branches | Coordinate concurrent execution, collect results |
| `block review(topic):` | Store this reusable component, invoke when called |
| `name(input: value)` | Invoke imported program with inputs, receive outputs |

You are the container that holds these declarations and wires them together at runtime. The program declares *what*; you determine *how* to connect them.

---

## The Execution Model

OpenProse treats an AI session as a Turing-complete computer. You are the OpenProse VM:

1. **You are the VM** - Parse and execute each statement
2. **Sessions are function calls** - Each `session` spawns a subagent via the Task tool
3. **Context is memory** - Variable bindings hold session outputs
4. **Control flow is explicit** - Follow the program structure exactly

### Core Principle

The OpenProse VM follows the program structure **strictly** but uses **intelligence** for:
- Evaluating discretion conditions (`**...**`)
- Determining when a session is "complete"
- Transforming context between sessions

---

## Syntax Grammar (Condensed)

```
program     := statement*

statement   := useStatement | inputDecl | agentDef | session | letBinding
             | constBinding | assignment | outputBinding | parallelBlock
             | repeatBlock | forEachBlock | loopBlock | tryBlock | choiceBlock
             | ifStatement | doBlock | blockDef | throwStatement | comment

# Program Composition
useStatement := "use" STRING ("as" NAME)?
inputDecl   := "input" NAME ":" STRING
outputBinding := "output" NAME "=" expression

# Definitions
agentDef    := "agent" NAME ":" INDENT property* DEDENT
blockDef    := "block" NAME params? ":" INDENT statement* DEDENT
params      := "(" NAME ("," NAME)* ")"

# Sessions
session     := "session" (STRING | ":" NAME) properties?
properties  := INDENT property* DEDENT
property    := "model:" ("sonnet" | "opus" | "haiku")
             | "prompt:" STRING
             | "context:" (NAME | "[" NAME* "]" | "{" NAME* "}")
             | "retry:" NUMBER
             | "backoff:" ("none" | "linear" | "exponential")
             | "skills:" "[" STRING* "]"
             | "permissions:" INDENT permission* DEDENT

# Bindings
letBinding  := "let" NAME "=" expression
constBinding:= "const" NAME "=" expression
assignment  := NAME "=" expression

# Control Flow
parallelBlock := "parallel" modifiers? ":" INDENT branch* DEDENT
modifiers   := "(" (strategy | "on-fail:" policy | "count:" N)* ")"
strategy    := "all" | "first" | "any"
policy      := "fail-fast" | "continue" | "ignore"
branch      := (NAME "=")? statement

repeatBlock := "repeat" N ("as" NAME)? ":" INDENT statement* DEDENT
forEachBlock:= "parallel"? "for" NAME ("," NAME)? "in" collection ":" INDENT statement* DEDENT
loopBlock   := "loop" condition? ("(" "max:" N ")")? ("as" NAME)? ":" INDENT statement* DEDENT
condition   := ("until" | "while") discretion

# Error Handling
tryBlock    := "try:" INDENT statement* DEDENT catch? finally?
catch       := "catch" ("as" NAME)? ":" INDENT statement* DEDENT
finally     := "finally:" INDENT statement* DEDENT
throwStatement := "throw" STRING?

# Conditionals
choiceBlock := "choice" discretion ":" INDENT option* DEDENT
option      := "option" STRING ":" INDENT statement* DEDENT
ifStatement := "if" discretion ":" INDENT statement* DEDENT elif* else?
elif        := "elif" discretion ":" INDENT statement* DEDENT
else        := "else:" INDENT statement* DEDENT

# Composition
doBlock     := "do" (":" INDENT statement* DEDENT | NAME args?)
args        := "(" expression* ")"
arrowExpr   := session "->" session ("->" session)*
programCall := NAME "(" (NAME ":" expression)* ")"

# Pipelines
pipeExpr    := collection ("|" pipeOp)+
pipeOp      := ("map" | "filter" | "pmap") ":" INDENT statement* DEDENT
             | "reduce" "(" NAME "," NAME ")" ":" INDENT statement* DEDENT

# Primitives
discretion  := "**" TEXT "**" | "***" TEXT "***"
STRING      := '"' ... '"' | '"""' ... '"""'
collection  := NAME | "[" expression* "]"
comment     := "#" TEXT
```

---

## Spawning Sessions

Each `session` statement spawns a subagent using the **Task tool**:

```
session "Analyze the codebase"
```

Execute as:
```
Task({
  description: "OpenProse session",
  prompt: "Analyze the codebase",
  subagent_type: "general-purpose"
})
```

### With Agent Configuration

```
agent researcher:
  model: opus
  prompt: "You are a research expert"

session: researcher
  prompt: "Research quantum computing"
```

Execute as:
```
Task({
  description: "OpenProse session",
  prompt: "Research quantum computing\n\nSystem: You are a research expert",
  subagent_type: "general-purpose",
  model: "opus"
})
```

### Property Precedence

Session properties override agent defaults:
1. Session-level `model:` overrides agent `model:`
2. Session-level `prompt:` replaces (not appends) agent `prompt:`
3. Agent `prompt:` becomes system context if session has its own prompt

---

## Parallel Execution

`parallel:` blocks spawn multiple sessions concurrently:

```prose
parallel:
  a = session "Task A"
  b = session "Task B"
  c = session "Task C"
```

Execute by calling Task multiple times in parallel:
```
// All three spawn simultaneously
Task({ prompt: "Task A", ... })  // result -> a
Task({ prompt: "Task B", ... })  // result -> b
Task({ prompt: "Task C", ... })  // result -> c
// Wait for all to complete, then continue
```

### Join Strategies

| Strategy | Behavior |
|----------|----------|
| `"all"` (default) | Wait for all branches |
| `"first"` | Return on first completion, cancel others |
| `"any"` | Return on first success |
| `"any", count: N` | Wait for N successes |

### Failure Policies

| Policy | Behavior |
|--------|----------|
| `"fail-fast"` (default) | Fail immediately on any error |
| `"continue"` | Wait for all, then report errors |
| `"ignore"` | Treat failures as successes |

---

## Evaluating Discretion Conditions

Discretion markers (`**...**`) signal AI-evaluated conditions:

```prose
loop until **the code is bug-free**:
  session "Find and fix bugs"
```

### Evaluation Approach

1. **Context awareness**: Consider all prior session outputs
2. **Semantic interpretation**: Understand the intent, not literal parsing
3. **Conservative judgment**: When uncertain, continue iterating
4. **Progress detection**: Exit if no meaningful progress is being made

### Multi-line Conditions

```prose
if ***
  the tests pass
  and coverage exceeds 80%
  and no linting errors
***:
  session "Deploy"
```

Triple-asterisks allow complex, multi-line conditions.

---

## Context Passing

Variables capture session outputs and pass them to subsequent sessions:

```prose
let research = session "Research the topic"

session "Write summary"
  context: research
```

### Context Forms

| Form | Usage |
|------|-------|
| `context: var` | Single variable |
| `context: [a, b, c]` | Multiple variables as array |
| `context: { a, b, c }` | Multiple variables as named object |
| `context: []` | Empty context (fresh start) |

### How Context is Passed

When spawning a session with context:
1. Include the referenced variable values in the prompt
2. Format appropriately (summarize if needed)
3. The subagent receives this as additional information

Example execution:
```
// research = "Quantum computing uses qubits..."

Task({
  prompt: "Write summary\n\nContext:\nresearch: Quantum computing uses qubits...",
  ...
})
```

---

## Program Composition

Programs can import and invoke other programs, enabling modular workflows. Programs are fetched from the registry at `p.prose.md`.

### Importing Programs

Use the `use` statement to import a program:

```prose
use "@alice/research"
use "@bob/critique" as critic
```

The import path follows the format `@handle/slug`. An optional alias (`as name`) allows referencing by a shorter name.

### Program URL Resolution

When the VM encounters a `use` statement:
1. Fetch the program from `https://p.prose.md/@handle/slug`
2. Parse the program to extract its contract (inputs/outputs)
3. Register the program in the Import Registry

### Input Declarations

Inputs declare what values a program expects from its caller:

```prose
input topic: "The subject to research"
input depth: "How deep to go (shallow, medium, deep)"
```

Inputs:
- Are declared at the top of the program (before executable statements)
- Have a name and a description (for documentation)
- Become available as variables within the program body
- Must be provided by the caller when invoking the program

### Output Bindings

Outputs declare what values a program produces for its caller. Use the `output` keyword at assignment time:

```prose
let raw = session "Research {topic}"
output findings = session "Synthesize research"
  context: raw
output sources = session "Extract sources"
  context: raw
```

The `output` keyword:
- Marks a variable as an output (visible at assignment, not just at file top)
- Works like `let` but also registers the value as a program output
- Can appear anywhere in the program body
- Multiple outputs are supported

### Invoking Imported Programs

Call an imported program by providing its inputs:

```prose
use "@alice/research" as research

let result = research(topic: "quantum computing")
```

The result contains all outputs from the invoked program, accessible as properties:

```prose
session "Write summary"
  context: result.findings

session "Cite sources"
  context: result.sources
```

### Destructuring Outputs

For convenience, outputs can be destructured:

```prose
let { findings, sources } = research(topic: "quantum computing")
```

### Complete Composition Example

A program that chains research and critique:

```prose
# research-loop.prose
use "@alice/research" as research
use "@alice/critique" as critic

input topic: "What to investigate"

# Iterate until quality is high
let result
loop until **critique score >= 8** (max: 3):
  result = research(topic: topic)
  review = critic(content: result.findings)

output findings = result.findings
output sources = result.sources
output final_score = review.score
```

Invoking this composed program:

```prose
use "@bob/research-loop" as deep_research

let final = deep_research(topic: "AI safety")
session "Present findings"
  context: final.findings
```

### Import Execution Semantics

When a program invokes an imported program:

1. **Bind inputs**: Map caller-provided values to the imported program's inputs
2. **Execute**: Run the imported program (spawns its own sessions)
3. **Collect outputs**: Gather all `output` bindings from the imported program
4. **Return**: Make outputs available to the caller as a result object

The imported program runs in its own execution context but shares the same VM session.

---

## Loop Execution

### Fixed Loops

```prose
repeat 3:
  session "Generate idea"
```

Execute the body exactly 3 times sequentially.

```prose
for topic in ["AI", "ML", "DL"]:
  session "Research"
    context: topic
```

Execute once per item, with `topic` bound to each value.

### Parallel For-Each

```prose
parallel for item in items:
  session "Process"
    context: item
```

Fan-out: spawn all iterations concurrently, wait for all.

### Unbounded Loops

```prose
loop until **task complete** (max: 10):
  session "Work on task"
```

1. Check condition before each iteration
2. Exit if condition satisfied OR max reached
3. Execute body if continuing

---

## Error Propagation

### Try/Catch Semantics

```prose
try:
  session "Risky operation"
catch as err:
  session "Handle error"
    context: err
finally:
  session "Cleanup"
```

Execution order:
1. **Success**: try -> finally
2. **Failure**: try (until fail) -> catch -> finally

### Throw Behavior

- `throw` inside catch: re-raise to outer handler
- `throw "message"`: raise new error with message
- Unhandled throws: propagate to outer scope or fail program

### Retry Mechanism

```prose
session "Flaky API"
  retry: 3
  backoff: "exponential"
```

On failure:
1. Retry up to N times
2. Apply backoff delay between attempts
3. If all retries fail, propagate error

---

## State Tracking

OpenProse supports two state management systems. The OpenProse VM must track execution state to correctly manage variables, loops, parallel branches, and error handling.

### State Categories

| Category | What to Track | Example |
|----------|---------------|---------|
| **Import Registry** | Imported programs and aliases | `research: @alice/research` |
| **Agent Registry** | All agent definitions | `researcher: {model: sonnet, prompt: "..."}` |
| **Block Registry** | All block definitions (hoisted) | `review: {params: [topic], body: [...]}` |
| **Input Bindings** | Inputs received from caller | `topic = "quantum computing"` |
| **Output Bindings** | Outputs to return to caller | `findings = "Research shows..."` |
| **Variable Bindings** | Name → value mapping | `research = "AI safety covers..."` |
| **Variable Mutability** | Which are `let` vs `const` vs `output` | `research: let, findings: output` |
| **Execution Position** | Current statement index | Statement 3 of 7 |
| **Loop State** | Counter, max, condition | Iteration 2 of max 5 |
| **Parallel State** | Branches, results, strategy | `{a: complete, b: pending}` |
| **Error State** | Exception, retry count | Retry 2 of 3, error: "timeout" |
| **Call Stack** | Nested block/program invocations | `[main, @alice/research, inner-loop]` |

---

## State Management: In-Context (Default)

The default approach uses **structured narration** in the conversation history. The OpenProse VM "thinks aloud" to persist state—what you say becomes what you remember.

### The Narration Protocol

Use emoji-prefixed markers for each state change:

| Emoji | Category | Usage |
|-------|----------|-------|
| 📋 | Program | Start, end, definition collection |
| 📍 | Position | Current statement being executed |
| 📦 | Binding | Variable assignment or update |
| 📥 | Input | Receiving inputs from caller |
| 📤 | Output | Producing outputs for caller |
| 🔗 | Import | Fetching and invoking imported programs |
| ✅ | Success | Session or block completion |
| ⚠️ | Error | Failures and exceptions |
| 🔀 | Parallel | Entering, branch status, joining |
| 🔄 | Loop | Iteration, condition evaluation |
| 🔗 | Pipeline | Stage progress |
| 🛡️ | Error handling | Try/catch/finally |
| ➡️ | Flow | Condition evaluation results |

### Narration Patterns by Construct

#### Session Statements
```
📍 Executing: session "Research the topic"
   [Task tool call]
✅ Session complete: "Research found that..."
📦 let research = <result>
```

#### Parallel Blocks
```
🔀 Entering parallel block (3 branches, strategy: all)
   - security: pending
   - perf: pending
   - style: pending
   [Multiple Task calls]
🔀 Parallel complete:
   - security = "No vulnerabilities found..."
   - perf = "Performance is acceptable..."
   - style = "Code follows conventions..."
📦 security, perf, style bound
```

#### Loop Blocks
```
🔄 Starting loop until **task complete** (max: 5)

🔄 Iteration 1 of max 5
   📍 session "Work on task"
   ✅ Session complete
   🔄 Evaluating: **task complete**
   ➡️ Not satisfied, continuing

🔄 Iteration 2 of max 5
   📍 session "Work on task"
   ✅ Session complete
   🔄 Evaluating: **task complete**
   ➡️ Satisfied!

🔄 Loop exited: condition satisfied at iteration 2
```

#### Error Handling
```
🛡️ Entering try block
📍 session "Risky operation"
⚠️ Session failed: connection timeout
📦 err = {message: "connection timeout"}
🛡️ Executing catch block
📍 session "Handle error" with context: err
✅ Recovery complete
🛡️ Executing finally block
📍 session "Cleanup"
✅ Cleanup complete
```

#### Variable Bindings
```
📦 let research = "AI safety research covers..." (mutable)
📦 const config = {model: "opus"} (immutable)
📦 research = "Updated research..." (reassignment, was: "AI safety...")
```

#### Input/Output Bindings
```
📥 Inputs received:
   topic = "quantum computing" (from caller)
   depth = "deep" (from caller)

📤 output findings = "Research shows..." (will return to caller)
📤 output sources = ["arxiv:2401.1234", ...] (will return to caller)
```

#### Program Imports
```
🔗 Importing: @alice/research
   Fetching from: https://p.prose.md/@alice/research
   Inputs expected: [topic, depth]
   Outputs provided: [findings, sources]
   Registered as: research

🔗 Invoking: research(topic: "quantum computing")
   📥 Passing inputs:
      topic = "quantum computing"

   [... imported program execution ...]

   📤 Received outputs:
      findings = "Quantum computing uses..."
      sources = ["arxiv:2401.1234"]

🔗 Import complete: research
📦 result = { findings: "...", sources: [...] }
```

### Context Serialization

When passing context to sessions, format appropriately:

| Context Size | Strategy |
|--------------|----------|
| < 2000 chars | Pass verbatim |
| 2000-8000 chars | Summarize to key points |
| > 8000 chars | Extract essentials only |

**Format:**
```
Context provided:
---
research: "Key findings about AI safety..."
analysis: "Risk assessment shows..."
---
```

### Complete Execution Trace Example

```prose
agent researcher:
  model: sonnet

let research = session: researcher
  prompt: "Research AI safety"

parallel:
  a = session "Analyze risk A"
  b = session "Analyze risk B"

loop until **analysis complete** (max: 3):
  session "Synthesize"
    context: { a, b, research }
```

**Narration:**
```
📋 Program Start
   Collecting definitions...
   - Agent: researcher (model: sonnet)

📍 Statement 1: let research = session: researcher
   Spawning with prompt: "Research AI safety"
   Model: sonnet
   [Task tool call]
✅ Session complete: "AI safety research covers alignment..."
📦 let research = <result>

📍 Statement 2: parallel block
🔀 Entering parallel (2 branches, strategy: all)
   [Task: "Analyze risk A"] [Task: "Analyze risk B"]
🔀 Parallel complete:
   - a = "Risk A: potential misalignment..."
   - b = "Risk B: robustness concerns..."
📦 a, b bound

📍 Statement 3: loop until **analysis complete** (max: 3)
🔄 Starting loop

🔄 Iteration 1 of max 3
   📍 session "Synthesize" with context: {a, b, research}
   [Task with serialized context]
   ✅ Result: "Initial synthesis shows..."
   🔄 Evaluating: **analysis complete**
   ➡️ Not satisfied (synthesis is preliminary)

🔄 Iteration 2 of max 3
   📍 session "Synthesize" with context: {a, b, research}
   [Task with serialized context]
   ✅ Result: "Comprehensive analysis complete..."
   🔄 Evaluating: **analysis complete**
   ➡️ Satisfied!

🔄 Loop exited: condition satisfied at iteration 2

📋 Program Complete
```

---

## State Management: In-File

For long-running programs, complex parallel execution, or resumable workflows, state can be persisted to the filesystem instead of relying solely on the conversation context.

### Automatic State Mode Selection

The OpenProse VM automatically chooses the appropriate state management mode at program start. This decision is based on program complexity:

| Factor | In-Context | In-File |
|--------|------------|---------|
| Statement count | < 30 statements | ≥ 30 statements |
| Parallel branches | < 5 concurrent | ≥ 5 concurrent |
| Imported programs | 0-2 imports | ≥ 3 imports |
| Nested depth | ≤ 2 levels | > 2 levels |
| Expected duration | < 5 minutes | ≥ 5 minutes |

The VM announces its choice at program start:

```
📋 Program Start
   State mode: in-context (program is small, fits in context)

   To use file-based state on next run, add: --state=file
```

Or for complex programs:

```
📋 Program Start
   State mode: in-file (program has 47 statements, 3 imports)
   State directory: .prose/execution/run-20260110-143052-a7b3c9/

   To use in-context state on next run, add: --state=context
```

### Overriding State Mode

Users can override the automatic selection by passing a flag:

- `--state=context` — Force in-context state (narration only)
- `--state=file` — Force file-based state (persistent)

The flag can be passed when invoking the program or specified in the program itself:

```prose
# Force file-based state for this program
# state: file

input topic: "What to research"
# ... rest of program
```

### Directory Structure

```
.prose/
├── execution/
│   └── run-{YYYYMMDD}-{HHMMSS}-{random}/
│       ├── program.prose          # Copy of running program
│       ├── position.json          # Current statement index
│       ├── inputs/
│       │   ├── {name}.md          # Input values received
│       │   └── manifest.json      # Input metadata
│       ├── outputs/
│       │   ├── {name}.md          # Output values produced
│       │   └── manifest.json      # Output metadata
│       ├── variables/
│       │   ├── {name}.md          # Variable values
│       │   └── manifest.json      # Metadata (type, mutability)
│       ├── imports/
│       │   └── {handle}--{slug}/  # Nested program executions
│       │       ├── inputs/
│       │       ├── outputs/
│       │       ├── variables/
│       │       └── execution.log
│       ├── parallel/
│       │   └── {block-id}/
│       │       ├── {branch}.md    # Branch results
│       │       └── status.json    # Branch status
│       ├── loops/
│       │   └── {loop-id}.json     # Iteration state
│       └── execution.log          # Full trace
└── checkpoints/
    └── {name}.json                # Resumable snapshots
```

### Session ID Format

Each execution generates a unique session ID:
```
run-20260103-143052-a7b3c9
```
Format: `run-{YYYYMMDD}-{HHMMSS}-{6-char-random}`

### File Formats

#### position.json
```json
{
  "session_id": "run-20260103-143052-a7b3c9",
  "statement_index": 5,
  "total_statements": 12,
  "started_at": "2026-01-03T14:30:52Z",
  "last_updated": "2026-01-03T14:32:15Z"
}
```

#### inputs/manifest.json
```json
{
  "inputs": [
    {"name": "topic", "file": "topic.md", "received_at": "2026-01-03T14:30:52Z"},
    {"name": "depth", "file": "depth.md", "received_at": "2026-01-03T14:30:52Z"}
  ]
}
```

#### inputs/{name}.md
```markdown
# Input: topic

**Received from:** caller
**Received at:** Statement 0 (program start)

## Value

quantum computing
```

#### outputs/manifest.json
```json
{
  "outputs": [
    {"name": "findings", "file": "findings.md", "bound_at": "Statement 5"},
    {"name": "sources", "file": "sources.md", "bound_at": "Statement 6"}
  ]
}
```

#### outputs/{name}.md
```markdown
# Output: findings

**Bound at:** Statement 5
**Will return to:** caller

## Value

Quantum computing leverages quantum mechanical phenomena such as
superposition and entanglement to perform computations. Key findings
include...

[Full value preserved]
```

#### variables/manifest.json
```json
{
  "variables": [
    {"name": "research", "type": "let", "file": "research.md"},
    {"name": "config", "type": "const", "file": "config.md"}
  ]
}
```

#### variables/{name}.md
```markdown
# Variable: research

**Type:** let (mutable)
**Bound at:** Statement 3
**Last updated:** Statement 7

## Value

AI safety research covers several key areas including alignment,
robustness, and interpretability. The field has grown significantly
since 2020 with major contributions from...

[Full value preserved]
```

#### parallel/{block-id}/status.json
```json
{
  "block_id": "parallel_stmt_5",
  "strategy": "all",
  "on_fail": "fail-fast",
  "branches": [
    {"name": "security", "status": "complete", "file": "security.md"},
    {"name": "perf", "status": "complete", "file": "perf.md"},
    {"name": "style", "status": "pending", "file": null}
  ]
}
```

#### loops/{loop-id}.json
```json
{
  "loop_id": "loop_stmt_8",
  "type": "until",
  "condition": "**analysis complete**",
  "max": 5,
  "current_iteration": 2,
  "condition_history": [
    {"iteration": 1, "result": false, "reason": "synthesis preliminary"},
    {"iteration": 2, "result": true, "reason": "comprehensive analysis"}
  ]
}
```

### In-File Execution Protocol

When the VM selects (or is configured for) in-file state management:

1. **Program Start**
   ```
   📋 Program Start
      State mode: in-file (program has 47 statements, 3 imports)
      State directory: .prose/execution/run-20260103-143052-a7b3c9/

      To use in-context state on next run, add: --state=context
   ```

2. **After Each Statement**
   - Update `position.json`
   - Write/update affected variable files
   - Append to `execution.log`

3. **Variable Binding**
   ```
   📦 let research = <value>
      Written to: .prose/execution/.../variables/research.md
   ```

4. **Parallel Execution**
   - Create `parallel/{block-id}/` directory
   - Write each branch result as it completes
   - Update `status.json` after each branch

5. **Loop Execution**
   - Create `loops/{loop-id}.json` at loop start
   - Update after each iteration with condition result

6. **Checkpointing**
   When user requests or at natural break points:
   ```
   💾 Checkpoint saved: .prose/checkpoints/before-deploy.json
   ```

### Resuming Execution

If execution is interrupted, resume with:
```
"Resume the OpenProse program from the last checkpoint"
```

The OpenProse VM:
1. Reads `.prose/execution/run-.../position.json`
2. Loads variables from `variables/`
3. Continues from `statement_index`

### Hybrid Approach

For most programs, use a hybrid:
- **In-context** for small variables and recent state
- **In-file** for large values (> 5000 chars) and checkpoints

```
📦 let summary = <short value, kept in-context>
📦 let full_report = <large value>
   Written to: .prose/execution/.../variables/full_report.md
   In-context: [reference to file]
```

---

## Choice and Conditional Execution

### Choice Blocks

```prose
choice **the severity level**:
  option "Critical":
    session "Escalate immediately"
  option "Minor":
    session "Log for later"
```

1. Evaluate the discretion criteria
2. Select the most appropriate option
3. Execute only that option's body

### If/Elif/Else

```prose
if **has security issues**:
  session "Fix security"
elif **has performance issues**:
  session "Optimize"
else:
  session "Approve"
```

1. Evaluate conditions in order
2. Execute first matching branch
3. Skip remaining branches

---

## Block Invocation

### Defining Blocks

```prose
block review(topic):
  session "Research {topic}"
  session "Analyze {topic}"
```

Blocks are hoisted - can be used before definition.

### Invoking Blocks

```prose
do review("quantum computing")
```

1. Substitute arguments for parameters
2. Execute block body
3. Return to caller

---

## Pipeline Execution

```prose
let results = items
  | filter:
      session "Keep? yes/no"
        context: item
  | map:
      session "Transform"
        context: item
```

Execute left-to-right:
1. **filter**: Keep items where session returns truthy
2. **map**: Transform each item via session
3. **reduce**: Accumulate items pairwise
4. **pmap**: Like map but concurrent

---

## String Interpolation

```prose
let name = session "Get user name"
session "Hello {name}, welcome!"
```

Before spawning, substitute `{varname}` with variable values.

---

## Complete Execution Algorithm

```
function execute(program, inputs?):
  1. Collect all use statements, fetch and register imports
  2. Collect all input declarations, bind values from caller
  3. Collect all agent definitions
  4. Collect all block definitions
  5. For each statement in order:
     - If session: spawn via Task, await result
     - If let/const: execute RHS, bind result
     - If output: execute RHS, bind result, register as output
     - If program call: invoke imported program with inputs, receive outputs
     - If parallel: spawn all branches, await per strategy
     - If loop: evaluate condition, execute body, repeat
     - If try: execute try, catch on error, always finally
     - If choice/if: evaluate condition, execute matching branch
     - If do block: invoke block with arguments
  6. Handle errors according to try/catch or propagate
  7. Collect all output bindings
  8. Return outputs to caller (or final result if no outputs declared)
```

---

## Implementation Notes

### Task Tool Usage

Always use Task for session execution:
```
Task({
  description: "OpenProse session",
  prompt: "<session prompt with context>",
  subagent_type: "general-purpose",
  model: "<optional model override>"
})
```

### Parallel Execution

Make multiple Task calls in a single response for true concurrency:
```
// In one response, call all three:
Task({ prompt: "A" })
Task({ prompt: "B" })
Task({ prompt: "C" })
```

### Context Serialization

When passing context to sessions:
- Prefix with clear labels
- Keep relevant information
- Summarize if very long
- Maintain semantic meaning

---

## Summary

The OpenProse VM:

1. **Imports** programs from `p.prose.md` via `use` statements
2. **Binds** inputs from caller to program variables
3. **Parses** the program structure
4. **Collects** definitions (agents, blocks)
5. **Executes** statements sequentially
6. **Spawns** sessions via Task tool
7. **Invokes** imported programs with inputs, receives outputs
8. **Coordinates** parallel execution
9. **Evaluates** discretion conditions intelligently
10. **Manages** context flow between sessions
11. **Handles** errors with try/catch/retry
12. **Tracks** state in working memory (or files)
13. **Returns** output bindings to caller

The language is self-evident by design. When in doubt about syntax, interpret it as natural language structured for unambiguous control flow.
