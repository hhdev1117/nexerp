# Dashboard Scroll Resilience Design

## Goal

Keep the dashboard and the complete ERP navigation reachable by mouse, trackpad,
keyboard, and touch in browser and installed-PWA viewports.

## Observed Behavior

The current production build scrolls to the bottom at desktop and mobile widths.
The mobile navigation intentionally locks the page background while the fixed
drawer is open, and the drawer owns its own vertical scroll. The reported failure
is therefore treated as an installed-PWA, dynamic-viewport, or stale scroll-lock
edge case rather than a reason to remove the modal background lock.

## Design

- Preserve background locking while the mobile drawer is open.
- Size the mobile drawer with `100vh` as a fallback and `100dvh` for dynamic
  browser/PWA viewports.
- Make the drawer an explicit touch-scroll container with momentum scrolling,
  contained overscroll, and a stable scrollbar gutter.
- Centralize scroll-lock cleanup and run it when the drawer closes, the route
  changes, the layout unmounts, the viewport becomes desktop-sized, and a page is
  restored from the back-forward cache.
- Keep ordinary document scrolling for the dashboard and all routed content.

## Verification

Automated tests must prove that the drawer retains `overflow-y: auto`, dynamic
viewport sizing, and touch scrolling, and that every lifecycle exit removes the
body lock. Production verification must cover the dashboard and an expanded
mobile navigation at a short viewport.

