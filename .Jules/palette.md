## 2026-07-12 - Keyboard Accessibility and ARIA Progress
**Learning:** The retro styling used `outline: none;` which broke keyboard navigation. Adding `:focus-visible` restores accessibility without breaking mouse click states. Custom DOM elements used as progress bars must have ARIA properties dynamic mapped.
**Action:** Always add `:focus-visible` to interactive elements and `role=progressbar` to custom meters.
