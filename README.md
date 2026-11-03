# react-aria-components Sheet: stacked sheet flashes the backdrop in Firefox

When a second `Sheet` opens on top of an open one, the bottom sheet's `SheetBackdrop` dim drops to
zero for about 450 ms in Firefox with scroll-driven animations enabled, so the white page flashes
around the sheets. It happens again, for a frame or two, when that top sheet closes. It only happens
the first time a nested sheet opens after the bottom sheet opened: later B opens and closes while A
stays open do not flash, and the next B open flashes again once A has been closed and reopened. On its first
render the new sheet is not registered in the sheet stack yet, so it takes stack index 0 and gives
its dialog `view-timeline-name: --sheet-timeline-0`. That is the same name the bottom backdrop's
`swipeAnimation` uses as its `animation-timeline`. React renames the dialog to `--sheet-timeline-1`
in the same task, but Firefox has already attached the bottom backdrop's animation to the new dialog
and keeps it there, so the backdrop's opacity follows the new sheet's entry from 0 to 1. Chromium
resolves the name again after the rename and does not flash. After that first B is removed, the
backdrop's animation stays attached to the detached B dialog, which is why later opens do not flash
(see [Why only the first open flashes](#why-only-the-first-open-flashes)).

Reported on Windows, Firefox Developer Edition 160.0b1 (64-bit); reproduced on Linux with Playwright
Firefox 157 with the pref enabled.

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

Reload the page between attempts: only the first nested open after A opens flashes.

1. `npm install`
2. `npm run dev`, then open http://localhost:5173/ in Firefox.
3. Turn on scroll-driven animations: in `about:config`, set
   `layout.css.scroll-driven-animations.enabled` to `true` if it is not already, then reload.
   In the console, `CSS.supports('animation-timeline: view()')` should now return `true`. If it
   returns `false`, the Sheet uses its 300 ms fallback animation and the bug does not show.
4. Click **Open sheet A** and wait for it to settle. The page behind it is dimmed.
5. Click **Open sheet B**. The area outside the sheets flashes white while B slides in.
6. Click **Close sheet B**. The dim drops out again briefly as B leaves.
7. Open B and close it again: no flash this time. Close A, open it again, and open B: it flashes
   again. Reload the page to start over.

Open http://localhost:5173/?workaround=1 to see the same page with the workaround below applied.

**Expected:** the page behind the sheets stays dimmed by A's backdrop the whole time, as it does in
Chromium.
**Actual (Firefox with the pref on):** the dim goes to zero while B enters, then fades back in as B
finishes entering. It also drops to zero for a frame or two when B closes. Later B opens and closes
with A still open do not flash.

### Automated check

`npm run check` (`scripts/check-flash.mjs`) builds the app, serves it with `vite preview`, and in
**one page load** per browser runs: open A, open B, close B, open B, close B, close A, open A, open B,
close B. It does this in headless Firefox (pref on) and Chromium, with and without `?workaround=1`.
On every animation frame it records:

- the dim each `.react-aria-SheetBackdrop` paints (computed `opacity` x background alpha),
- the element that the bottom backdrop's `getAnimations()[0].timeline.subject` points to, whether it
  is still connected, the timeline's `currentTime`, and the animation's `playState` and progress,
- each dialog's `view-timeline-name`, including the one it has when it is inserted into the DOM.

Result per step, Firefox 157 with the pref on, identical in 3 runs (A alone dims 0.40; "no dim" is a
frame under 0.05; `#n` numbers the dialogs in creation order):

| Step | Min dim | Frames with no dim | Bottom backdrop timeline subject, at the end of the step |
|---|---|---|---|
| B open (1st) | 0.00 | 12-13 | Sheet B#2, connected, `currentTime` 19902.64 |
| B close (1st) | 0.00 | 1 | Sheet B#2, **detached**, `currentTime` null |
| B open (2nd) | 0.40 | 0 | Sheet B#2, detached, `currentTime` null |
| B close (2nd) | 0.40 | 0 | Sheet B#2, detached, `currentTime` null |
| A close, A open | n/a | n/a | A's backdrop is removed, then a new one is created on Sheet A#4 |
| B open (3rd, after A reopened) | 0.00 | 12-13 | Sheet B#5, connected |
| B close (3rd) | 0.00 | 1 | Sheet B#5, detached, `currentTime` null |

Chromium: min dim 0.40 and 0 frames with no dim in every step, subject always the current A dialog.
Firefox with `?workaround=1`: min dim 0.40 and 0 frames with no dim in every step (the bottom
backdrop has no animation while B is open). Closing and reopening A dims from and to 0 by design, so
those steps do not count as a flash.

Excerpt (Firefox, one run; the full output also lists the `view-timeline-name` history):

```
  B1 open   min dim 0.00, 13 frames < 0.05 | first: Sheet A#1 ViewTimeline t=19902.64 finished p=1.00 op=1.00 | last: Sheet B#2 ViewTimeline t=19902.64 finished p=1.00 op=1.00
  B1 close  min dim 0.00,  1 frames < 0.05 | first: Sheet B#2 ...                                            | last: Sheet B#2(detached) ViewTimeline t=null running p=undefined op=1.00
  B2 open   min dim 0.40,  0 frames < 0.05 | first: Sheet B#2(detached) ViewTimeline t=null running ...    | last: Sheet B#2(detached) ViewTimeline t=null running p=undefined op=1.00
  B2 close  min dim 0.40,  0 frames < 0.05 | first: Sheet B#2(detached) ...                                | last: Sheet B#2(detached) ...
  B3 open   min dim 0.00, 13 frames < 0.05 | first: Sheet A#4 ViewTimeline t=19902.64 finished ...        | last: Sheet B#5 ViewTimeline t=19902.64 finished ...
  B3 close  min dim 0.00,  1 frames < 0.05 | first: Sheet B#5 ...                                          | last: Sheet B#5(detached) ViewTimeline t=null running p=undefined op=1.00
```

### Why only the first open flashes

From the output above:

- Each time A opens, its backdrop gets a new animation. On the first B open after that, the animation's
  timeline subject changes from A's dialog to B's dialog (`Sheet A#1` to `Sheet B#2`), and the dim
  follows B's entry, then B's exit.
- When B is removed, the subject stays that detached B dialog: `isConnected` is false and the
  timeline's `currentTime` is `null`, i.e. the timeline is inactive. The animation's `playState` is
  `running`, it has no progress, and the backdrop paints opacity 1.00 (A's full dim).
- On the next B open, the new B dialog does not become the subject (the subject is still the detached
  `Sheet B#2`), so nothing moves the backdrop's opacity and the dim stays at 0.40. This repeats on
  every later open and close while A stays open.
- When A is closed, its backdrop is removed. The new A's backdrop gets a new animation, which is bound
  to the next B's dialog again (`Sheet B#5`), and the sequence repeats.

This fits one new animation being re-bound to the first same-named dialog, and staying on it. The
check does not show whether the animation holds an end keyframe or has no effect while the timeline is
inactive: the backdrop's base opacity is also 1, so both paint 1.00.

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

The Linux result comes from Playwright's headless Firefox 157.0 build with the pref set through
`firefoxUserPrefs`. The Windows Firefox Developer Edition 160.0b1 report is the user's; it was not
run here, and the per-step sequence was only run in Playwright's Firefox 157.

Whether scroll-driven animations are on by default in Developer Edition or Nightly 160 is not
verified from a release note. The 160 beta release notes do not mention them. MDN's
browser-compat-data lists `animation-timeline` for Firefox as `version_added: "159"` with no flag
entry, which suggests it is on by default there; the pref's default value in 160.0b1 was not read.
Check `about:config` for `layout.css.scroll-driven-animations.enabled` and
`CSS.supports('animation-timeline: view()')`. `npm run dev` (React
StrictMode, dev build) also flashes in the same Firefox, which was checked with a one-off run of the
same sampler against the dev server.

---

Prepared with [Claude Code](https://claude.com/claude-code).
