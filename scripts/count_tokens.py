#!/usr/bin/env python3
"""
Token Counter - Count tokens in source code directories using OpenAI's tiktoken

Installation:
    pip install tiktoken

Usage:
    python count_tokens.py /path/to/src
    python count_tokens.py /path/to/src --model gpt-4
    python count_tokens.py /path/to/src --extensions .py .js .ts

Note: Uses OpenAI's tiktoken tokenizer. Token counts are estimates based on
      the specified model's encoding and may differ from actual API usage.
"""

import argparse
import pathlib
import sys
import tiktoken
from collections import defaultdict


def count_tokens_in_file(filepath, encoding):
    """Count tokens in a single file."""
    try:
        content = filepath.read_text(errors='ignore')
        return len(encoding.encode(content))
    except OSError as e:
        print(f"⚠️  Error reading {filepath}: {e}", file=sys.stderr)
        return 0


def format_number(num):
    """Format number with commas."""
    return f"{num:,}"


def main():
    parser = argparse.ArgumentParser(description='Count tokens in source files')
    parser.add_argument('directory', help='Directory to analyze')
    parser.add_argument('--model', default='gpt-4', help='Model for tokenizer (default: gpt-4)')
    parser.add_argument('--extensions', nargs='+',
                       default=['.py', '.js', '.ts', '.tsx', '.jsx', '.md', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb'],
                       help='File extensions to include')
    parser.add_argument('--ignore-dirs', nargs='+',
                       default=['node_modules', 'dist', 'out', 'build', '.git', 'media', '.openhands', '__pycache__', 'venv', '.venv'],
                       help='Directory names to ignore (default: common build/cache dirs)')

    args = parser.parse_args()

    # Convert ignore dirs to a set for faster lookup
    ignore_dirs = set(args.ignore_dirs)

    # Setup
    base_path = pathlib.Path(args.directory)
    if not base_path.exists():
        print(f"❌ Directory not found: {base_path}", file=sys.stderr)
        return

    try:
        encoding = tiktoken.encoding_for_model(args.model)
    except KeyError:
        print(f"⚠️  Unknown model {args.model}, using cl100k_base encoding", file=sys.stderr)
        encoding = tiktoken.get_encoding("cl100k_base")

    # Count tokens
    total_tokens = 0
    file_count = 0
    tokens_by_extension = defaultdict(int)
    files_by_extension = defaultdict(int)

    print(f"\n🔍 Analyzing: {base_path}")
    print(f"📝 Extensions: {', '.join(args.extensions)}")
    print(f"🤖 Tokenizer: {args.model}")
    print(f"🚫 Ignoring: {', '.join(sorted(ignore_dirs))}\n")

    for filepath in base_path.rglob('*'):
        # Skip files in ignored directories
        if any(part in ignore_dirs for part in filepath.parts):
            continue

        if filepath.is_file() and filepath.suffix in args.extensions:
            tokens = count_tokens_in_file(filepath, encoding)
            total_tokens += tokens
            file_count += 1
            tokens_by_extension[filepath.suffix] += tokens
            files_by_extension[filepath.suffix] += 1

    # Results
    print("=" * 60)
    print("📊 RESULTS")
    print("=" * 60)
    print(f"Total tokens:  {format_number(total_tokens)}")
    print(f"Total files:   {format_number(file_count)}")

    # Context window comparison (using generic sizes, tokens estimated via tiktoken)
    print("\nContext windows (tiktoken estimate):")
    context_windows = {
        "200K context": 200_000,
        "128K context": 128_000,
        "100K context": 100_000,
    }
    for name, size in context_windows.items():
        print(f"  - {name + ':':<20} {total_tokens/size:.1f}x")

    if tokens_by_extension:
        print("\n📁 By file type:")
        print("-" * 60)
        for ext in sorted(tokens_by_extension.keys(), key=lambda x: tokens_by_extension[x], reverse=True):
            tokens = tokens_by_extension[ext]
            files = files_by_extension[ext]
            pct = (tokens / total_tokens * 100) if total_tokens > 0 else 0
            print(f"  {ext:8s}  {format_number(tokens):>12s} tokens  ({files:>4d} files)  {pct:5.1f}%")

    print("=" * 60)


if __name__ == '__main__':
    main()
