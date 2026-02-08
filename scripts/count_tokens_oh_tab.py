#!/usr/bin/env python3
"""
OpenHands-Tab token breakdown.

Counts tokens (tiktoken estimate) for the repo's major surfaces:
- extension host source (src/** excluding src/webview-src and __tests__)
- extension host tests (src/**/__tests__ excluding src/webview-src)
- webview UI source (src/webview-src excluding __tests__)
- webview UI tests (src/webview-src/__tests__)
- agent-sdk source (packages/agent-sdk/src excluding __tests__)
- agent-sdk tests (packages/agent-sdk/src/**/__tests__)
"""

import argparse
import pathlib
import sys
from collections import defaultdict

try:
    import tiktoken
except ModuleNotFoundError:
    print(
        "Missing dependency: tiktoken\n\n"
        "Recommended install (does not touch system Python):\n"
        "  python3 -m venv .venv-tokens\n"
        "  .venv-tokens/bin/python -m pip install -U pip\n"
        "  .venv-tokens/bin/python -m pip install tiktoken\n\n"
        "Then run:\n"
        "  .venv-tokens/bin/python scripts/count_tokens_oh_tab.py\n",
        file=sys.stderr,
    )
    raise


DEFAULT_EXTENSIONS = [
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".md",
    ".json",
    ".yml",
    ".yaml",
    ".css",
    ".scss",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".go",
    ".rs",
    ".rb",
]

DEFAULT_IGNORE_DIRS = {
    "node_modules",
    "dist",
    "out",
    "build",
    ".git",
    "media",
    ".openhands",
    "__pycache__",
    "venv",
    ".venv",
    ".venv-tokens",
}


def _to_optional_non_empty_string(value) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _format_num(value: int) -> str:
    return f"{value:,}"


def _get_encoding(model: str):
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        print(f"Warning: unknown model {model!r}, using cl100k_base", file=sys.stderr)
        return tiktoken.get_encoding("cl100k_base")


def _count_path_tokens(
    root: pathlib.Path,
    *,
    encoding,
    extensions: set[str],
    ignore_dirs: set[str],
    include_file,
):
    total_tokens = 0
    total_lines = 0
    file_count = 0
    tokens_by_ext = defaultdict(int)
    lines_by_ext = defaultdict(int)
    files_by_ext = defaultdict(int)

    for p in root.rglob("*"):
        if any(part in ignore_dirs for part in p.parts):
            continue
        if not p.is_file():
            continue
        if p.suffix not in extensions:
            continue
        if not include_file(p):
            continue

        try:
            content = p.read_text(errors="ignore")
        except OSError:
            continue

        tokens = len(encoding.encode(content))
        lines = len(content.splitlines())

        total_tokens += tokens
        total_lines += lines
        file_count += 1
        tokens_by_ext[p.suffix] += tokens
        lines_by_ext[p.suffix] += lines
        files_by_ext[p.suffix] += 1

    return {
        "total_tokens": total_tokens,
        "total_lines": total_lines,
        "file_count": file_count,
        "tokens_by_ext": dict(tokens_by_ext),
        "lines_by_ext": dict(lines_by_ext),
        "files_by_ext": dict(files_by_ext),
    }


def _print_bucket(title: str, stats: dict, *, fmt: str):
    total_tokens = stats["total_tokens"]
    total_lines = stats["total_lines"]
    file_count = stats["file_count"]
    tokens_by_ext = stats["tokens_by_ext"]
    lines_by_ext = stats["lines_by_ext"]
    files_by_ext = stats["files_by_ext"]

    if fmt == "markdown":
        print(f"## {title}\n")
        print(f"- **Total tokens:** {_format_num(total_tokens)}")
        print(f"- **Total lines:** {_format_num(total_lines)}")
        print(f"- **Total files:** {_format_num(file_count)}\n")
        print("| Extension | Tokens | Lines | Files | % Tokens |")
        print("|-----------|--------|-------|-------|----------|")
        for ext in sorted(tokens_by_ext, key=lambda k: tokens_by_ext[k], reverse=True):
            t = tokens_by_ext[ext]
            l = lines_by_ext.get(ext, 0)
            f = files_by_ext.get(ext, 0)
            pct = (t / total_tokens * 100) if total_tokens else 0.0
            print(f"| `{ext}` | {_format_num(t)} | {_format_num(l)} | {f} | {pct:.1f}% |")
        print()
        return

    print("=" * 72)
    print(title)
    print("=" * 72)
    print(f"Total tokens:  {_format_num(total_tokens)}")
    print(f"Total lines:   {_format_num(total_lines)}")
    print(f"Total files:   {_format_num(file_count)}")
    print("\nBy file type:")
    for ext in sorted(tokens_by_ext, key=lambda k: tokens_by_ext[k], reverse=True):
        t = tokens_by_ext[ext]
        l = lines_by_ext.get(ext, 0)
        f = files_by_ext.get(ext, 0)
        pct = (t / total_tokens * 100) if total_tokens else 0.0
        print(f"  {ext:6s}  {_format_num(t):>12s} tokens  {_format_num(l):>10s} lines  ({f:>4d} files)  {pct:5.1f}%")
    print("=" * 72)
    print()


def _merge_totals(a: dict, b: dict) -> dict:
    merged = {
        "total_tokens": int(a.get("total_tokens", 0)) + int(b.get("total_tokens", 0)),
        "total_lines": int(a.get("total_lines", 0)) + int(b.get("total_lines", 0)),
        "file_count": int(a.get("file_count", 0)) + int(b.get("file_count", 0)),
        "tokens_by_ext": defaultdict(int),
        "lines_by_ext": defaultdict(int),
        "files_by_ext": defaultdict(int),
    }
    for ext, v in (a.get("tokens_by_ext") or {}).items():
        merged["tokens_by_ext"][ext] += int(v)
    for ext, v in (b.get("tokens_by_ext") or {}).items():
        merged["tokens_by_ext"][ext] += int(v)
    for ext, v in (a.get("lines_by_ext") or {}).items():
        merged["lines_by_ext"][ext] += int(v)
    for ext, v in (b.get("lines_by_ext") or {}).items():
        merged["lines_by_ext"][ext] += int(v)
    for ext, v in (a.get("files_by_ext") or {}).items():
        merged["files_by_ext"][ext] += int(v)
    for ext, v in (b.get("files_by_ext") or {}).items():
        merged["files_by_ext"][ext] += int(v)
    merged["tokens_by_ext"] = dict(merged["tokens_by_ext"])
    merged["lines_by_ext"] = dict(merged["lines_by_ext"])
    merged["files_by_ext"] = dict(merged["files_by_ext"])
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Count tokens for key OpenHands-Tab surfaces")
    parser.add_argument("--model", default="gpt-4", help="Tokenizer model (default: gpt-4)")
    parser.add_argument(
        "--extensions",
        nargs="+",
        default=DEFAULT_EXTENSIONS,
        help="File extensions to include (default: common source + docs)",
    )
    parser.add_argument(
        "--format",
        choices=["text", "markdown"],
        default="text",
        help="Output format (default: text)",
    )
    parser.add_argument(
        "--ignore-dirs",
        nargs="+",
        default=sorted(DEFAULT_IGNORE_DIRS),
        help="Directory names to ignore (default: common build/cache dirs)",
    )

    args = parser.parse_args()
    model = _to_optional_non_empty_string(args.model) or "gpt-4"
    fmt = args.format
    extensions = {e if e.startswith(".") else f".{e}" for e in args.extensions}
    ignore_dirs = set(args.ignore_dirs)

    encoding = _get_encoding(model)

    repo_root = pathlib.Path.cwd()
    src_root = repo_root / "src"
    webview_src_root = src_root / "webview-src"
    sdk_src_root = repo_root / "packages" / "agent-sdk" / "src"

    if not src_root.exists():
        print("Error: expected to run from repo root (missing ./src)", file=sys.stderr)
        return 2

    def include_extension_src(p: pathlib.Path) -> bool:
        # Under src, but not webview-src and not tests.
        parts = set(p.parts)
        return "webview-src" not in parts and "__tests__" not in parts

    def include_extension_tests(p: pathlib.Path) -> bool:
        # Any __tests__ under src, except webview-src/__tests__.
        parts = set(p.parts)
        return "__tests__" in parts and "webview-src" not in parts

    def include_webview_ui_src(p: pathlib.Path) -> bool:
        parts = set(p.parts)
        return "__tests__" not in parts

    def include_webview_ui_tests(p: pathlib.Path) -> bool:
        return True

    def include_sdk_src(p: pathlib.Path) -> bool:
        parts = set(p.parts)
        return "__tests__" not in parts

    def include_sdk_tests(p: pathlib.Path) -> bool:
        parts = set(p.parts)
        return "__tests__" in parts

    extension_src = _count_path_tokens(
        src_root,
        encoding=encoding,
        extensions=extensions,
        ignore_dirs=ignore_dirs,
        include_file=include_extension_src,
    )
    extension_tests = _count_path_tokens(
        src_root,
        encoding=encoding,
        extensions=extensions,
        ignore_dirs=ignore_dirs,
        include_file=include_extension_tests,
    )
    webview_ui_src = _count_path_tokens(
        webview_src_root,
        encoding=encoding,
        extensions=extensions,
        ignore_dirs=ignore_dirs | {"__tests__"},
        include_file=include_webview_ui_src,
    )
    webview_ui_tests = _count_path_tokens(
        webview_src_root / "__tests__",
        encoding=encoding,
        extensions=extensions,
        ignore_dirs=ignore_dirs,
        include_file=include_webview_ui_tests,
    )

    sdk_src = None
    sdk_tests = None
    if sdk_src_root.exists():
        sdk_src = _count_path_tokens(
            sdk_src_root,
            encoding=encoding,
            extensions=extensions,
            ignore_dirs=ignore_dirs,
            include_file=include_sdk_src,
        )
        sdk_tests = _count_path_tokens(
            sdk_src_root,
            encoding=encoding,
            extensions=extensions,
            ignore_dirs=ignore_dirs,
            include_file=include_sdk_tests,
        )
    else:
        print("Warning: missing packages/agent-sdk/src; skipping agent-sdk buckets", file=sys.stderr)

    _print_bucket("Extension host source (src/** excluding webview-src and __tests__)", extension_src, fmt=fmt)
    _print_bucket("Extension host tests (src/**/__tests__ excluding webview-src)", extension_tests, fmt=fmt)
    _print_bucket("Webview UI source (src/webview-src excluding __tests__)", webview_ui_src, fmt=fmt)
    _print_bucket("Webview UI tests (src/webview-src/__tests__)", webview_ui_tests, fmt=fmt)

    if sdk_src is not None and sdk_tests is not None:
        _print_bucket("agent-sdk source (packages/agent-sdk/src excluding __tests__)", sdk_src, fmt=fmt)
        _print_bucket("agent-sdk tests (packages/agent-sdk/src/**/__tests__)", sdk_tests, fmt=fmt)

    # Convenience totals (excluding tests).
    product_src = _merge_totals(extension_src, webview_ui_src)
    if sdk_src is not None:
        product_src = _merge_totals(product_src, sdk_src)
    _print_bucket("TOTAL source (extension host + webview UI + agent-sdk; excluding tests)", product_src, fmt=fmt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
