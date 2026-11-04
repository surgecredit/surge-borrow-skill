---
description: Start a Surge.Credit borrowing integration: ask the per-project questions and write docs/SURGE-BRIEF.md from the skill's template
argument-hint: [wallet name]
allowed-tools: Read Write Glob
---

You are starting a Surge.Credit borrowing integration in this repository. The durable knowledge is in the surge-borrow skill; this command only produces the one-page per-project brief that the skill reads first.

1. Read the template at `${CLAUDE_PLUGIN_ROOT}/skills/surge-borrow/assets/brief-template.md` (if that path does not resolve, find `brief-template.md` under the installed surge-borrow skill).
2. Look at the repository to pre-fill what you can: the language and framework, the test runners, whether an EVM chain is already supported, how accounts are indexed. Say what you inferred and from which files.
3. Ask the user, one short message, for the fill-ins the template lists under "§1. This project" that you could not infer, with the options the template gives: WALLET_NAME (use "$ARGUMENTS" if given), TARGET (feature in an existing wallet or standalone app), PLATFORM, LANGUAGE and STACK, KEY_CUSTODY (software keys or external/hardware signers), ACCOUNT_MODEL, SIWE_ORIGIN (or localhost:3000 until Surge allowlists one), SURGE_CONTACT, WHERE_IT_LIVES. Also ask for the "§5. Inputs from the human" they can answer now (test mnemonic optional, SurgeSats access, mainnet endpoints and go/no-go).
4. Write `docs/SURGE-BRIEF.md`: the template with the placeholders replaced by the answers, nothing else changed. Keep §0, the definition of done, the contract (§3) and the inputs section verbatim; they are what the skill's build order and test levels refer to. The install commands in §0 stay as they are so the file also works for a teammate who has not installed the plugin yet.
5. Tell the user the brief is written and that the next step is "Read docs/SURGE-BRIEF.md and use the surge-borrow skill to build it", and that the first thing the skill will do is read its facts file and run wallet-free probes against both networks, so no coins are needed yet.

Never write a mnemonic, a key or a token into the brief; the harness generates its own test wallet later and the human supplies coins on request.
