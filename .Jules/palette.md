## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2024-05-18 - Decorative Icons and Dynamic Text Accessibility
**Learning:** Decorative emojis in buttons (like 🦖 in 'FOLLOW' or 🔊 in 'SFX') that already have `aria-label`s create redundant noise for screen readers. Additionally, dynamically updating status fields (like '#telemetry-status') are missed by screen readers unless marked as live regions.
**Action:** Always add `aria-hidden="true"` to purely decorative elements inside buttons. Use `aria-live="polite"` and `aria-atomic="true"` on dynamic text containers to ensure seamless updates.
