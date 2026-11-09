# Neon Rush C++ simulation engine

This C++17 command-line engine is independent of the browser frontend. It
retains a sequential baseline and optionally builds OpenMP and MPI
implementations.
Movement and collision detection are separate phases.

## Build and test on Ubuntu

```bash
sudo apt update
sudo apt install build-essential cmake
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

For GCC, OpenMP is supplied by the compiler's `libgomp` runtime. With Clang,
install an OpenMP runtime such as `libomp-dev` before configuring. CMake treats
OpenMP as optional: if it is unavailable, the sequential build remains usable,
and `--mode openmp` falls back to sequential execution. CMake reports which
configuration it selected.

MPI is optional as well. To build the distributed mode with OpenMPI:

```bash
sudo apt install openmpi-bin libopenmpi-dev
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
```

If OpenMPI is not found when configuring, the sequential and OpenMP programs
still build; MPI-only tests are not registered and `--mode mpi` is rejected.
After installing MPI, re-run the CMake configure command so it can discover
the MPI compiler and libraries.

## Run a simulation

```bash
./backend/build/neon_rush_sim --vehicles 1000 --steps 10000 --mode sequential
./backend/build/neon_rush_sim --vehicles 1000 --steps 10000 --mode openmp --threads 4
./backend/build/neon_rush_sim --vehicles 4 --steps 1000 --delta-time 0.0166666667
```

Use `./backend/build/neon_rush_sim --help` to list options. Thread counts must
be between one and the processor count available to OpenMP on this machine.
Initial conditions are deterministic. Vehicle states are updated independently,
using the same arithmetic in both modes, so the current implementation produces
matching positions and collision counts. Cross-compiler and cross-hardware
bitwise equivalence is not guaranteed.

## Distributed MPI mode

Run under `mpirun` with all MPI ranks given identical simulation options:

```bash
mpirun -np 1 ./backend/build/neon_rush_sim \
  --mode mpi --vehicles 1000 --steps 1000
mpirun -np 2 ./backend/build/neon_rush_sim \
  --mode mpi --vehicles 1000 --steps 1000
mpirun -np 3 ./backend/build/neon_rush_sim \
  --mode mpi --vehicles 1000 --steps 1000
```

MPI mode defaults to five repetitions. To compare MPI with the sequential
baseline using the same deterministic initial conditions, gather the final
state and verify the last-step collision-pair set as well as cumulative
collision counts:

```bash
mpirun -np 3 ./backend/build/neon_rush_sim \
  --mode mpi-compare --vehicles 1000 --steps 1000 --repetitions 5
```

The report includes the maximum rank time, movement and collision phase times,
communication time, collision count, speedup, and efficiency. The MPI total
includes initial distribution and simulation communication and is reduced as
the slowest process's elapsed time. The sequential baseline's total is the
wall time for its simulation run. For meaningful measurements, use the same
vehicle count, steps, delta time, build, and host conditions; do not compare
different workloads or use processes-per-host results as a three-node cluster
benchmark.

With MPI detected, CTest registers correctness runs for one, two, and three
processes:

```bash
ctest --test-dir backend/build -R neon_rush_mpi_tests --output-on-failure
```

Tests cover sequential position/ID equivalence, cross-partition collisions,
unique canonical collision pairs, repeatability, empty ranks, and an empty
simulation. The single-process C++ tests continue to validate the sequential
and OpenMP implementations.

## Comparable benchmarks

The `compare` mode executes sequential and OpenMP runs with the same vehicle
count, step count, delta time, and deterministic initial state. It alternates
execution order across repetitions, verifies the final state and collision
count, and reports medians:

```bash
./backend/build/neon_rush_sim --vehicles 1000 --steps 10000 \
  --mode compare --threads 4 --repetitions 5
```

Use `sweep` to compare a shared sequential baseline with OpenMP at 1, 2, 4,
and further powers of two up to `--threads` (including the requested maximum
if it is not a power of two):

```bash
./backend/build/neon_rush_sim --vehicles 1000 --steps 10000 \
  --mode sweep --threads 4 --repetitions 5
```

The report includes median movement, collision-detection, and total times,
collision counts, state checksums, speedup `S(p) = Tseq / Tparallel(p)`, and
efficiency `E(p) = S(p) / p`. Run comparisons on an otherwise idle machine;
wall-clock results vary with load and frequency scaling. Recorded measurements
are in [`../benchmarks/openmp-comparison.md`](../benchmarks/openmp-comparison.md).

## Model and parallel regions

Each active vehicle stores its ID, X/Z position, non-negative scalar speed,
heading in radians, and collision radius. Movement applies
`x += cos(direction) * speed * deltaTime` and
`z += sin(direction) * speed * deltaTime`.

Collision detection uses a uniform spatial grid and circular overlap tests.
It returns collision pairs without mutating vehicle states. Collision counts
are pair detections accumulated over simulation steps, so continued contact is
counted again on subsequent steps. OpenMP is used in two places:

1. The vehicle-update loop distributes indices with `schedule(static)`. Each
   iteration reads and writes only its own vehicle.
2. Collision candidate traversal distributes the first vehicle index. The
   spatial hash is read-only during this region; each thread writes only to its
   own collision-pair buffer. A pair is emitted only when the second index is
   greater than the first, then buffers are merged and pairs sorted
   deterministically.

Spatial-grid construction, buffer merging/sorting, and statistics updates are
sequential. The parallel regions and their synchronization can outweigh useful
work for small inputs; benchmark before selecting a thread count.

MPI assigns ownership by spatial X-cell slabs. Initial vehicles are scattered
from rank 0; after each movement phase, vehicles that crossed an ownership
boundary migrate with `MPI_Alltoallv`. Ranks exchange only adjacent-X-cell
vehicles as collision halos. Each local vehicle is responsible for emitting
pairs only when its global ID is lower than the other vehicle's ID. This
ownership rule avoids duplicate pair counts, including for halo candidates.
Positions and collision pairs are gathered only for validation/reporting;
the complete global state is not gathered on every step. Global cell bounds,
count exchanges, halo exchanges, timing reductions, and collision-count
reductions still synchronize the ranks and contribute communication cost.

This is a simple dynamic X-slab decomposition intended for correctness and
future cluster work. Skewed distributions can leave ranks imbalanced, and
frequent boundary crossings can increase migration traffic. A next iteration
could use explicit neighbor-only halo exchange and a load-balanced partition
map, while retaining stable global IDs and canonical pair ownership.

The model currently uses a flat plane and constant heading/speed. It does not
include track boundaries, steering, acceleration, collision response, or
browser integration.

For the optional three-container OpenMPI environment, see
[`../infrastructure/mpi-cluster/README.md`](../infrastructure/mpi-cluster/README.md).

## Local request API (Phase 6)

The dependency-free Node.js HTTP service runs on the host and binds only to
`127.0.0.1:4174`. Build the C++ bridge and start the service from the
repository root:

```bash
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --target neon_rush_api --parallel
node backend/service/server.mjs
```

`GET /api/health` is a liveness check. Submit a simulation with
`POST /api/simulate` and `Content-Type: application/json`:

```json
{
  "requestId": "race-1",
  "mode": "openmp",
  "threads": 2,
  "steps": 60,
  "deltaTime": 0.016,
  "vehicles": [
    {
      "id": 17,
      "x": 0,
      "z": 0,
      "speed": 8,
      "direction": 0,
      "collisionRadius": 1,
      "active": true
    }
  ]
}
```

Supported modes are `sequential`, `openmp` (1–4 threads), and `mpi` (1–3
processes). Requests are limited to 64 KiB, 64 vehicles, 120 steps, and a
delta time from 0 to 0.1 seconds. IDs must be unique unsigned 32-bit integers;
positions are limited to ±1e9, speed to 0–1e6, direction to ±1e12, and
collision radius to 1e-4–1e6; `active` must be boolean. Unknown fields are
rejected. Responses
preserve vehicle IDs and include the updated state, canonical last-step
collision pairs, phase timings, serialization time, and end-to-end service
time. OpenMP/MPI responses also include a measured sequential reference,
speedup, and efficiency, after exact state and collision-pair comparison.
MPI `nodes` entries are hostnames ordered by MPI rank; the reported process
count is the MPI communicator size. Sequential/OpenMP runs report one process
and no distributed node list.

The service accepts browser CORS requests only from
`http://localhost:5173` and `http://127.0.0.1:5173`, handles one simulation at a
time (additional requests receive `409`), and cancels its executor when the
client disconnects or the service shuts down. Errors use
`{"error":{"code":"...","message":"..."}}`; malformed requests receive `400`,
oversized requests `413`, unsupported content types `415`, and backend
failures `502` (execution timeout `504`).

For MPI, start the existing Docker cluster before starting the host service:

```bash
infrastructure/mpi-cluster/scripts/cluster.sh up
node backend/service/server.mjs
```

The host service invokes `cluster.sh api <process-count>` with argument arrays;
the script forwards stdin through `docker compose exec -T` to the existing
`run-mpi` launcher. The MPI image builds the same `neon_rush_api` target. No
Docker socket is mounted into the cluster containers. Direct sequential and
OpenMP modes use `backend/build/neon_rush_api` on the host. Set
`NEON_RUSH_API_BRIDGE` or `NEON_RUSH_CLUSTER_SCRIPT` to override those
executable paths if needed.

The private bridge uses a bounded `NRAPI1` whitespace-delimited numeric
line protocol over stdin and stdout; JSON parsing and HTTP serialization remain
in Node.js. The input starts with
`NRAPI1 <mode> <steps> <deltaTime> <vehicleCount> <threads>`, followed by one
`<id> <x> <z> <speed> <direction> <collisionRadius> <activeFlag>` row per
vehicle (`activeFlag` is `0` or `1`). Stdout starts with an `NRAPI1` result
header containing mode, actual process/thread counts, steps, phase and total
times, collision count, vehicle/pair/node row counts, and optional paired
reference metrics. It is followed by `V` vehicle rows, `P` canonical collision
pairs, `N` MPI hostnames in rank order, and a final `END` line. The bridge
returns only the final state and last-step pairs. MPI rank 0 reads and
broadcasts the bounded request before constructing `MpiSimulation`; other
ranks pass empty initial vehicle vectors. Run the dependency-free service tests
with:

```bash
node --test backend/service/server.test.mjs
```
