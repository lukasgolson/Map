## 2026-07-08 - Custom Focus Styles in Retro UI
**Learning:** Retro and neon design systems frequently use `outline: none` to disable default browser focus rings to maintain aesthetics. This breaks keyboard navigation accessibility unless alternative explicit focus styles (like `:focus-visible`) are provided.
**Action:** When removing default outlines in custom UIs, always implement corresponding `:focus-visible` styles using the theme's highlight colors to ensure keyboard accessibility remains intact.
