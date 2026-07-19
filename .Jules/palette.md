## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2024-05-19 - Screen Reader Verbosity with Decorative Elements and Dynamic Statuses
**Learning:** Found that dynamic status texts (like connection status or states) aren't announced automatically by screen readers, while purely decorative emoji icons inside buttons (that already have an `aria-label`) cause redundant audio output.
**Action:** Always add `aria-live="polite"` and `aria-atomic="true"` to text fields that update dynamically (like `#telemetry-status`), and use `aria-hidden="true"` on decorative elements within buttons (such as emojis) to ensure clear and concise screen reader announcements without redundancy.
