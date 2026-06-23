---
"react-doctor": patch
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
"deslop-js": patch
"deslop-cli": patch
---

Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

The `react-doctor` CLI and programmatic `diagnose()` API also now print a one-time notice (once per process) when they detect a high-confidence AI/ML pipeline environment, pointing to the license terms.
