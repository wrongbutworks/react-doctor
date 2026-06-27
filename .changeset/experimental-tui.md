---
"react-doctor": minor
---

Add an experimental interactive TUI (`react-doctor experimental-tui`) built on Ink. It streams diagnostics live during the scan, then renders a scrollable, score-sorted report (no top-3 truncation) with the doctor-face score header, score projection ("you could improve +X%"), per-category breakdown, and an inline syntax-highlighted code frame for the selected issue. It also supports monorepo project selection (an interactive multiselect) and a multi-project summary view with drill-in per project. Ink/React load lazily so the default static, JSON, and score-only paths are unaffected.
