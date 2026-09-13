# Dashboard Scroll Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard and navigation scrolling resilient in browser and installed-PWA viewports.

**Architecture:** Retain the existing document scroll and modal mobile drawer, but harden the drawer's viewport sizing and scroll ownership. Consolidate body-lock cleanup so navigation and browser lifecycle changes cannot leave the document locked.

**Tech Stack:** Vue 3, SCSS, Vitest, PrimeVue

**Spec:** `docs/superpowers/specs/2026-09-13-scroll-resilience-design.md`

## Global Constraints

- Preserve modal background locking while the mobile drawer is open.
- Do not add a second page-level scroll container.
- Support mouse, keyboard, trackpad, and touch input.
- Use `100vh` fallback followed by `100dvh` for installed-PWA compatibility.

---

### Task 1: Lock Cleanup And Drawer Scrolling

**Files:**
- Modify: `src/layout/AppLayout.vue`
- Modify: `src/assets/layout/_menu.scss`
- Modify: `src/assets/layout/_responsive.scss`
- Test: `src/layout/erp-shell.test.js`

**Interfaces:**
- Consumes: `layoutState.mobileMenuActive`, `hideMobileMenu()`, existing `.blocked-scroll` and `.layout-sidebar` classes.
- Produces: `releasePageScrollLock()` lifecycle cleanup and a dynamic-viewport touch-scroll drawer.

- [ ] **Step 1: Write failing layout tests**

Add assertions that the layout registers and removes a `pageshow` listener, uses
one `releasePageScrollLock` helper from close/unmount/route/resize paths, and that
mobile sidebar CSS includes `height: 100dvh`, `max-height: 100dvh`,
`overscroll-behavior: contain`, `touch-action: pan-y`,
`-webkit-overflow-scrolling: touch`, and `scrollbar-gutter: stable`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- --run src/layout/erp-shell.test.js`

Expected: FAIL because the lifecycle helper and hardened scroll declarations do
not exist.

- [ ] **Step 3: Implement the minimum lifecycle and CSS changes**

Create `releasePageScrollLock()` in `AppLayout.vue`, call it whenever the drawer
is no longer active, before route focus management, on desktop resize, on
`pageshow` when the drawer is closed, and during unmount. Register and remove the
`pageshow` listener beside the existing resize listener. Add the specified
scroll-container declarations to `.layout-sidebar`; retain `100vh` before
`100dvh` in the mobile rule.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- --run src/layout/erp-shell.test.js`

Run: `npm test -- --run`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/AppLayout.vue src/assets/layout/_menu.scss src/assets/layout/_responsive.scss src/layout/erp-shell.test.js docs/superpowers/specs/2026-09-13-scroll-resilience-design.md docs/superpowers/plans/2026-09-13-scroll-resilience.md
git commit -m "fix: harden dashboard and navigation scrolling"
```

