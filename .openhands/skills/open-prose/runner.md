---
role: openhands-execution-backend
summary: |
  How to execute OpenProse programs in OpenHands. This file adapts the OpenProse VM
  semantics to work with OpenHands' available tools (task_tracker, execute_bash, 
  str_replace_editor, browser, etc.) instead of the Task tool.
see-also:
  - prose.md: Core VM execution semantics
  - SKILL.md: Activation triggers
  - docs.md: Full syntax grammar
---

# OpenProse Runner for OpenHands

This document defines how to execute OpenProse programs **in OpenHands**, where the Task tool (subagent spawning) is not available. You adapt the OpenProse VM to work with OpenHands' tool set.

## The Execution Gap

The core OpenProse VM (`prose.md`) assumes a **Task tool** that spawns real subagent sessions. OpenHands does not have this tool. Instead, OpenHands provides:

| OpenHands Tool | Purpose |
|----------------|---------|
| `task_tracker` | Track work items and their status |
| `execute_bash` | Run shell commands |
| `str_replace_editor` | View and edit files |
| `browser` | Interact with web pages |
| `execute_ipython_cell` | Run Python code |
| `fetch` | Fetch URLs |

This runner bridges the gap by mapping OpenProse primitives to OpenHands tools.

---

## Execution Model Adaptation

### Sessions → Direct Execution

In standard OpenProse, `session "prompt"` spawns a subagent. In OpenHands, **you execute the session directly**:

```prose
session "Analyze the codebase for security issues"
```

**OpenHands execution:**
1. Read the prompt
2. Perform the work yourself using available tools
3. Capture the result in your working memory (conversation context)
4. Continue to the next statement

**Key difference:** No subagent is spawned. You are both the VM and the worker.

### Variables → Working Memory + task_tracker

```prose
let research = session "Research the topic"
```

**OpenHands execution:**
1. Execute the session (do the research)
2. Store the result in your conversation context
3. Optionally track in `task_tracker` for visibility
4. Reference `research` in subsequent statements

### Parallel → Sequential with Tracking

```prose
parallel:
  a = session "Task A"
  b = session "Task B"
  c = session "Task C"
```

**OpenHands execution:**
1. Create task_tracker items for each branch
2. Execute each branch **sequentially** (true parallelism not available)
3. Mark each task as done when complete
4. Collect results for the join point

**Example task_tracker usage:**
```
task_tracker plan:
- id: "parallel-a", title: "Task A", status: "in_progress"
- id: "parallel-b", title: "Task B", status: "todo"
- id: "parallel-c", title: "Task C", status: "todo"
```

### Loops → Bounded Iteration

```prose
loop until **the code is bug-free** (max: 10):
  session "Find and fix bugs"
```

**OpenHands execution:**
1. Track iteration count
2. Execute the body
3. Evaluate the discretion condition (`**...**`) using your judgment
4. Continue or exit based on condition and max iterations
5. Use task_tracker to track progress

### Agents → Role Prompts

```prose
agent researcher:
  model: opus
  prompt: "You are a research expert"

session: researcher
  prompt: "Research quantum computing"
```

**OpenHands execution:**
1. Store agent definitions in working memory
2. When executing `session: researcher`, adopt the agent's role/prompt
3. Execute with that persona active
4. Return to VM role after session completes

---

## Step-by-Step Execution Protocol

When you receive a `.prose` program to execute:

### Phase 1: Parse and Plan

1. **Read the entire program** to understand structure
2. **Identify all definitions:**
   - Agent definitions (`agent name:`)
   - Block definitions (`block name():`)
   - Input declarations (`input name:`)
3. **Create a task_tracker plan** with major phases/sessions
4. **Announce:** "📋 Parsed program with N statements, M agents, K blocks"

### Phase 2: Execute Statements

For each statement in order:

#### Simple Session
```prose
session "Do something"
```
1. Announce: `📍 Executing: session "Do something"`
2. Perform the work using available tools
3. Announce: `✅ Completed session`

#### Session with Agent
```prose
session: researcher
  prompt: "Research topic"
```
1. Announce: `📍 Executing: session: researcher`
2. Load agent definition from memory
3. Adopt agent role/prompt
4. Execute the prompt
5. Return to VM role
6. Announce: `✅ Completed session`

#### Let Binding
```prose
let result = session "Get result"
```
1. Announce: `📍 Executing: let result = session "Get result"`
2. Execute the session
3. Store result: `📦 result = [summary of output]`
4. Announce: `✅ Bound result`

#### Parallel Block
```prose
parallel:
  a = session "Task A"
  b = session "Task B"
```
1. Announce: `📍 Executing parallel block (2 branches)`
2. Create task_tracker items
3. Execute branch 1: `📍 Branch 1/2: Task A`
4. Store result: `📦 a = [output]`
5. Execute branch 2: `📍 Branch 2/2: Task B`
6. Store result: `📦 b = [output]`
7. Announce: `✅ Parallel block complete`

#### Loop
```prose
loop until **condition** (max: 5):
  session "Work"
```
1. Announce: `📍 Executing loop (max: 5)`
2. For each iteration:
   - Check condition (evaluate `**condition**` semantically)
   - If satisfied: `✅ Loop condition met, exiting`
   - If not: Execute body, increment counter
   - If max reached: `⚠️ Max iterations reached`

#### Conditional
```prose
if **condition**:
  session "Do this"
else:
  session "Do that"
```
1. Announce: `📍 Evaluating condition: **condition**`
2. Use judgment to evaluate
3. Announce: `📍 Condition is [true/false], taking [if/else] branch`
4. Execute the chosen branch

### Phase 3: Complete

1. Announce: `✅ Program execution complete`
2. Summarize outputs and results
3. Update task_tracker to mark all items done

---

## Discretion Evaluation (`**...**`)

When you encounter `**...**` markers, use your intelligence:

```prose
loop until **the tests pass**:
  session "Fix failing tests"
```

**Evaluation approach:**
1. Consider all context from prior work
2. Interpret the condition semantically
3. Be conservative (when uncertain, continue)
4. Detect lack of progress (exit if stuck)

**Example evaluations:**
- `**the tests pass**` → Run tests, check exit code
- `**the code is clean**` → Run linter, review output
- `**the user is satisfied**` → Check for explicit approval
- `**no more issues**` → Review recent findings

---

## Context Passing

When a session needs context from prior sessions:

```prose
let research = session "Research topic"
session "Write summary"
  context: research
```

**OpenHands execution:**
1. Store `research` output in working memory
2. When executing the summary session, include research in your context
3. Reference it explicitly: "Based on the research: [key points]..."

### Context Forms

| Form | How to Handle |
|------|---------------|
| `context: var` | Include var's value in your working context |
| `context: [a, b]` | Include both a and b |
| `context: { a, b }` | Include as named references |
| `context: []` | Fresh start, don't reference prior work |

---

## Error Handling

```prose
try:
  session "Risky operation"
catch as err:
  session "Handle error"
    context: err
```

**OpenHands execution:**
1. Attempt the try block
2. If error occurs, capture error info
3. Execute catch block with error context
4. Continue after catch/finally

---

## Example: Executing a Simple Program

Given this program:
```prose
agent researcher:
  model: sonnet
  prompt: "You are a research assistant"

let findings = session: researcher
  prompt: "Research AI safety"

session "Write executive summary"
  context: findings
```

**OpenHands execution trace:**

```
📋 Parsed program: 3 statements, 1 agent, 0 blocks

📍 Statement 1/3: agent researcher definition
✅ Registered agent: researcher (model: sonnet)

📍 Statement 2/3: let findings = session: researcher
   Adopting role: research assistant
   [Performing research using available tools...]
📦 findings = "AI safety research covers alignment, robustness, interpretability..."
✅ Bound findings

📍 Statement 3/3: session "Write executive summary"
   Context: findings
   [Writing summary based on research...]
✅ Completed session

✅ Program execution complete
```

---

## Limitations in OpenHands

Be aware of these limitations:

| OpenProse Feature | OpenHands Limitation |
|-------------------|---------------------|
| True parallel execution | Sequential only |
| Subagent spawning | Direct execution by VM |
| Model selection (`model: opus`) | Uses current model |
| Skills/permissions | Not enforced |
| Persistent agent memory | Conversation context only |
| File-based state | Optional, use task_tracker |

### Workarounds

**For parallel execution:**
- Execute sequentially but track with task_tracker
- Note: Wall-clock time = sum of all branches

**For model selection:**
- Ignore model hints (use current model)
- Or note: "This session requests opus model"

**For persistence:**
- Use files in `.prose/` directory if needed
- Or rely on conversation context

---

## Running a .prose Program

When asked to run a `.prose` program:

1. **Load this runner** (you're reading it now)
2. **Load prose.md** for core semantics
3. **Parse the program**
4. **Execute using the protocol above**
5. **Report results**

### Quick Start Command

```
Run the OpenProse program at: [path/to/program.prose]

Use the OpenHands runner (runner.md) for execution.
```

---

## Integration with task_tracker

The `task_tracker` tool is your primary state management tool in OpenHands. Use it to:

1. **Plan execution:** Create tasks for each major phase
2. **Track progress:** Update status as you execute
3. **Manage parallel blocks:** Track each branch
4. **Handle loops:** Track iterations

**Example task_tracker integration:**

```
# Before execution
task_tracker plan:
- id: "phase-1", title: "Research phase", status: "todo"
- id: "phase-2", title: "Analysis phase", status: "todo"
- id: "phase-3", title: "Summary phase", status: "todo"

# During execution
task_tracker plan:
- id: "phase-1", title: "Research phase", status: "done"
- id: "phase-2", title: "Analysis phase", status: "in_progress"
- id: "phase-3", title: "Summary phase", status: "todo"
```

---

## Summary

The OpenHands runner adapts OpenProse for environments without subagent spawning:

| OpenProse Concept | OpenHands Adaptation |
|-------------------|---------------------|
| Task tool | Direct execution |
| Subagent sessions | VM executes directly |
| Parallel blocks | Sequential + task_tracker |
| Variables | Working memory |
| State persistence | task_tracker + files |
| Discretion (`**...**`) | VM judgment |

You are both the VM and the worker. Execute programs step by step, tracking state in your conversation and task_tracker.
