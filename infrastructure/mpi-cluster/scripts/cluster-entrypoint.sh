#!/bin/sh
set -eu

role=${NEON_RUSH_ROLE:-}
key_dir=/run/neon-rush-ssh-key
auth_dir=/run/neon-rush-ssh-auth
host_key_dir=/run/neon-rush-hostkeys
host_key="$host_key_dir/ssh_host_ed25519_key"

mkdir -p /run/sshd "$auth_dir" "$host_key_dir"
chmod 0700 "$host_key_dir"
if [ ! -s "$host_key" ]; then
  ssh-keygen -q -t ed25519 -N '' -f "$host_key"
fi
chmod 0600 "$host_key"
chmod 0644 "$host_key.pub"

if [ "$role" = coordinator ]; then
  mkdir -p "$key_dir"
  chmod 0700 "$key_dir"
  if [ ! -s "$key_dir/id_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -f "$key_dir/id_ed25519"
  fi
  chown -R neon:neon "$key_dir"
  chmod 0600 "$key_dir/id_ed25519"
  install -m 0644 "$key_dir/id_ed25519.pub" "$auth_dir/authorized_keys.tmp"
  mv "$auth_dir/authorized_keys.tmp" "$auth_dir/authorized_keys"
elif [ "$role" = worker ]; then
  attempts=0
  while [ ! -s "$auth_dir/authorized_keys" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "Timed out waiting for coordinator SSH public key" >&2
      exit 1
    fi
    sleep 1
  done
else
  echo "NEON_RUSH_ROLE must be coordinator or worker" >&2
  exit 1
fi

exec /usr/sbin/sshd -D -e \
  -p 2222 \
  -o HostKey="$host_key" \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o PermitRootLogin=no \
  -o PubkeyAuthentication=yes \
  -o AuthorizedKeysFile="$auth_dir/authorized_keys" \
  -o AllowUsers=neon
