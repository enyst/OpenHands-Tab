# Repository Guidelines for Microagents

- Use real newlines in commit messages. Do not include literal \n sequences. For multi-paragraph messages, prefer one of:
  - git commit -m 'Subject' -m 'Body paragraph 1' -m 'Body paragraph 2'
  - git commit -F message.txt (where message.txt contains actual newlines)
  - git commit -m "Subject" && git commit --amend (to open editor and enter newlines)
- For feature branches and PRs, it is acceptable to rewrite history (reword/amend) before merge.
- Keep changes focused and avoid committing build artifacts or secrets.
