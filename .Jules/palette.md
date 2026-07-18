## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2026-07-18 - Retro HUD Accessibility
**Learning:** Found that decorative icons (e.g., emojis inside icon-only buttons) cause redundant screen reader announcements if they aren't explicitly hidden using `aria-hidden="true"`. Also, dynamically updated readouts like status messages need `aria-live="polite"` and `aria-atomic="true"` to correctly notify users when state changes.
**Action:** Always add `aria-hidden="true"` to decorative elements or emojis in buttons. Ensure dynamic status readouts in the HUD are marked as live regions.
