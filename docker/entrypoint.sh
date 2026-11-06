#!/usr/bin/env bash
set -euo pipefail

mkdir -p /run/sshd /root/.ssh

if [ "${NEONRUSH_MPI_ROLE:-master}" = "master" ]; then
  mkdir -p /run/mpi-private
  chmod 700 /run/mpi-private
  if [ ! -s /run/mpi-private/id_ed25519 ]; then
    ssh-keygen -q -t ed25519 -N "" -f /run/mpi-private/id_ed25519
  fi
  if [ ! -s /run/mpi-private/id_ed25519.pub ]; then
    ssh-keygen -y -f /run/mpi-private/id_ed25519 \
      > /run/mpi-private/id_ed25519.pub
  fi
  install -m 600 /run/mpi-private/id_ed25519 /root/.ssh/id_ed25519
  install -m 600 /run/mpi-private/id_ed25519.pub /root/.ssh/authorized_keys
  install -m 644 /run/mpi-private/id_ed25519.pub /run/mpi-ssh/authorized_keys.tmp
  mv /run/mpi-ssh/authorized_keys.tmp /run/mpi-ssh/authorized_keys
fi

chmod 700 /root/.ssh
printf 'Host *\n  StrictHostKeyChecking accept-new\n  UserKnownHostsFile /root/.ssh/known_hosts\n  LogLevel ERROR\n' \
  > /root/.ssh/config
chmod 600 /root/.ssh/config
ssh-keygen -A
/usr/sbin/sshd -D -e &

if [ "${NEONRUSH_MPI_ROLE:-master}" != "master" ]; then
  deadline=$((SECONDS + 60))
  until [ -s /run/mpi-ssh/authorized_keys ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for the MPI master's public SSH key." >&2
      exit 1
    fi
    sleep 0.2
  done
  install -m 600 /run/mpi-ssh/authorized_keys /root/.ssh/authorized_keys
else
  for peer in ${NEONRUSH_MPI_PEERS:-}; do
    deadline=$((SECONDS + 60))
    until ssh -o BatchMode=yes -o ConnectTimeout=2 "$peer" true \
      >/dev/null 2>&1; do
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "Timed out waiting for passwordless SSH to $peer." >&2
        exit 1
      fi
      sleep 0.2
    done
  done
fi

exec "$@"
