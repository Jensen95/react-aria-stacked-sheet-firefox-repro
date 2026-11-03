# react-aria-components Sheet: stacked sheet flashes the backdrop in Firefox

When a second `Sheet` opens on top of an open one, the bottom sheet's `SheetBackdrop` dim drops to
zero for about 450 ms in Firefox with scroll-driven animations enabled, so the white page flashes
around the sheets. It happens again, for a frame or two, when the top sheet closes. On its first
render the new sheet is not registered in the sheet stack yet, so it takes stack index 0 and gives
its dialog `view-timeline-name: --sheet-timeline-0`. That is the same name the bottom backdrop's
`swipeAnimation` uses as its `animation-timeline`. React renames the dialog to `--sheet-timeline-1`
in the same task, but Firefox has already attached the bottom backdrop's animation to the new dialog
and keeps it there, so the backdrop's opacity follows the new sheet's entry from 0 to 1. Chromium
resolves the name again after the rename and does not flash.

## Versions

| | |
|---|---|
| react-aria-components | **1.22.1** (pinned) |
| react / react-dom | 19.2.9 |
| vite / @vitejs/plugin-react | 7.2.7 / 5.1.4 |
| typescript | 5.9.3 |
| playwright (check script only) | 1.64.1 |
| Firefox used by the check | Playwright Firefox 157.0 (`firefox-1555`), `layout.css.scroll-driven-animations.enabled=true` |
| Chromium used by the check | Playwright Chromium 156.0.8078.4 (`chromium-1248`) |

## Reproduce

1. `npm install`
2. `npm run dev`, then open http://localhost:5173/ in Firefox.
3. Turn on scroll-driven animations: in `about:config`, set
   `layout.css.scroll-driven-animations.enabled` to `true` (Nightly and early builds), then reload.
   In the console, `CSS.supports('animation-timeline: view()')` should now return `true`. If it
   returns `false`, the Sheet uses its 300 ms fallback animation and the bug does not show.
4. Click **Open sheet A** and wait for it to settle. The page behind it is dimmed.
5. Click **Open sheet B**. The area outside the sheets flashes white while B slides in.
6. Click **Close sheet B**. The dim drops out again briefly as B leaves.

Open http://localhost:5173/?workaround=1 to see the same page with the workaround below applied.

**Expected:** the page behind the sheets stays dimmed by A's backdrop the whole time, as it does in
Chromium.
**Actual (Firefox with the pref on):** the dim goes to zero while B enters, then fades back in as B
finishes entering. It also drops to zero for a frame or two when B closes.

### Automated check

`npm run check` (`scripts/check-flash.mjs`) builds the app, serves it with `vite preview`, and runs
the steps above in headless Firefox (pref on) and Chromium, with and without `?workaround=1`. On every
animation frame it records:

- the dim each `.react-aria-SheetBackdrop` paints (computed `opacity` × background alpha),
- the element that the bottom backdrop's `getAnimations()[0].timeline.subject` points to,
- each dialog's `view-timeline-name`, including the one it has when it is inserted into the DOM.

Excerpt from a run:

```
=== Firefox, layout.css.scroll-driven-animations.enabled=true — 157.0, CSS.supports('animation-timeline: view()') = true
  view-timeline-name history per dialog: Sheet A: --sheet-timeline-0; Sheet B: --sheet-timeline-0 -> --sheet-timeline-1
  open B: 77 frames, min dim 0.000 (A alone = 0.400), 13 frames with no dim (< 0.05), 73 frames with bottom backdrop's timeline subject = Sheet B dialog
    dim below 0.39 from +69ms to +533ms
    +  51ms dim=0.400 bottom: opacity=1.000 timeline=ViewTimeline(--sheet-timeline-0) subject=Sheet A dialog | Sheet A dialog=--sheet-timeline-0
    +  69ms dim=0.000 bottom: opacity=0.000 timeline=ViewTimeline(--sheet-timeline-0) subject=Sheet B dialog [has-descendants] | Sheet A dialog=--sheet-timeline-0 Sheet B dialog=--sheet-timeline-1
  close B: 65 frames, min dim 0.000 (A alone = 0.400), 1 frames with no dim (< 0.05), 65 frames with bottom backdrop's timeline subject = Sheet B dialog
  RESULT: FLASH — frames with no dim behind the sheets

=== Chromium — 156.0.8078.4, CSS.supports('animation-timeline: view()') = true
  view-timeline-name history per dialog: Sheet A: --sheet-timeline-0; Sheet B: --sheet-timeline-0 -> --sheet-timeline-1
  open B: 76 frames, min dim 0.400 (A alone = 0.400), 0 frames with no dim (< 0.05), 0 frames with bottom backdrop's timeline subject = Sheet B dialog
  close B: 61 frames, min dim 0.400 (A alone = 0.400), 0 frames with no dim (< 0.05), 0 frames with bottom backdrop's timeline subject = Sheet B dialog
  RESULT: no flash

Summary:
  Firefox (pref on)                FLASH
  Chromium                         no flash
  Firefox (pref on) + workaround   no flash
  Chromium + workaround            no flash
```

Both browsers insert B's dialog as `--sheet-timeline-0`. Only Firefox leaves A's backdrop animation
on B's dialog after the rename: the subject is still B's dialog after B has closed and been removed.

## Root cause

References are to react-aria-components 1.22.1: the published `dist/private/Sheet.mjs`, and the
source it maps to, `packages/react-aria-components/src/Sheet.tsx` (tag
`react-aria-components@1.22.1`, commit
[`740c6c5`](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx).
The `sourcesContent` in `Sheet.mjs.map` is identical to that file).

| What | `dist/private/Sheet.mjs` | `src/Sheet.tsx` |
|---|---|---|
| Module-level `sheetStack`, and `emitStackChange`, which also sets `timeline-scope` on `<html>` | l.43–54 | [L163–175](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L163-L175) |
| `registerSheet` | l.61–71 | [L184–191](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L184-L191) |
| A sheet registers only in the overlay's ref callback, after its first commit | l.152 | [L311](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L311) |
| `index = Math.max(0, sheetStack.findIndex(e => e.id === id))`: an unregistered sheet gets index **0** | l.168–169 | [L323–327](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L323-L327) |
| `SheetBackdrop` `swipeAnimation`: `animationTimeline: --sheet-timeline-${index}` | l.699–708 (l.701) | [L1036–1046](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L1036-L1046) (L1039) |
| `SheetContent` dialog: `viewTimelineName: --sheet-timeline-${index}` | l.739 | [L1099](https://github.com/adobe/react-spectrum/blob/740c6c5c4a717ca8c82fc4d15d199f6166cd42dc/packages/react-aria-components/src/Sheet.tsx#L1099) |

Sequence when B opens over A:

1. B's first commit inserts its dialog with `view-timeline-name: --sheet-timeline-0`. B is not in
   `sheetStack` yet, so `findIndex` returns -1, which is clamped to 0.
2. B's ref callback calls `registerSheet`. The store update re-renders B with index 1, and its
   dialog becomes `--sheet-timeline-1` before the next frame.
3. Between steps 1 and 2, A's dialog and B's dialog are both named `--sheet-timeline-0`. Firefox
   attaches A's backdrop animation (`animation-timeline: --sheet-timeline-0`) to B's dialog and does
   not resolve the name again after step 2. A's backdrop opacity then follows B's view progress, starting near 0 while B is
   off-screen. Chromium resolves the name again and A's backdrop stays on A's dialog.

## Workaround

Turn off the backdrop's swipe animation while another sheet is stacked on top of it
(`src/styles.css`, enabled here with `?workaround=1`):

```css
.react-aria-SheetBackdrop[data-has-descendants] {
  animation: none !important;
}
```

The check above shows no flash in Firefox with this rule. The bottom backdrop has no animation
while B is open, and it gets one again only after B has unregistered, when `--sheet-timeline-0`
names A's dialog alone. The animation it turns off follows A's own swipe, and A is covered by B
while the rule applies.

## Suggested fix

Do not give an unregistered sheet a name that a registered sheet is already using. Either:

- use `sheetStack.length` instead of 0 when the sheet is not in the stack yet:
  ```ts
  let found = sheetStack.findIndex(e => e.id === id);
  let index = found === -1 ? sheetStack.length : found;
  ```
- or leave out `view-timeline-name` and `animation-timeline` until the sheet is registered.

The first option was tried by editing line 169 of `dist/private/Sheet.mjs` locally (not committed).
`npm run check` then reported B's dialog as `--sheet-timeline-1` from its first insertion, and no
flash in Firefox or Chromium.

## Not verified

The Firefox result comes from Playwright's headless Firefox 157.0 build with the pref set through
`firefoxUserPrefs`, not from a Firefox Nightly desktop install checked by eye. `npm run dev` (React
StrictMode, dev build) also flashes in the same Firefox, which was checked with a one-off run of the
same sampler against the dev server.

---

Prepared with [Claude Code](https://claude.com/claude-code).
