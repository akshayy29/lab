# Rate limiter visualizer redesign — design & implementation spec

**Status:** approved direction, not yet implemented
**Owner:** Akshay · **Spec version:** 1.0 (2026-07-06)
**Applies to:** `rate-limiter/index.html`, `assets/lab.js`, `assets/lab.css`

---

## 1. Why this redesign

The current panels show **state** (gauge bars) and **decisions** (accept/reject tape), but never the **mechanism** — *why* a request bounced. The metaphors in these algorithms are literally physical (buckets, windows, queues) and we render them as progress bars. The redesign replaces each panel's gauge with an animated "chamber" that shows the mechanism itself.

**Core decision: each algorithm gets the visualization that fits its essence.** We do NOT force one metaphor across all four:

| Algorithm | Essence | Chamber visual |
|---|---|---|
| Fixed window | counting in a time box | scrolling timeline with a boundary grid |
| Sliding window | counting in a trailing time range | same timeline with a sliding lens |
| Token bucket | a saved-up balance | jar of token coins with a drip refill |
| Leaky bucket | waiting in line | queue in front of a metronome gate |

The two window algorithms deliberately share one canvas type (timeline). Their only visual difference — rigid grid vs gliding lens — *is* the lesson.

---

## 2. Shared visual language (applies to every chamber)

These rules make four different chambers feel like one instrument. Breaking any of them makes the page feel like four unrelated widgets.

### 2.1 The request dot
- One dot = one request. Same size, shape, and physics everywhere.
- Radius: **5 px** desktop, **4 px** below 640 px viewport. Solid fill, no stroke, no shadow, no glow.
- Colors (already CSS vars in `lab.css`):
  - in flight / queued / undecided: `--accent` `#38bdf8`
  - accepted: `--accept` `#34d399`
  - rejected: `--reject` `#f87171`
- A dot changes color **at the instant of decision**, never gradually.

### 2.2 Direction grammar (never violate)
- Requests **enter from the left**.
- Accepted requests **exit right** and leave the canvas.
- Rejected requests **fall downward and fade out** (gravity arc + alpha → 0). Position + motion encode the outcome, so color is never the only signal (accessibility).
- Time, where drawn, flows **left → right**.

### 2.3 Two clocks: simulation time vs wall-clock time
This is the most important engineering rule in the spec:

- **Simulation time** (scaled by the speed control, 0.25×–2×) governs *when things happen*: arrivals, token refills, gate ticks, window boundaries, timeline scrolling.
- **Wall-clock time** (never scaled) governs *how dots move*: flight durations, bounce, fade.

Rationale: at 0.25× we want slow, sparse *events* with snappy, satisfying *motion*. Scaling dot motion by playback speed makes the page feel laggy, not calm. (Decision made explicitly — do not "fix" this by scaling animations.)

Exact motion timings (wall-clock):
- Arrival flight (left edge → landing/queue/gate): **300 ms**, ease-out.
- Accepted exit flight: **250 ms**, ease-in.
- Rejection: small horizontal recoil (≈ −12 px), then fall **420 ms** with a gravity curve, fading to alpha 0.
- Token-coin consumption pop: **150 ms** shrink-and-fade.

### 2.4 Decision ≠ animation
The simulation decides accept/reject **synchronously at the arrival instant** (exactly as `fireArrival()` does today). Animations are pure presentation replaying that decision. Counters, strips, badges, and scoreboard must be driven by the simulation, never by animation completion. A dropped animation frame must never change a number.

### 2.5 Canvas conventions
- One chamber canvas per panel: full panel-viz width × **140 px** desktop / **120 px** mobile.
- DPR-aware rendering exactly like `Lab.Strip._resize()` (clamp DPR at 2).
- `clearRect` + full redraw each frame. Flat solid fills only — **no gradients, shadows, blur, or glow** (matches lab aesthetic and keeps frame cost low).
- Background: `--surface-2` `#16233c`, radius 6 px (match `.strip`).

### 2.6 Arrival pattern
Current baseline (intentional, keep): arrivals are **evenly spaced** at `1/rate` sim-seconds — calm and predictable for learning. Do not reintroduce Poisson arrivals as the default. Optional future toggle "jitter: on/off" may add exponential gaps back; if added, it must default to off.

---

## 3. Per-chamber specs

### 3.1 Fixed window — scrolling timeline with boundary grid

**Layout:** the canvas is a world that scrolls right-to-left; "now" is a fixed playhead at **65% of canvas width**. Vertical gridlines mark window boundaries every `W` sim-seconds. Scale: `pxPerSimSecond = min(canvasWidth / (2.5 * W), 220)` — always ≈2.5 windows visible; recompute when `W` changes (snap, no tween).

**Behavior:**
- A dot arrives (flight from left, wall-clock), lands at the playhead's current x, and **stacks vertically** bottom-up inside the current window segment. Slot height = canvas height / `L` (capped so dots never overlap the top edge; if `L` > 12, shrink dot radius to fit rather than clipping).
- Landed dots scroll left with the world and stay visible as history until they scroll off.
- Stack full (count = `L`) → arriving dot recoils and falls (rejected), red.
- At a boundary crossing: a **1-frame white flash** on the new gridline, and stacking restarts at the bottom. Old dots are NOT removed — they scroll away naturally. This preserves the money shot: two full clumps on either side of one gridline = the 2× edge burst, visible with zero explanation.
- The `resets in X.Xs` text stays (top-right chip, see §4). The current `.wintimer` bar is **removed** — the approaching gridline *is* the timer.

**Count chip:** `3 / 5 used`.

### 3.2 Sliding window — same timeline, sliding lens

**Layout:** identical scrolling world, same playhead, same scale — reuse the fixed-window renderer.

**Behavior:**
- No gridlines. Instead a **translucent lens band** from the playhead back `W` sim-seconds (width = `W × pxPerSimSecond`). Lens fill: `--accent` at 10% alpha, 1 px edge lines at 25% alpha.
- Dots inside the lens render at full opacity (they count); as a dot crosses the trailing edge it drops to 35% opacity (it no longer counts). This fade at the trailing edge is the entire visual argument.
- Admission: dot lands and stacks like fixed window but the stack is "dots currently inside the lens" — full (= `L` in lens) → reject.

**⚠ Required algorithm change — visual truth must equal simulation truth.**
The current implementation is the *weighted-counter approximation* (`prev*(1-frac)+cur`). The lens shows a *true sliding log*. If we keep the approximation, the lens will visibly contradict the numbers (6 dots in lens while the counter says 5.4). **Switch the simulation to a true sliding log**: store an array of accept timestamps, `accept()` = (timestamps within last `W`) < `L`, prune as time passes. At demo rates this is trivially cheap.
- Update the `how` copy: sliding log stores a timestamp per request; note that production systems often use the weighted-counter approximation to save memory.
- Update the explainer table row ("more state" → "stores a timestamp per request").
- Property that must hold after the change: **no `W`-length interval ever contains more than `L` accepts** (this is the guarantee fixed window lacks — assert it in verification).

**Count chip:** `4 / 5 in window`.

### 3.3 Token bucket — jar with drip refill

**Layout:** jar (rounded-rect outline, ~72 px wide × ~100 px tall) at horizontal center-right (~60% x). Faucet/drip source is implied above the jar. Request lane runs left → jar → right exit.

**Behavior:**
- Tokens are **discrete coins** (small `--accept`-tinted circles, radius 4 px) stacked in the jar. The fractional accruing token renders as a coin at the top of the stack fading in with alpha = fraction (so refill progress is visible between whole tokens).
- Refill: every `W/L` sim-seconds a coin **drips from above** into the jar (150 ms wall-clock fall). When the jar is full, drips still fall but **bounce off the rim and vanish** — wasted refill. This is the capacity insight: an idle full bucket earns nothing.
- Request dot arrives → tokens ≥ 1: the top coin pops (150 ms shrink), the dot turns green and exits right. Tokens < 1: dot recoils off the jar wall and falls red.
- Burst behavior needs no special-casing: 20 dots arriving at once visually drain the whole stack coin-by-coin within the stagger window (§5.2), then the rest bounce — exactly the lesson.

**Count chip:** `2.4 / 5 tokens` (1 decimal).

### 3.4 Leaky bucket — queue and metronome gate

**Layout:** horizontal lane. Gate = vertical bar at **70% of canvas width** with a small aperture. Queue area = the lane left of the gate with `L` marked slots (faint slot outlines so capacity is visible even when empty).

**Behavior:**
- Arriving dot flies in and stops at the **back of the queue** (behind the last waiting dot), colored `--accent` while waiting.
- The gate opens on a metronome: every `W/L` sim-seconds it releases the **front** dot, which turns green and exits right. Gate tick = 100 ms wall-clock flash of the gate bar.
- Queue full (`L` waiting) → arriving dot recoils and falls red.
- When a released dot exits, the queue **shuffles forward** one slot (120 ms wall-clock slide).
- The visible payoff: input arrives clumpy, output leaves metronome-even. The queue length IS the latency — keep the `≈ 800ms latency` text (computed as `queue.length × W/L × 1000`, whole ms).

**⚠ Required algorithm change:** replace the continuous `level` float with a **discrete FIFO queue** + departure timer every `W/L` sim-seconds. Admission = `queue.length < L`. At integer granularity this matches the current admission behavior, and it makes the visual and the simulation the same object. `reset()` clears the queue and the departure timer phase.

**Count chip:** `queue 3 / 5`.

---

## 4. Panel anatomy after the redesign

Per panel, top to bottom (desktop):

```
[state badge]  [name + note]                      [ⓘ info]
[how-it-works expandable]                          (unchanged)
┌─ panel-body ────────────────────────────────┬──────────────┐
│  chamber canvas (140px, hero)               │  accept %    │
│    └ count chip overlaid top-right          │  ACCEPTED    │
│  live status line (dot + plain English)     │  ok/dropped  │
└─────────────────────────────────────────────┴──────────────┘
[history strip — time-indexed, two rows]
[strip caption]
```

- **Removed:** `.gauge`, `.gauge-fill`, `.gauge-label`, `.wintimer` (the chamber carries all of it). Keep `head()` in the limiter API — the badge/EMA logic (`stateOf`, `hEMA`) still consumes it.
- **Count chip:** small mono text chip overlaid on the canvas top-right — `--surface` background at 80% alpha, 4 px radius, `--mono` 0.72 rem, `--muted`. Content per §3. This replaces the old gauge-label text. (Chips are DOM elements positioned over the canvas, not canvas text — crisper and easier to update.)
- **Unchanged:** state badge (ACCEPTING / THROTTLING / DROPPING — the only shared state vocabulary), info toggle, live status line, right-hand readout (big accept %, ok/dropped counts), scoreboard, sticky zone, banner, all controls and their semantics.

### 4.1 History strip upgrade — time-indexed, two rows
The current `Lab.Strip` is **event-indexed** (one bar per request), which hides rhythm. Replace with a time-indexed strip:

- x-axis = sim time, same right-to-left scroll as the timelines (own scale is fine: show the last ~30 sim-seconds).
- **Two rows:** `in` (every arrival: green tick if accepted, red if dropped — accepted ticks half-height, rejected full-height, preserving the current height-encodes-outcome convention) and `out` (a tick when the request actually **left** — for leaky this is the gate passage, not the arrival; for the other three it equals the accept instant).
- Row labels `in` / `out` in 0.62 rem mono, `--faint`, left edge.
- This is where leaky's smoothing becomes objective: clumpy `in` row, metronome-even `out` row. For token bucket, the `out` row shows clumps — the downstream-spikiness tradeoff, visible.
- Caption changes from `recent requests →` to `last 30s — in vs out →`.
- Keep an events array API compatible with `stateOf()`/`recentAcceptPct()` (they read `strip.events`), or refactor those to consume a new structure — either way the badge logic must keep working.

---

## 5. Interaction rules

### 5.1 Existing controls — semantics must not change
- Speed segmented control (0.25× default / 0.5× / 1× / 2×): scales sim time only (§2.3). Immediate effect, no reset.
- Incoming traffic 0–40 req/s, Limit 1–20, Window 0.5–4 s: live updates. Window/limit changes **snap** the chamber geometry (no tweening gridlines/slots).
- If limit is lowered below current occupancy (jar coins, queue length, dots in lens): keep existing occupants, admit nothing until occupancy falls below the new limit. Never delete occupants on a slider change.
- Fire burst (+20): all 20 decided at the **same sim instant** (current behavior, keep — the vertical clump at one x IS the burst visual). Visually fan the arrival flights with a **25 ms wall-clock stagger** per dot so they read as a stream, not a blob.
- Pause: freezes the shared loop — sim and animations freeze mid-flight together (acceptable; they resume coherently). Space bar toggles (exists).
- Reset: clears chambers, queues, strips, counters, EMA; token jar refills to **full**; timers/phases reset to zero. Reset must be deterministic — two resets with the same slider values produce identical runs.

### 5.2 Overload behavior
- The `guard < 500` loop cap in `step()` stays.
- Live dot cap: **120 animated dots page-wide** (pooled). If exceeded, oldest animations complete instantly (sim is unaffected — see §2.4). At max settings (40 req/s × 2×) the sim stays correct while visuals degrade gracefully.

---

## 6. Performance budget (must-hold)

- **One `requestAnimationFrame` loop for the whole page** — the existing `Lab.Loop`. Chambers register as renderables; no per-panel loops, no `setInterval` for animation.
- Frame budget: ≤ 3 ms script on an M-series laptop at defaults; no jank at 40 req/s × 2× (degrade via dot cap, never via sim skips).
- DOM writes throttled: text nodes (status lines, chips, readouts, scoreboard numbers) update at most every **100 ms** and only when the value changed. Badges update immediately on state change. Canvas redraws every frame.
- Object pooling for dots; zero allocations in the steady-state frame path (reuse vectors, avoid closures in hot loops).
- No layout thrash: canvas + transform/absolutely-positioned chips only; never trigger reflow per frame.
- When `document.hidden`, the loop's existing 0.25 s frame clamp handles catch-up; do not add extra timers.

---

## 7. Accessibility (must-do)

- **Every visual fact has a text mirror.** The chamber is decorative-plus; the status line, count chip, badge, and readout carry the same information as text. Canvas elements get `aria-hidden="true"`; each panel keeps a meaningful reading order (badge → name → status → counts).
- `prefers-reduced-motion: reduce` → skip all flight/fall/drip animations; dots appear at their destinations with color changes only; timeline scroll becomes a discrete 4 Hz shift instead of smooth scroll. Simulation and numbers identical.
- Never color-only: outcome is also encoded by motion/position (§2.2) and tick height (§4.1).
- Keyboard: existing space-to-pause, focusable buttons, `aria-expanded` on info toggles — preserve all.
- Text contrast: keep current token colors on `--surface-2`; don't introduce text below 0.62 rem.

---

## 8. Copy rules

- State vocabulary is exactly three words: **ACCEPTING / THROTTLING / DROPPING** (badge + scoreboard). Never introduce a fourth state.
- Per-algorithm nouns are intentionally different (used / in window / tokens / queue) — do NOT unify them. The shared layer is the badge; the specific layer is the chip. (Explicit product decision.)
- Status lines: plain English, present tense, one clause, no jargon, no exclamation marks. Pattern: *what's happening — what it means* ("Bucket full — dropping the overflow").
- Sentence case everywhere except the badge (uppercase mono).
- Numbers: counts as integers; fractional state 1 decimal; latency in whole ms; percentages as integers.

---

## 9. Must / must-not summary

**Must**
1. Sim decisions synchronous at arrival; animation is replay (§2.4).
2. Wall-clock motion, sim-clock scheduling (§2.3).
3. Visual truth = simulation truth (sliding log §3.2, discrete queue §3.4).
4. One rAF loop, pooled dots, throttled DOM writes (§6).
5. Text mirror + reduced-motion path for everything (§7).
6. Works at 360 px width: panel-body stacks (existing CSS), chambers scale to container, min dot radius 4 px.
7. Deterministic reset (§5.1).
8. Ship per-phase (§10); every phase verified before push (§11).
9. Keep the limiter object API (`tick/accept/head/status/reset`) so badges, scoreboard, and `stateOf()` keep working untouched.

**Must not**
1. No new dependencies, no build step — vanilla JS, one demo file + shared `lab.js`/`lab.css`.
2. No gradients, shadows, glow, blur, or emoji in chambers (flat technical aesthetic).
3. Don't scale animation durations by playback speed.
4. Don't let animation state affect counters, badges, or strips.
5. Don't change control semantics, slider ranges, or defaults (0.25×, 3 req/s, L=5, W=1 s).
6. Don't remove the scoreboard, badges, banner, or sticky zone.
7. Don't unify the per-algorithm chip vocabulary.
8. Don't render text inside the canvas (chips are DOM).
9. Don't block the page on all four chambers being done — the old gauge row per panel remains until that panel's chamber ships.

---

## 10. Build order

Each phase is one commit (or a few), verified (§11), then pushed. The page must be fully functional after every phase.

- **Phase 0 — engine.** In `lab.js`: dot pool + renderable registry on `Lab.Loop`; wall-clock animation track alongside sim dt; reduced-motion detection; time-indexed two-row strip (`Lab.TimeStrip`) alongside the existing `Strip`. No visible change yet except the strip swap on all four panels.
- **Phase 1 — fixed window chamber** (simplest canvas; establishes scrolling world + stacking + reject physics).
- **Phase 2 — sliding lens** (reuses Phase 1 renderer; includes the sliding-log algorithm change + copy updates).
- **Phase 3 — token jar** (coins, drip, overflow bounce).
- **Phase 4 — leaky conveyor** (discrete queue change, gate metronome, shuffle-forward).
- **Phase 5 — polish.** Boundary flash tuning, queue-age tint (optional), perf pass at 40 req/s × 2×, mobile pass, Lighthouse.

---

## 11. Verification checklist (run per phase)

Numerical (theory checks — these caught real bugs before):
- Offered 8/s, sustained 5/s (L=5, W=1) → all four accept-rates converge to **~62.5%** (5/8).
- Reset, traffic 0, fire one burst of 20 with L=5 → exactly **5 ok / 15 dropped** on every panel (token jar full, leaky queue empty, windows empty).
- Sliding window (post-log-change): no `W` interval ever exceeds `L` accepts, including across burst + boundary. Fixed window across a boundary must show up to `2L` in < `W` — that asymmetry is the lesson, assert both.
- Leaky `out` ticks are evenly spaced at `W/L` sim-seconds whenever the queue is non-empty.

Behavioral:
- Badges: over-capacity → all DROPPING; recovery to under-capacity → all ACCEPTING within a few seconds (EMA must not stick).
- Speed change mid-run: event *frequency* changes; dot *motion speed* doesn't.
- Pause freezes everything; resume continues coherently; reset is deterministic.
- Slider edge cases: rate 0 (nothing arrives, refills/gates continue), W=4 s + burst at boundary (fixed lets a double-clump through, sliding doesn't), limit lowered below occupancy (no deletions, admissions stop).

Hygiene (every phase, before push):
- Zero console errors on load and after 60 s at 2×.
- Mobile 375 px: chambers legible, panel-body stacked, sticky zone static (existing breakpoint).
- Reduced-motion mode: numbers identical to animated mode for the same inputs.
- Keyboard walk: tab through controls, space toggles, info toggles announce state.

---

## 12. Code landmarks (current file: `rate-limiter/index.html`)

- `cfg` — single source of truth `{ rate, limit, window, speed }`; `cfg.speed` multiplies `dt` in `step()`.
- Limiter factories: `fixedWindow()`, `slidingWindow()`, `tokenBucket()`, `leakyBucket()` — shared interface `tick(dt) / accept() / head() / gauge() / sub() / status() / reset()`. Chambers should hook in as a per-limiter `chamber` object with `onArrival(ok)`, `onDeparture()` (leaky), `draw(ctx, simNow)`.
- `fireArrival()` — the decision point (§2.4); chambers observe it, never influence it.
- `stateOf()` + `hEMA` smoothing — drives badges/scoreboard; reads `strip.events`; keep contract intact.
- `Lab.Loop` (`assets/lab.js`) — fixed-timestep loop, `hz: 60`, frame clamp 0.25 s. Extend, don't replace.
- `Lab.Strip` — event-indexed tape, DPR-aware canvas resize pattern to copy for chambers. Superseded by `TimeStrip` in Phase 0 but keep the class (landing page or other demos may use it).
- Arrivals are **evenly spaced** (`nextGap = 1/cfg.rate`) — intentional (§2.6).

---

*Questions or ambiguities: default to the calmer, flatter, more literal option, and keep the simulation honest.*
