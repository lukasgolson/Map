## 2026-07-09 - [Keyboard Accessibility in Retro UIs]
**Learning:** Highly stylized 'retro' UIs (like those mimicking CRTs or neon arcades) often strip default browser styles but forget to replace `:focus`/`:focus-visible` states. This makes keyboard navigation completely invisible to screen reader and keyboard-only users.
**Action:** Always verify that custom buttons and inputs (e.g. `.neon-btn`, `select`) have an explicit `:focus-visible` state using the system's existing high-contrast accent colors (e.g., `--neon-cyan`).
