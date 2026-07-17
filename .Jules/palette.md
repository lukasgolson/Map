## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2024-07-17 - Redundant Emoji Audio and Dynamic Status Announcements
**Learning:** Found that screen readers can redundantly read out emoji descriptions inside buttons that already have `aria-label` or text labels. Also, dynamic text updates (like `#telemetry-status`) go unnoticed by screen readers without ARIA live regions.
**Action:** Use `aria-hidden="true"` on decorative emoji icons inside labeled interactive elements to prevent redundant audio output. Add `aria-live="polite"` and `aria-atomic="true"` to elements with dynamically updated text that should be announced to the user.
