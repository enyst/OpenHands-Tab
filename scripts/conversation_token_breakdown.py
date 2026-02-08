#!/usr/bin/env python3
"""
Conversation Token Breakdown

Summarize prompt token usage for a local OpenHands conversation by extracting:
- System prompt (base + repo context + skills + secrets + tool list)
- User message + extended content (environment info)
- Tool schema JSON (functions sent to OpenAI)

Requires:
  pip install tiktoken

Usage:
  python scripts/conversation_token_breakdown.py --conversation-dir ~/.openhands/conversations-vscode/local-xxxx
  python scripts/conversation_token_breakdown.py --root ~/.openhands/conversations-vscode --latest
  python scripts/conversation_token_breakdown.py --root ~/.openhands/conversations-vscode --latest --model gpt-5
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


def format_number(value: Optional[int]) -> str:
    if value is None:
        return "n/a"
    return f"{value:,}"


def load_tiktoken(model: str):
    try:
        import tiktoken  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "tiktoken is required. Install with: pip install tiktoken"
        ) from exc

    try:
        enc = tiktoken.encoding_for_model(model)
        enc_name = enc.name
    except Exception:
        enc = tiktoken.get_encoding("o200k_base")
        enc_name = "o200k_base"
    return enc, enc_name


def count_tokens(encoding, text: Optional[str]) -> int:
    if not text:
        return 0
    return len(encoding.encode(text))


def find_latest_conversation(root: Path) -> Optional[Path]:
    candidates: List[Tuple[float, Path]] = []
    if not root.exists():
        return None

    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        state = entry / "state.json"
        events = entry / "events.jsonl"
        if not (state.exists() and events.exists()):
            continue
        try:
            mtime = entry.stat().st_mtime
        except OSError:
            continue
        candidates.append((mtime, entry))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def read_first_events(events_path: Path) -> Tuple[Optional[str], Optional[List[dict]], Optional[str], Optional[str]]:
    system_prompt: Optional[str] = None
    tools: Optional[List[dict]] = None
    user_text: Optional[str] = None
    user_extended_text: Optional[str] = None

    with events_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                evt = json.loads(line)
            except Exception:
                continue

            if system_prompt is None and evt.get("kind") == "SystemPromptEvent":
                system_prompt = (evt.get("system_prompt") or {}).get("text")
                tools = evt.get("tools")

            if user_text is None and evt.get("kind") == "MessageEvent" and evt.get("source") == "user":
                msg = evt.get("llm_message") or {}
                content = msg.get("content") or []
                user_text = "\n".join(
                    c.get("text") for c in content if isinstance(c, dict) and c.get("type") == "text"
                ) or None
                ext = evt.get("extended_content") or []
                user_extended_text = "\n".join(
                    c.get("text") for c in ext if isinstance(c, dict) and c.get("type") == "text"
                ) or None

            if system_prompt and user_text is not None:
                break

    return system_prompt, tools, user_text, user_extended_text


def read_input_tokens(state_path: Path) -> Optional[int]:
    try:
        data = json.loads(state_path.read_text())
    except Exception:
        return None
    values = (data or {}).get("values") or {}
    llm_usage = values.get("llm_usage") or {}
    for key in ("input", "inputTokens", "promptTokens", "prompt_tokens"):
        raw = llm_usage.get(key)
        if isinstance(raw, (int, float)):
            return max(0, int(raw))
    return None


def load_base_system_prompt(repo_root: Path) -> str:
    prompt_path = repo_root / "packages" / "agent-sdk" / "src" / "sdk" / "runtime" / "systemPrompt.ts"
    if not prompt_path.exists():
        return ""
    text = prompt_path.read_text(encoding="utf-8")
    match = re.search(r"SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;", text)
    if not match:
        return ""
    return match.group(1)


def extract_block(text: str, tag: str) -> str:
    if not text:
        return ""
    match = re.search(rf"<{tag}>[\\s\\S]*?</{tag}>", text)
    return match.group(0) if match else ""


def extract_repo_skill_blocks(repo_block: str) -> List[Tuple[str, str]]:
    blocks: List[Tuple[str, str]] = []
    if not repo_block:
        return blocks
    pattern = re.compile(r"\[BEGIN context from \[(.*?)\]\]\n([\s\S]*?)\n\[END Context\]")
    for match in pattern.finditer(repo_block):
        name = match.group(1)
        block = match.group(2)
        blocks.append((name, block))
    return blocks


def main() -> int:
    parser = argparse.ArgumentParser(description="Break down context tokens for a local conversation")
    parser.add_argument("--conversation-dir", type=str, help="Conversation directory (contains state.json, events.jsonl)")
    parser.add_argument("--root", type=str, default=os.path.expanduser("~/.openhands/conversations-vscode"),
                        help="Root directory for local conversations")
    parser.add_argument("--latest", action="store_true", help="Use most recent conversation under --root")
    parser.add_argument("--model", type=str, default="gpt-5", help="Tokenizer model (default: gpt-5)")

    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]

    conversation_dir: Optional[Path] = None
    if args.conversation_dir:
        conversation_dir = Path(args.conversation_dir).expanduser()
    elif args.latest:
        conversation_dir = find_latest_conversation(Path(args.root).expanduser())
    else:
        print("Provide --conversation-dir or --latest", file=sys.stderr)
        return 2

    if not conversation_dir or not conversation_dir.exists():
        print("Conversation directory not found.", file=sys.stderr)
        return 2

    state_path = conversation_dir / "state.json"
    events_path = conversation_dir / "events.jsonl"
    if not (state_path.exists() and events_path.exists()):
        print("Missing state.json or events.jsonl in conversation directory.", file=sys.stderr)
        return 2

    try:
        encoding, enc_name = load_tiktoken(args.model)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    system_prompt, tools, user_text, user_extended_text = read_first_events(events_path)
    input_tokens = read_input_tokens(state_path)

    base_prompt = load_base_system_prompt(repo_root)
    system_prompt_tokens = count_tokens(encoding, system_prompt)
    base_prompt_tokens = count_tokens(encoding, base_prompt)

    tool_list_text = ""
    if system_prompt and "\n\nAvailable tools:\n" in system_prompt:
        _, tool_list_text = system_prompt.split("\n\nAvailable tools:\n", 1)
        tool_list_text = "\n\nAvailable tools:\n" + tool_list_text

    suffix_text = ""
    if system_prompt and base_prompt and system_prompt.startswith(base_prompt):
        suffix_text = system_prompt[len(base_prompt):]

    repo_block = extract_block(system_prompt or "", "REPO_CONTEXT")
    skills_block = extract_block(system_prompt or "", "SKILLS")
    secrets_block = extract_block(system_prompt or "", "CUSTOM_SECRETS")

    tool_schema_tokens = None
    if tools is not None:
        tool_schema_tokens = count_tokens(encoding, json.dumps(tools, ensure_ascii=False, separators=(",", ":")))

    user_text_tokens = count_tokens(encoding, user_text)
    user_extended_tokens = count_tokens(encoding, user_extended_text)

    print(f"\nConversation: {conversation_dir.name}")
    print(f"Tokenizer: {enc_name} (model: {args.model})")
    print(f"Input tokens (provider): {format_number(input_tokens)}")
    print("")

    print("System prompt:")
    print(f"  total: {format_number(system_prompt_tokens)}")
    print(f"  base SYSTEM_PROMPT: {format_number(base_prompt_tokens)}")
    print(f"  suffix (base diff): {format_number(count_tokens(encoding, suffix_text))}")
    print(f"  <REPO_CONTEXT>: {format_number(count_tokens(encoding, repo_block))}")
    print(f"  <SKILLS>: {format_number(count_tokens(encoding, skills_block))}")
    print(f"  <CUSTOM_SECRETS>: {format_number(count_tokens(encoding, secrets_block))}")
    print(f"  Available tools list: {format_number(count_tokens(encoding, tool_list_text))}")

    print("\nUser message:")
    print(f"  text: {format_number(user_text_tokens)}")
    print(f"  extended content: {format_number(user_extended_tokens)}")

    print("\nTool schema:")
    print(f"  JSON tokens (approx): {format_number(tool_schema_tokens)}")

    repo_skill_blocks = extract_repo_skill_blocks(repo_block)
    if repo_skill_blocks:
        print("\nRepo context per-skill:")
        for name, block in repo_skill_blocks:
            print(f"  - {name}: {format_number(count_tokens(encoding, block))}")

    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
