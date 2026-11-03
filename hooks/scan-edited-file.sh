#!/bin/bash
# PostToolUse (Edit, Write): scan the edited file for secrets and tell Claude if any appear.
# Patterns match the harness secret scanner: JWTs, extended private keys, PEM blocks, PSBTs, 65-byte signatures,
# private-key assignments. The tool has already run, so this cannot undo the write; it makes the problem visible at once.
input=$(cat)
python3 - "$input" <<'PY'
import json, re, sys, os
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
fp = (d.get("tool_input", {}) or {}).get("file_path", "") or ""
if not fp or not os.path.isfile(fp) or re.search(r"/node_modules/|/\.e2e/|pnpm-lock|package-lock|yarn\.lock", fp):
    sys.exit(0)
try:
    text = open(fp, encoding="utf8", errors="ignore").read()
except Exception:
    sys.exit(0)
patterns = [
    (r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", "a JWT"),
    (r"\b(xprv|tprv|vprv)[1-9A-HJ-NP-Za-km-z]{90,}", "an extended private key"),
    (r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----", "a PEM private key"),
    (r"\bcHNidP8[A-Za-z0-9+/=]{40,}", "a PSBT (base64)"),
    (r"\b70736274ff[0-9a-f]{40,}", "a PSBT (hex)"),
    (r"\b0x[0-9a-fA-F]{130}\b", "a 65-byte signature"),
    (r"(private[_-]?key|PRIVATE_KEY)\s*[:=]\s*[\"']?(0x)?[0-9a-fA-F]{64}", "a private-key assignment"),
]
hits = [what for rx, what in patterns if re.search(rx, text)]
if hits:
    print(json.dumps({"decision": "block", "reason": f"surge-borrow: {fp} now contains {', '.join(hits)}. Secrets, signatures and PSBTs never go into files; remove it and use a fixture assembled at runtime (the SDK's public Supabase anon keys are the one allowed JWT shape)."}))
sys.exit(0)
PY
