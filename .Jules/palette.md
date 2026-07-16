## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2024-05-19 - ARIA Live Regions and Hidden Decorative Elements
**Learning:** Found that dynamic status updates (like `#telemetry-status`) were not being announced by screen readers when updated via JavaScript, and decorative emoji icons in control buttons were being redundantly read alongside their visible text/ARIA labels, causing auditory clutter.
**Action:** Always add `aria-live="polite"` and `aria-atomic="true"` to elements that receive dynamic text updates (like status messages). Apply `aria-hidden="true"` to purely decorative elements, such as emojis inside buttons that already have proper `aria-label`s or descriptive text.
