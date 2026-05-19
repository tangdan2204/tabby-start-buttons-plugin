# tabby-start-buttons

Adds two fixed buttons to Tabby start page:
- Codex CLI
- Claude Code

## Local commands used
- Codex: `C:\Users\tangdan01\AppData\Local\Programs\PhpWebStudy-Data\env\node\codex.cmd`
- Claude: `C:\Users\tangdan01\AppData\Local\Programs\PhpWebStudy-Data\env\node\npx.cmd -y @anthropic-ai/claude-code`

## Reinstall into portable Tabby builtin plugins

```powershell
$src = 'G:\codex\tabby-start-buttons-plugin'
$dst = 'G:\codex\tabby-app\resources\builtin-plugins\tabby-start-buttons'
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse -Force $src $dst
```
