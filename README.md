# Systems Lab

A living notebook of interactive distributed-systems demos — the fundamentals worth
keeping sharp, made tangible. Every demo lets you drag the load up, change the strategy,
and push the system into the regime where it breaks, because the intuition lives at the
cliff edge, not the happy path.

By [Akshay Yewale](https://akshayy.dev) — backend engineer, distributed systems at scale.

## Demos

| Demo | Status | What it shows |
|------|--------|---------------|
| Rate limiter playground | ✅ live | Fixed window, sliding window, token bucket, leaky bucket — each with its own animated mechanism (a scrolling timeline, a lens, a jar of coins, a queue and gate) on one traffic stream |
| Consistent hashing | planned | Add a node, watch only 1/N of the keys move |
| Retry storm | planned | How naive retries amplify an outage, and how backoff + jitter tame it |
| Cache eviction | planned | LRU vs LFU vs FIFO on different workloads, live hit rate |
| Load balancer | planned | Round-robin vs least-connections vs power-of-two-choices |
| Queue & backpressure | planned | Little's Law made physical |
| Circuit breaker | planned | Closed / open / half-open state machine |
| Partition hot keys | planned | Hot-partition problem and write sharding |

## Design

- **One static file per demo.** No framework, no build step, no runtime dependencies.
  The site loads instantly — the medium is the message.
- **Shared shell** in [`assets/`](assets/): a seeded PRNG for reproducible runs, a
  fixed-timestep play/pause/step loop, a wall-clock-driven dot/particle engine with a
  capped shared pool, a time-indexed two-row event strip, and the common dark UI.
  Every demo reuses these.
- **Per-algorithm chambers, not one shared visual.** Each mechanism gets whatever
  representation fits it best — see [`docs/visualizer-redesign-spec.md`](docs/visualizer-redesign-spec.md)
  for the full design rationale and verification methodology behind the rate limiter's four chambers.

## Run locally

```sh
python3 -m http.server 8125
# open http://localhost:8125
```

## License

MIT
