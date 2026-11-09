# Sprint 5.2 OpenMP benchmark

Measured in Release mode on the same host and executable. Each sweep used five
repetitions, deterministic initial states, and a shared sequential baseline.
Sequential/OpenMP final vehicle states and collision counts matched in every
run.

Host: 8 processors available to OpenMP. Compiler: GNU C++ 15.2.0. OpenMP:
4.5. Build: CMake Release. Delta time: 1/60 second. Times are medians in
seconds. These results are environment-specific;
they are not predictions for other systems.

Commands, run consecutively with no other benchmark process:

```bash
./backend/build/neon_rush_sim --vehicles 1000 --steps 1000 --mode sweep --threads 4 --repetitions 5
./backend/build/neon_rush_sim --vehicles 10000 --steps 100 --mode sweep --threads 4 --repetitions 5
```

## 1,000 vehicles, 1,000 steps

| Mode | Threads | Movement (s) | Collision detection (s) | Total (s) | Speedup | Efficiency |
|---|---:|---:|---:|---:|---:|---:|
| Sequential | 1 | 0.024127000 | 0.508035850 | 0.537541902 | 1.0000 | — |
| OpenMP | 1 | 0.024491909 | 0.512253457 | 0.542070527 | 0.9916 | 0.9916 |
| OpenMP | 2 | 0.015399676 | 0.409776729 | 0.430834238 | 1.2477 | 0.6238 |
| OpenMP | 4 | 0.010247123 | 0.361163271 | 0.376884041 | 1.4263 | 0.3566 |

Collision-pair detections: 160,718. State checksum: 7,733,111.973857103.

## 10,000 vehicles, 100 steps

| Mode | Threads | Movement (s) | Collision detection (s) | Total (s) | Speedup | Efficiency |
|---|---:|---:|---:|---:|---:|---:|
| Sequential | 1 | 0.023109225 | 0.495542940 | 0.524090093 | 1.0000 | — |
| OpenMP | 1 | 0.023988645 | 0.506990610 | 0.537000537 | 0.9760 | 0.9760 |
| OpenMP | 2 | 0.013321312 | 0.413284492 | 0.432629342 | 1.2114 | 0.6057 |
| OpenMP | 4 | 0.008578863 | 0.391368465 | 0.407037858 | 1.2876 | 0.3219 |

Collision-pair detections: 95,551. State checksum: 4,277,564,441.729911327.

## Notes

- With one requested thread, the implementation does not launch a parallel
  region; the small timing differences are measurement noise and mode-branch
  overhead, with no meaningful parallel speedup.
- Two and four threads improved the measured totals for these workloads, but
  efficiency fell as thread count increased. Serial grid construction,
  validation, pair merging/sorting, synchronization, and host variability
  remain costs.
- The two workloads have different vehicle/step counts and must not be
  compared against each other as if they were the same benchmark.
- Historical Sprint 5.1 sequential measurements are preserved here for
  reference: 1,000 vehicles × 10,000 steps: 7.058960 s total; 10,000 vehicles
  × 100 steps: 1.002612 s total. Those measurements used an earlier build and
  are not used in the speedup calculations above.
