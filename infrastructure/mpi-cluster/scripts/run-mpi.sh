#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: run-mpi PROCESS_COUNT PROGRAM [ARG ...]" >&2
  exit 2
fi

process_count=$1
shift
case "$process_count" in
  1|2|3) ;;
  *)
    echo "PROCESS_COUNT must be 1, 2, or 3 for this cluster" >&2
    exit 2
    ;;
esac

key_dir=/run/neon-rush-ssh-key
known_hosts="$key_dir/known_hosts"
if [ ! -s "$known_hosts" ]; then
  temporary_known_hosts=$(mktemp "$key_dir/known_hosts.XXXXXX")
  trap 'rm -f "$temporary_known_hosts"' 0 HUP INT TERM
  if ! ssh-keyscan -T 5 -p 2222 node1 node2 node3 \
      >"$temporary_known_hosts" 2>/dev/null; then
    echo "Unable to collect SSH host keys from all MPI nodes" >&2
    exit 1
  fi
  for node in node1 node2 node3; do
    if ! grep -Fq "[$node]:2222 " "$temporary_known_hosts"; then
      echo "Missing SSH host key for $node" >&2
      exit 1
    fi
  done
  chmod 0600 "$temporary_known_hosts"
  mv "$temporary_known_hosts" "$known_hosts"
  trap - 0 HUP INT TERM
fi

exec mpirun \
  --hostfile /etc/neon-rush/hostfile \
  --map-by ppr:1:node \
  --bind-to none \
  --mca plm_rsh_args "-p 2222 -i $key_dir/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts -o LogLevel=ERROR" \
  -np "$process_count" \
  "$@"
