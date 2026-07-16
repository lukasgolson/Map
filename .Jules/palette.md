## 2023-10-27 - Custom Progress Bars Accessibility
**Learning:** Found that custom visual progress and battery bars built with `<div>` elements were completely opaque to screen readers. We must explicitly set `role="progressbar"`, `aria-label`, `aria-valuemin`, `aria-valuemax` in the HTML, and dynamically update `aria-valuenow` via JavaScript (`app.js`) to maintain screen reader accessibility. Also, using `:focus-visible` ensures clear keyboard accessibility indicators without displaying persistent outlines for mouse users.
**Action:** Always add ARIA properties and `aria-valuenow` logic to custom data visualization/progress bars. Use `:focus-visible` with a theme-appropriate color (`var(--neon-cyan)`) for interactive elements.

## 2023-10-28 - Dynamic Status and Decorative Icons Accessibility
**Learning:** Dynamically updated text elements like status messages need `aria-live="polite"` and `aria-atomic="true"` for screen readers to announce changes. Furthermore, purely decorative elements like emojis within buttons that already have `aria-label` or text can cause redundant audio output and confusion for screen reader users.
**Action:** Use `aria-live` for dynamic status updates. Apply `aria-hidden="true"` to purely decorative elements, like emojis inside of labeled buttons, to streamline screen reader output.
