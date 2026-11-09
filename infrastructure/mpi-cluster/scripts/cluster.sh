#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file="$script_dir/../compose.yaml"

compose() {
  docker compose -f "$compose_file" "$@"
}

run_mpi() {
  process_count=$1
  shift
  compose exec -T --user neon node1 \
    /usr/local/bin/run-mpi "$process_count" "$@"
}

usage() {
  cat <<'EOF'
Usage: cluster.sh COMMAND [arguments]
  up                         Build and start the three-node cluster
  status                     Show node health
  verify                     Check DNS, SSH, MPI and rank placement
  test                       Run CTest and a three-container MPI test
  run [NODES] [VEHICLES] [STEPS]
                             Run MPI simulation (defaults: 3, 1000, 1000)
  api PROCESS_COUNT          Run the request-driven MPI API bridge
  benchmark [VEHICLES] [STEPS] [REPETITIONS] [OMP_MAX_THREADS]
                             Compare sequential, OpenMP and MPI modes
  down                       Stop containers (keeps runtime SSH key volumes)
EOF
}

command_name=${1:-}
if [ "$#" -gt 0 ]; then
  shift
fi

case "$command_name" in
  up)
    compose up -d --build --wait
    compose ps
    ;;
  status)
    compose ps
    ;;
  verify)
    compose exec -T node1 sh -ec '
      for node in node1 node2 node3; do
        printf "%s -> " "$node"
        getent hosts "$node"
        ping -c 1 -W 2 "$node" >/dev/null
      done
    '
    run_mpi 3 /opt/neon-rush/build/neon_rush_sim \
      --mode mpi --vehicles 1 --steps 0 --repetitions 1
    for node in node2 node3; do
      compose exec -T node1 ssh \
        -p 2222 \
        -i /run/neon-rush-ssh-key/id_ed25519 \
        -o BatchMode=yes \
        -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile=/run/neon-rush-ssh-key/known_hosts \
        -o LogLevel=ERROR \
        "neon@$node" hostname
    done
    for node in node1 node2 node3; do
      printf '%s: ' "$node"
      compose exec -T "$node" ompi_info --version | sed -n '1p'
    done
    ;;
  test)
    compose exec -T --user neon node1 \
      ctest --test-dir /opt/neon-rush/build --output-on-failure
    run_mpi 3 /opt/neon-rush/build/neon_rush_mpi_tests
    ;;
  run)
    process_count=${1:-3}
    vehicles=${2:-1000}
    steps=${3:-1000}
    run_mpi "$process_count" /opt/neon-rush/build/neon_rush_sim \
      --mode mpi --vehicles "$vehicles" --steps "$steps"
    ;;
  api)
    process_count=${1:-}
    if [ -z "$process_count" ]; then
      echo "api requires a process count (1, 2, or 3)" >&2
      exit 2
    fi
    run_mpi "$process_count" /opt/neon-rush/build/neon_rush_api \
      --mode mpi
    ;;
  benchmark)
    vehicles=${1:-1000}
    steps=${2:-1000}
    repetitions=${3:-5}
    omp_threads=${4:-4}
    app=/opt/neon-rush/build/neon_rush_sim

    printf '\n=== Sequential: %s vehicles, %s steps ===\n' "$vehicles" "$steps"
    compose exec -T --user neon node1 "$app" \
      --mode sequential --vehicles "$vehicles" --steps "$steps" \
      --repetitions "$repetitions"

    printf '\n=== OpenMP sweep: 1, 2, and up to %s threads ===\n' "$omp_threads"
    compose exec -T --user neon node1 "$app" \
      --mode sweep --vehicles "$vehicles" --steps "$steps" \
      --threads "$omp_threads" --repetitions "$repetitions"

    for process_count in 1 2 3; do
      printf '\n=== MPI comparison: %s process(es) ===\n' "$process_count"
      run_mpi "$process_count" "$app" \
        --mode mpi-compare --vehicles "$vehicles" --steps "$steps" \
        --repetitions "$repetitions"
    done
    ;;
  down)
    compose down
    ;;
  help|-h|--help|'')
    usage
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    usage >&2
    exit 2
    ;;
esac
