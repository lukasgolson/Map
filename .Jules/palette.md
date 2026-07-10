## 2024-07-10 - Retro Aesthetic vs Keyboard Accessibility
**Learning:** Retro/neon UI themes often use `outline: none` to strip default browser focus rings that clash with the custom aesthetic, but this severely degrades keyboard navigation accessibility.
**Action:** Always provide custom `:focus-visible` styles that match the aesthetic (e.g., using `--neon-cyan` outlines with offset and box-shadows for a glowing effect) when `outline: none` is applied to interactive elements.
