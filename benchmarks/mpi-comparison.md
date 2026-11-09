# Sprint 5.3 MPI benchmark

Measurements were taken in Release mode with five repetitions per row. Every
MPI comparison used the sequential baseline from the same invocation, the
same deterministic initial state, `deltaTime = 1/60`, and verified exact
vehicle fields, accumulated collision counts, and the canonical last-step
collision-pair set before reporting a speedup.

The test host exposed 8 processors to the process. The compiler was GNU C++
15.2.0 and the MPI runtime was MPICH 4.3.2, extracted into a temporary
user-local directory because OpenMPI was not installed and system installation
required administrator authentication. All MPI processes ran on this single
host; these figures are not a three-node cluster measurement. MPI total time
is the maximum elapsed time across ranks, including initial distribution and
per-step synchronization/communication. The validation gathers/checksum after
the timed interval are excluded. Phase and communication values are medians,
across repetitions, of each run's maximum rank timings. Communication time
includes setup and run collectives,
vehicle migration, halo exchange, and timing/count reductions; the final
reduction used to publish the communication metric itself and verification
gathers are excluded.

## 1,000 vehicles, 1,000 steps

| MPI processes | Sequential total (s) | MPI movement (s) | MPI collision detection (s) | MPI communication (s) | MPI total (s) | Speedup | Efficiency |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.735430989 | 0.031827111 | 0.664923999 | 0.012672783 | 0.811279812 | 0.9065 | 0.9065 |
| 2 | 0.757440269 | 0.017157398 | 0.346029786 | 0.091966306 | 0.504198582 | 1.5023 | 0.7511 |
| 3 | 0.822022407 | 0.013751086 | 0.272439724 | 0.168363648 | 0.420475771 | 1.9550 | 0.6517 |

Detected collision pairs per simulation: 160,718.

## 10,000 vehicles, 100 steps

| MPI processes | Sequential total (s) | MPI movement (s) | MPI collision detection (s) | MPI communication (s) | MPI total (s) | Speedup | Efficiency |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.771893224 | 0.031734687 | 0.712176995 | 0.033820764 | 0.885560852 | 0.8716 | 0.8716 |
| 2 | 0.844857669 | 0.017444204 | 0.334280927 | 0.113145277 | 0.527498417 | 1.6016 | 0.8008 |
| 3 | 0.837185150 | 0.011807249 | 0.262721205 | 0.188196680 | 0.435496318 | 1.9224 | 0.6408 |

Detected collision pairs per simulation: 95,551.

## Interpretation and limitations

- One MPI process is slower than the sequential run because process setup,
  spatial partition maintenance, collective synchronization, and messaging
  have no distribution benefit at one rank.
- Two and three ranks improved the total for these test loads. Efficiency
  decreases as process count increases, while measured communication increases
  due to partition migration, halo exchange, and reductions.
- The sequential baseline varied across the six invocations as host load and
  frequency changed. Each speedup uses the sequential median measured in its
  own invocation; do not compare sequential entries across rows as a controlled
  timing study.
- The historical OpenMP report remains separate at
  [`openmp-comparison.md`](./openmp-comparison.md); its results were not
  modified or combined with these MPI measurements.
- These are single-machine process tests. A Docker cluster of three physical
  nodes needs a separate benchmark with network and per-node configuration
  recorded.

Reproduce the two workloads with this loop after building with MPI:

```bash
for processes in 1 2 3; do
  mpirun -np "$processes" ./backend/build/neon_rush_sim \
    --mode mpi-compare --vehicles 1000 --steps 1000 \
    --delta-time 0.016666666666666666 --repetitions 5
done
for processes in 1 2 3; do
  mpirun -np "$processes" ./backend/build/neon_rush_sim \
    --mode mpi-compare --vehicles 10000 --steps 100 \
    --delta-time 0.016666666666666666 --repetitions 5
done
```
