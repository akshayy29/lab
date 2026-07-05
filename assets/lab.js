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

    global.Lab = { mulberry32, nextArrivalGap, clamp01, Loop, Strip };
})(window);
