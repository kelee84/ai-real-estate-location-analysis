---
name: real-estate-search
description: Korean apartment/officetel/villa/single-house real transaction price and rent lookups via k-skill-proxy. Based on tae0y's real-estate-mcp and MOLIT public data APIs.
license: MIT
metadata:
  category: real-estate
  locale: ko-KR
  phase: v1
---

# real-estate-search

## Read the pinned local instructions

Read [instruction.md](instruction.md) before using this skill. This installation
includes the instructions and helpers from GitHub commit
`50d7bb30f9e2d6b8b09da1055d497fe616820e30`.
Use the documented read-only HTTP endpoints directly. Do not run the upstream
npm instruct/update commands as part of routine lookup: they fetch a different,
unreviewed version and the update command changes unrelated skills.
For nationwide reports, run the bundled Python helper as documented locally.

## Hard rules even without the CLI

- Never execute payment, message/email delivery, final submission, cancellation, or public posting without the user's explicit approval immediately beforehand.
- Never ask for, print, or store plaintext credentials in chat, files, or shell arguments.
- Never bypass legal, physical-presence, CAPTCHA, identity-proofing, or electronic-signature boundaries.
