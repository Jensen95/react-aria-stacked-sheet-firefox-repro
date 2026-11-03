// Builds the app, serves it with `vite preview`, then in Firefox (scroll-driven animations pref on)
// and Chromium opens sheet A, opens sheet B on top, closes B, and samples every animation frame:
// the dim each SheetBackdrop paints (opacity x background alpha) and which dialog the bottom
// backdrop's animation timeline is attached to. Usage: npm run check [-- --headed]
import { spawn, spawnSync } from 'node:child_process'
import { chromium, firefox } from 'playwright'

const PORT = 4173
const BASE = `http://localhost:${PORT}/`
// Sheet A's backdrop paints rgb(0 0 0 / 0.4); anything under this is a white page showing through.
const NO_DIM = 0.05

function sampler() {
  const labelOf = (el) => {
    if (!el) return 'none'
    const title = el.querySelector?.('[slot="title"]')
    return title ? `${title.textContent} dialog` : el.tagName.toLowerCase()
  }
  const alphaOf = (color) => {
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (!m) return 0
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    return parts.length === 4 ? parseFloat(parts[3]) : 1
  }
  window.__samples = []
  window.__phase = 'idle'
  // Every view-timeline-name each dialog has carried: the one it is inserted into the DOM with
  // (React's first commit), then whatever it has at each frame.
  window.__names = new Map()
  const push = (d, name) => {
    const seq = window.__names.get(d) ?? []
    if (seq.at(-1) !== name) seq.push(name)
    window.__names.set(d, seq)
  }
  for (const method of ['appendChild', 'insertBefore']) {
    const original = Node.prototype[method]
    Node.prototype[method] = function (node, ...rest) {
      const result = original.call(this, node, ...rest)
      if (node.nodeType === 1 && node.isConnected)
        for (const d of node.querySelectorAll('[data-sheet-content]')) push(d, d.style.viewTimelineName)
      return result
    }
  }
  const tick = () => {
    requestAnimationFrame(tick)
    const backdrops = [...document.querySelectorAll('.react-aria-SheetBackdrop')].map((el) => {
      const cs = getComputedStyle(el)
      const anim = el.getAnimations()[0]
      const tl = anim?.timeline
      return {
        stackIndex: el.dataset.stackIndex,
        hasDescendants: el.hasAttribute('data-has-descendants'),
        opacity: parseFloat(cs.opacity),
        alpha: alphaOf(cs.backgroundColor),
        animationTimeline: cs.animationTimeline,
        timeline: tl ? tl.constructor.name : 'none',
        subject: tl && 'subject' in tl ? labelOf(tl.subject) : tl ? 'n/a' : 'none',
      }
    })
    const dialogs = [...document.querySelectorAll('[data-sheet-content]')].map((d) => {
      push(d, d.style.viewTimelineName)
      return `${labelOf(d)}=${d.style.viewTimelineName}`
    })
    const dim = 1 - backdrops.reduce((keep, b) => keep * (1 - b.opacity * b.alpha), 1)
    window.__samples.push({ t: performance.now(), phase: window.__phase, dim, backdrops, dialogs })
  }
  requestAnimationFrame(tick)
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('vite preview did not start')
}

async function run(name, launch, workaround) {
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: 'no-preference' })
  await page.addInitScript(sampler)
  await page.goto(BASE + (workaround ? '?workaround=1' : ''))
  const supportsViewTimeline = await page.evaluate(() => CSS.supports('animation-timeline: view()'))
  const version = browser.version()

  await page.getByRole('button', { name: 'Open sheet A' }).click()
  await page.getByRole('dialog', { name: 'Sheet A' }).waitFor()
  await page.waitForTimeout(1200)
  await page.evaluate(() => (window.__phase = 'open B'))
  await page.getByRole('button', { name: 'Open sheet B' }).click()
  await page.getByRole('dialog', { name: 'Sheet B' }).waitFor()
  await page.waitForTimeout(1200)
  await page.evaluate(() => (window.__phase = 'close B'))
  await page.getByRole('button', { name: 'Close sheet B' }).click()
  await page.getByRole('dialog', { name: 'Sheet B' }).waitFor({ state: 'detached' })
  await page.waitForTimeout(800)
  const samples = await page.evaluate(() => window.__samples)
  const nameHistory = await page.evaluate(() =>
    [...window.__names].map(([d, seq]) => `${d.querySelector('[slot="title"]')?.textContent}: ${seq.join(' -> ')}`),
  )
  await browser.close()

  const lines = [
    `\n=== ${name}${workaround ? ' + workaround (?workaround=1)' : ''} — ${version}, CSS.supports('animation-timeline: view()') = ${supportsViewTimeline}`,
  ]
  lines.push(`  view-timeline-name history per dialog: ${nameHistory.join('; ')}`)
  let flashed = false
  for (const phase of ['open B', 'close B']) {
    const s = samples.filter((x) => x.phase === phase)
    const t0 = s[0].t
    const noDim = s.filter((x) => x.dim < NO_DIM)
    const bottom = (x) => x.backdrops.find((b) => b.stackIndex === '0')
    const boundToB = s.filter((x) => bottom(x)?.subject === 'Sheet B dialog')
    flashed ||= noDim.length > 0
    lines.push(
      `  ${phase}: ${s.length} frames, min dim ${Math.min(...s.map((x) => x.dim)).toFixed(3)} (A alone = 0.400), ` +
        `${noDim.length} frames with no dim (< ${NO_DIM}), ` +
        `${boundToB.length} frames with bottom backdrop's timeline subject = Sheet B dialog`,
    )
    const dipped = s.filter((x) => x.dim < 0.39)
    if (dipped.length)
      lines.push(
        `    dim below 0.39 from +${(dipped[0].t - t0).toFixed(0)}ms to +${(dipped.at(-1).t - t0).toFixed(0)}ms`,
      )
    // Print the frames around the first dip (or the first few frames when there is none).
    const first = Math.max(0, s.findIndex((x) => x.dim < 0.39))
    for (const x of s.slice(Math.max(0, first - 2), first + 6)) {
      const b = bottom(x)
      lines.push(
        `    +${(x.t - t0).toFixed(0).padStart(4)}ms dim=${x.dim.toFixed(3)} ` +
          `bottom: opacity=${b?.opacity.toFixed(3)} timeline=${b?.timeline}(${b?.animationTimeline}) subject=${b?.subject}` +
          `${b?.hasDescendants ? ' [has-descendants]' : ''} | ${x.dialogs.join(' ')}`,
      )
    }
  }
  lines.push(`  RESULT: ${flashed ? 'FLASH — frames with no dim behind the sheets' : 'no flash'}`)
  console.log(lines.join('\n'))
  return flashed
}

const build = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
const headless = !process.argv.includes('--headed')
try {
  await waitForServer()
  const ff = () =>
    firefox.launch({ headless, firefoxUserPrefs: { 'layout.css.scroll-driven-animations.enabled': true } })
  const cr = () => chromium.launch({ headless })
  const results = {
    'Firefox (pref on)': await run('Firefox, layout.css.scroll-driven-animations.enabled=true', ff, false),
    Chromium: await run('Chromium', cr, false),
    'Firefox (pref on) + workaround': await run('Firefox, layout.css.scroll-driven-animations.enabled=true', ff, true),
    'Chromium + workaround': await run('Chromium', cr, true),
  }
  console.log('\nSummary:')
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(32)} ${v ? 'FLASH' : 'no flash'}`)
} finally {
  process.kill(-server.pid)
}
