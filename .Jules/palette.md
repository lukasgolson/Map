## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2026-07-23 - Dynamic Text and Emoji Accessibility
**Learning:** Decorative emojis inside buttons that already have a text label or an `aria-label` can cause redundant or confusing announcements by screen readers. Also, dynamically updated text elements like status messages are ignored by screen readers unless specifically marked.
**Action:** Always add `aria-hidden="true"` to purely decorative elements, such as emoji icons inside buttons. For dynamically updated text elements (e.g., status messages), use `aria-live="polite"` and `aria-atomic="true"` to ensure screen readers announce the updates gracefully.
