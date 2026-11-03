#!/bin/bash
# PreToolUse guard (Bash, Read): refuse tool calls that would print the harness mnemonic or the test phrase.
# The harness scripts may read .e2e/wallet.json programmatically (they print addresses only); a shell command
# or a Read that would put the file's contents into the transcript is denied. Exit 0 with a deny decision.
input=$(cat)
python3 - "$input" <<'PY'
import json, re, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
tool = d.get("tool_name", "")
ti = d.get("tool_input", {}) or {}
secret_files = r"\.e2e/wallet(\.mainnet)?\.json"
reason = None
if tool == "Read":
    fp = ti.get("file_path", "") or ""
    if re.search(secret_files, fp):
        reason = f"{fp} holds the harness mnemonic. Print derived addresses instead (the wallet script does), never the file."
elif tool == "Bash":
    cmd = ti.get("command", "") or ""
    printers = r"\b(cat|less|more|head|tail|bat|strings|xxd|hexdump|od|base64|jq|open|code|vim|vi|nano|grep|rg|awk|sed|python3?|node|tsx|cp|scp|rsync|curl)\b"
    if re.search(secret_files, cmd) and re.search(printers, cmd) and not re.search(r"\b(chmod|ls|stat|rm|shred|test|\[)\b.*" + secret_files, cmd):
        reason = "that command would read or copy the harness wallet file, which holds the mnemonic. Use the harness scripts, which print only derived addresses."
    if re.search(r"\b(echo|printf|printenv|env)\b.*TEST_MNEMONIC|\$\{?TEST_MNEMONIC", cmd):
        reason = "that command would print TEST_MNEMONIC. Never print the phrase; print a fingerprint or derived addresses."
if reason:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "surge-borrow: " + reason}}))
sys.exit(0)
PY
