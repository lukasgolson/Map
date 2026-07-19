## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2023-10-27 - Dynamic Status and Decorative Emojis Accessibility
**Learning:** Dynamic text elements (like status messages) require `aria-live="polite"` and `aria-atomic="true"` to be announced correctly by screen readers when they update. Purely decorative elements (like emojis in buttons that already have `aria-label` or text) cause redundant audio output and confusion if not explicitly hidden.
**Action:** Always use `aria-live` for dynamic status updates and `aria-hidden="true"` for purely decorative elements/emojis to prevent redundant screen reader announcements.
