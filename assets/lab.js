/**
 * Systems Lab — shared simulation utilities.
 * Framework-free. Every demo reuses these for reproducible, controllable sims.
 */
(function (global) {
    'use strict';

    /** Seeded PRNG (mulberry32) — deterministic runs so behavior is reproducible. */
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** Exponential inter-arrival gap for a Poisson process at `ratePerSec`. */
    function nextArrivalGap(rand, ratePerSec) {
        if (ratePerSec <= 0) return Infinity;
        return -Math.log(1 - rand()) / ratePerSec;
    }

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    /** True while the user has requested reduced motion — chambers must skip tweens and jump to end state. */
    function prefersReducedMotion() {
        return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    const ease = {
        outCubic: (t) => 1 - Math.pow(1 - t, 3),
        inCubic: (t) => t * t * t,
        linear: (t) => t
    };

    /**
     * Fixed-timestep animation loop with play / pause / single-step.
     * `step(dt)` is called with dt in seconds.
     */
    class Loop {
        constructor(step, opts) {
            const hz = (opts && opts.hz) || 60;
            this.step = step;
            this.dt = 1 / hz;
            this._acc = 0;
            this._last = 0;
            this._raf = null;
            this.running = false;
            this._tick = this._tick.bind(this);
        }
        _tick(ts) {
            if (!this.running) return;
            if (!this._last) this._last = ts;
            let frame = (ts - this._last) / 1000;
            this._last = ts;
            if (frame > 0.25) frame = 0.25; // clamp after a tab switch
            this._acc += frame;
            while (this._acc >= this.dt) {
                this.step(this.dt);
                this._acc -= this.dt;
            }
            this._raf = requestAnimationFrame(this._tick);
        }
        play() {
            if (this.running) return;
            this.running = true;
            this._last = 0;
            this._raf = requestAnimationFrame(this._tick);
        }
        pause() {
            this.running = false;
            if (this._raf) cancelAnimationFrame(this._raf);
        }
        toggle() { this.running ? this.pause() : this.play(); }
        stepOnce() { this.step(this.dt); }
    }

    /**
     * Rolling event tape: draws accept/reject events as colored bars, newest on the right.
     * Each pushed event is one request — the strip is an event tape, not a time axis.
     * @deprecated superseded by TimeStrip for panels; kept for any demo that wants
     * a simple event-indexed tape.
     */
    class Strip {
        constructor(canvas, opts) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.max = (opts && opts.max) || 200;
            this.events = [];
            this._resize();
            this._onResize = () => { this._resize(); this.draw(this._colors); };
            window.addEventListener('resize', this._onResize);
        }
        _resize() {
            const dpr = window.devicePixelRatio || 1;
            const r = this.canvas.getBoundingClientRect();
            this.canvas.width = Math.max(1, r.width * dpr);
            this.canvas.height = Math.max(1, r.height * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.w = r.width; this.h = r.height;
        }
        push(kind) {
            this.events.push(kind);
            if (this.events.length > this.max) this.events.shift();
        }
        clear() { this.events = []; }
        draw(colors) {
            this._colors = colors || this._colors || { accept: '#34d399', reject: '#f87171' };
            const c = this._colors;
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.w, this.h);
            const bw = this.w / this.max;
            const start = this.max - this.events.length;
            for (let i = 0; i < this.events.length; i++) {
                const accept = this.events[i] === 'accept';
                ctx.fillStyle = accept ? c.accept : c.reject;
                const x = (start + i) * bw;
                const barH = accept ? this.h * 0.5 : this.h * 0.92;
                ctx.fillRect(x, this.h - barH, Math.max(1, bw - 0.6), barH);
            }
        }
    }

    /**
     * A single animated request sprite. Wall-clock driven (real seconds, never
     * scaled by playback speed — see spec §2.3): flies in from a start point,
     * lands, then either exits toward a target or rejects (recoil + gravity fall
     * + fade). Chambers reposition landed dots directly (e.g. world-scroll,
     * queue shuffle) by writing `x`/`y`, or call `retarget()` for a smooth slide.
     */
    class Dot {
        constructor(opts) {
            this.r = opts.r || 5;
            this.x0 = opts.x0; this.y0 = opts.y0;
            this.x1 = opts.x1; this.y1 = opts.y1;
            this.x = opts.x0; this.y = opts.y0;
            this.color = opts.color || '#38bdf8';
            this.alpha = 1;
            this.state = 'flight';
            this.t = 0;
            this.flightDur = opts.flightDur != null ? opts.flightDur : 0.3;
            this.onLanded = opts.onLanded || null;
        }
        retarget(x, y, dur) {
            this._tx0 = this.x; this._ty0 = this.y;
            this.x1 = x; this.y1 = y;
            this.flightDur = dur != null ? dur : 0.12;
            this.t = 0;
            this.state = 'retarget';
        }
        exit(toX, toY, color, dur) {
            this.state = 'exiting'; this.t = 0;
            this._ex0 = this.x; this._ey0 = this.y;
            this._ex1 = toX; this._ey1 = toY != null ? toY : this.y;
            this._exitDur = dur != null ? dur : 0.25;
            if (color) this.color = color;
        }
        reject(color) {
            this.state = 'rejecting'; this.t = 0;
            this._rx0 = this.x; this._ry0 = this.y;
            this._rdx = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 8);
            this.color = color || '#f87171';
        }
        /** Skip straight to the final visual state — used under prefers-reduced-motion. */
        settle() {
            if (this.state === 'flight' || this.state === 'retarget') {
                this.x = this.x1; this.y = this.y1; this.state = 'landed'; this.t = 0;
                if (this.onLanded) this.onLanded(this);
            }
        }
        instantComplete() { this.alpha = 0; this.state = 'dead'; }
        update(dt) {
            this.t += dt;
            if (this.state === 'flight' || this.state === 'retarget') {
                const from = this.state === 'retarget' ? { x: this._tx0, y: this._ty0 } : { x: this.x0, y: this.y0 };
                const p = Math.min(1, this.t / this.flightDur);
                const e = ease.outCubic(p);
                this.x = from.x + (this.x1 - from.x) * e;
                this.y = from.y + (this.y1 - from.y) * e;
                if (p >= 1) {
                    this.x = this.x1; this.y = this.y1;
                    this.state = 'landed'; this.t = 0;
                    if (this.onLanded) this.onLanded(this);
                }
                return true;
            }
            if (this.state === 'landed') return true;
            if (this.state === 'exiting') {
                const p = Math.min(1, this.t / this._exitDur);
                const e = ease.inCubic(p);
                this.x = this._ex0 + (this._ex1 - this._ex0) * e;
                this.y = this._ey0 + (this._ey1 - this._ey0) * e;
                return p < 1;
            }
            if (this.state === 'rejecting') {
                const dur = 0.42;
                const p = Math.min(1, this.t / dur);
                this.x = this._rx0 + this._rdx * Math.min(1, this.t / 0.25);
                this.y = this._ry0 + 46 * p * p;
                this.alpha = 1 - p;
                return p < 1;
            }
            return false;
        }
        draw(ctx) {
            if (this.state === 'dead') return;
            ctx.globalAlpha = this.alpha;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    /**
     * Capped, page-wide pool of Dot sprites (spec: 120 max). Oldest sprites are
     * force-completed (not deleted mid-animation) when the cap is exceeded, so
     * the simulation is never affected — only presentation degrades.
     */
    class DotPool {
        constructor(cap) {
            this.cap = cap || 120;
            this.items = [];
            this.reduced = prefersReducedMotion();
        }
        spawn(dot) {
            if (this.reduced) dot.settle();
            if (this.items.length >= this.cap) {
                const oldest = this.items.shift();
                if (oldest) oldest.instantComplete();
            }
            this.items.push(dot);
            return dot;
        }
        update(dt) {
            for (let i = this.items.length - 1; i >= 0; i--) {
                const alive = this.items[i].update(dt);
                if (!alive) this.items.splice(i, 1);
            }
        }
        draw(ctx) {
            for (let i = 0; i < this.items.length; i++) this.items[i].draw(ctx);
        }
        clear() { this.items = []; }
    }

    /**
     * Time-indexed, two-row event strip. Unlike Strip (one bar per event, hiding
     * rhythm), x-position here is simulated time, so output smoothness/clumpiness
     * is visible. Row 1 ("in"): every arrival, accept or reject. Row 2 ("out"):
     * the instant a request actually departs — for most limiters this equals
     * the accept instant, but for a queueing limiter (leaky bucket) it's the
     * later departure tick, which is the whole point of the comparison.
     */
    class TimeStrip {
        constructor(canvas, opts) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.span = (opts && opts.span) || 30; // sim-seconds visible
            this.inEvents = [];
            this.outEvents = [];
            this._resize();
            this._onResize = () => { this._resize(); };
            window.addEventListener('resize', this._onResize);
        }
        _resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const r = this.canvas.getBoundingClientRect();
            this.canvas.width = Math.max(1, r.width * dpr);
            this.canvas.height = Math.max(1, r.height * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.w = r.width; this.h = r.height;
        }
        pushIn(simTime, kind) { this.inEvents.push({ t: simTime, kind: kind }); }
        pushOut(simTime) { this.outEvents.push({ t: simTime }); }
        clear() { this.inEvents = []; this.outEvents = []; }
        _prune(simNow) {
            const cutoff = simNow - this.span;
            while (this.inEvents.length && this.inEvents[0].t < cutoff) this.inEvents.shift();
            while (this.outEvents.length && this.outEvents[0].t < cutoff) this.outEvents.shift();
        }
        draw(simNow, colors) {
            this._colors = colors || this._colors || { accept: '#34d399', reject: '#f87171', out: '#38bdf8' };
            this._prune(simNow);
            const c = this._colors;
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.w, this.h);
            const rowH = this.h / 2;
            const pxPerSec = this.w / this.span;
            const bw = 1.6;

            for (let i = 0; i < this.inEvents.length; i++) {
                const e = this.inEvents[i];
                const x = this.w - (simNow - e.t) * pxPerSec;
                if (x < -bw) continue;
                ctx.fillStyle = e.kind === 'accept' ? c.accept : c.reject;
                const barH = e.kind === 'accept' ? rowH * 0.5 : rowH * 0.92;
                ctx.fillRect(x, rowH - barH, bw, barH);
            }
            for (let i = 0; i < this.outEvents.length; i++) {
                const e = this.outEvents[i];
                const x = this.w - (simNow - e.t) * pxPerSec;
                if (x < -bw) continue;
                ctx.fillStyle = c.out;
                const barH = rowH * 0.6;
                ctx.fillRect(x, rowH + (rowH - barH), bw, barH);
            }
        }
    }

    global.Lab = { mulberry32, nextArrivalGap, clamp01, prefersReducedMotion, ease, Dot, DotPool, Strip, TimeStrip, Loop };
})(window);
