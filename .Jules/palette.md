## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2026-07-21 - Status Updates and Decorative Emojis
**Learning:** Found that dynamically updated text elements (e.g., status messages) require `aria-live="polite"` and `aria-atomic="true"` for screen readers. Purely decorative elements, such as emoji icons inside buttons that already have a text or aria-label, should have `aria-hidden="true"` to prevent redundant audio output.
**Action:** Always add `aria-live` and `aria-atomic` to elements receiving dynamic status updates, and hide redundant decorative icons using `aria-hidden="true"`.
