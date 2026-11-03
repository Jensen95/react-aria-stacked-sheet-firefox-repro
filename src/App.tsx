import type { ReactNode } from 'react'
import {
  Button,
  Heading,
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
  SheetTrigger,
} from 'react-aria-components'

// Mirrors the React Aria starter Sheet: backdrop fades on the sheet's swipe timeline,
// parent sheet scales back when a child is stacked on top.
function StarterSheet({ children }: { children: ReactNode }) {
  return (
    <SheetOverlay>
      <SheetBackdrop swipeAnimation="sheet-backdrop" />
      <Sheet overscrollPadding stackAnimation="sheet-scale-back">
        <div className="sheet-handle" />
        <SheetContent>{children}</SheetContent>
      </Sheet>
    </SheetOverlay>
  )
}

export function App() {
  return (
    <main>
      <h1>Stacked Sheet backdrop flash</h1>
      <p>Open A, then open B. In Firefox with scroll-driven animations the dim behind the sheets flashes white.</p>
      <SheetTrigger>
        <Button>Open sheet A</Button>
        <StarterSheet>
          <Heading slot="title">Sheet A</Heading>
          <p>The bottom sheet. Its backdrop dims the page.</p>
          <SheetTrigger>
            <Button>Open sheet B</Button>
            <StarterSheet>
              <Heading slot="title">Sheet B</Heading>
              <p>Stacked on top of A.</p>
              <Button slot="close">Close sheet B</Button>
            </StarterSheet>
          </SheetTrigger>
        </StarterSheet>
      </SheetTrigger>
    </main>
  )
}
