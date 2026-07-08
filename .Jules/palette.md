## 2026-07-08 - Added Focus Visible Styles for Neon Buttons
**Learning:** The app's neon buttons (`.neon-btn`) were missing focus states, making keyboard navigation difficult. The retro design system uses neon colors like cyan (`var(--neon-cyan)`) for focus.
**Action:** Implemented `:focus-visible` with a cyan outline to ensure keyboard users have visual indicators while respecting the app's aesthetic.
