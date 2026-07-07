## 2026-07-07 - Focus Outlines Missing
**Learning:** Found elements using `outline: none` with no fallback for keyboard focus, causing an accessibility issue for users navigating by keyboard.
**Action:** Removed `outline: none` and added `:focus-visible` styling (with a retro cyan design, `var(--neon-cyan)`) to ensure custom UI elements remain keyboard accessible while looking right.
