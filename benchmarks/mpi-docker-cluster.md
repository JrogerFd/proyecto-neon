# Sprint 5.4: Docker/OpenMPI cluster benchmark

## Environment and validation

- Host: Ubuntu 26.04.1 LTS, Intel Core i5-1035G1, 8 logical CPUs and
  approximately 10.9 GiB RAM visible to Docker (containers had no CPU or
  memory quota).
- Docker Engine 29.9.2; Docker Compose 5.6.1.
- All three containers were started from the same locally built
  `neon-rush-mpi:local` image with Open MPI 4.1.6.
- The Compose network is private and internal. No host ports were published.
  Container inspection confirmed `Privileged=false` for all three nodes.
- The containers share the same host's CPU, memory, and network stack; this
  is not a three-machine cluster.

Verification before measuring:

- DNS and ping succeeded for `node1`, `node2`, and `node3`; SSH from the
  coordinator to both workers succeeded.
- `MPI rank placement` reported rank 0 on node1, rank 1 on node2, and rank 2
  on node3 for the three-process case.
- CTest in the OpenMPI image: 4/4 passed. This includes the normal C++ suite
  and MPI CTests at 1, 2, and 3 local ranks.
- The additional cross-container MPI test run: 5/5 passed on three nodes.
- `mpi-compare` verified vehicle fields and IDs, cumulative collision counts,
  and the canonical last-step collision pairs for every benchmark row.

## Method

Every configuration used the same deterministic initial conditions,
`deltaTime = 1/60`, and five repetitions. Total timings include simulator
construction/initial distribution and the simulation run for all modes.
Sequential/OpenMP comparison runs
reported matching states and collision counts; MPI comparisons reported
matching vehicle states, collision counts, and collision-pair sets.
Sequential timing baselines for speedup are from the same comparison
invocation as their corresponding parallel measurement. The separate
sequential-only row is informational and is not used to calculate speedup.

MPI total time is the slowest rank's elapsed simulation time, including
initial distribution and the per-step communication/synchronization.
Communication includes setup, migration, halo exchange, and measured
collectives. Final state/pair gathering for validation is outside the timed
interval. The cluster benchmark command was:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 10000 100 5 4
```

### 1,000 vehicles × 1,000 steps

Times are median seconds. Sequential reference and speedup for parallel rows
come from that mode's own comparison invocation.

| Mode | Processes / threads | Move (s) | Collision (s) | Communication (s) | Total (s) | Sequential ref (s) | Speedup | Efficiency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sequential standalone | 1 | 0.034190271 | 0.692673657 | — | 0.754701858 | — | — | — |
| OpenMP | 4 threads | 0.016308935 | 0.454330454 | — | 0.484730739 | 0.742627780 | 1.5320 | 0.3830 |
| MPI | 1 / node1 | 0.033546599 | 0.662164985 | 0.003133698 | 0.832775950 | 0.751773982 | 0.9027 | 0.9027 |
| MPI | 2 / node1,node2 | 0.017804771 | 0.331174414 | 0.248925467 | 0.681760229 | 0.770848573 | 1.1307 | 0.5653 |
| MPI | 3 / node1,node2,node3 | 0.013367968 | 0.236926937 | 0.511388116 | 0.790024719 | 0.807675666 | 1.0223 | 0.3408 |

Collision pairs detected per simulation: 160,718.

### 10,000 vehicles × 100 steps

| Mode | Processes / threads | Move (s) | Collision (s) | Communication (s) | Total (s) | Sequential ref (s) | Speedup | Efficiency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sequential standalone | 1 | 0.033671808 | 0.781379777 | — | 0.823161430 | — | — | — |
| OpenMP | 4 threads | 0.015945315 | 0.563751476 | — | 0.589709147 | 0.782726246 | 1.3273 | 0.3318 |
| MPI | 1 / node1 | 0.032987563 | 0.781520695 | 0.001148958 | 0.937081910 | 0.790669125 | 0.8438 | 0.8438 |
| MPI | 2 / node1,node2 | 0.018327118 | 0.324216582 | 0.074590919 | 0.511915464 | 0.832097942 | 1.6255 | 0.8127 |
| MPI | 3 / node1,node2,node3 | 0.013411505 | 0.269835637 | 0.168845936 | 0.452748736 | 0.848559863 | 1.8742 | 0.6247 |

Collision pairs detected per simulation: 95,551.

## Interpretation and limitations

- One-process MPI was slower than the sequential mode in both workloads due
  to MPI setup and synchronization without useful distribution.
- Three processes reduced movement and collision phase times, but cluster
  communication was substantial. For 1,000 × 1,000 the measured 3-process
  total exceeded the sequential reference despite faster compute phases.
- The 10,000 × 100 workload benefited from 2 and 3 ranks in this run. The
  3-process result is a single-host Docker measurement and should not be
  extrapolated to physical cluster networking.
- Host scheduling and thermal/frequency variation affected the sequential
  baselines between invocations. Each speedup is paired with its own
  invocation's baseline; do not compare baseline rows as a controlled
  sequential benchmark.
- Historical OpenMP measurements in
  [`openmp-comparison.md`](./openmp-comparison.md) and earlier MPI results in
  [`mpi-comparison.md`](./mpi-comparison.md) were not changed or reused.
