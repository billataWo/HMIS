#!/usr/bin/env bash
# Checks that the disks holding patient data are encrypted (LUKS), and whether they unlock by
# themselves after a power cut (TPM2). Run as root on a clinic server, after installing and then
# daily (see docs/security/disk-encryption.md):
#   sudo deploy/host-check.sh
# The result is written to the backup disk, where the backup worker reads it: Settings → Backups
# warns while a disk is not encrypted.
set -Eeuo pipefail

here=$(cd "$(dirname "$0")" && pwd)
env_file="$here/.env"
backup_disk=$(grep -E '^BACKUP_DISK=' "$env_file" 2>/dev/null | tail -1 | cut -d= -f2- || true)
docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo): reading the disk layout needs it." >&2
  exit 2
fi

# Text made safe to put inside a JSON string.
esc() {
  local bs='\' s=$1
  s=${s//"$bs"/"$bs$bs"}
  printf '%s' "${s//\"/$bs\"}"
}

# Every device a path sits on, from the filesystem down to the physical disk.
chain() {
  local source
  source=$(findmnt -n -o SOURCE --target "$1" 2>/dev/null | sed -n '1{s/\[.*\]//;p}' || true)
  [[ -n $source && -b $source ]] || return 0
  lsblk -s -n -r -o NAME,TYPE,PATH "$source" 2>/dev/null
}

check_path() {
  local label=$1 path=$2 encrypted=false tpm=false device="" luks=""
  if [[ ! -e $path ]]; then
    printf '{"label":"%s","path":"%s","found":false,"encrypted":false,"tpm2":false}' "$(esc "$label")" "$(esc "$path")"
    return
  fi
  device=$(findmnt -n -o SOURCE --target "$path" 2>/dev/null | sed -n '1{s/\[.*\]//;p}' || true)
  while read -r name type devpath; do
    [[ -n ${name:-} ]] || continue
    if [[ $type == crypt ]]; then
      encrypted=true
      # The LUKS container is the device directly below the "crypt" mapping.
      luks=$(lsblk -s -n -r -o PATH "/dev/mapper/$name" 2>/dev/null | sed -n 2p || true)
    fi
  done < <(chain "$path")
  if [[ -n $luks ]] && command -v cryptsetup >/dev/null; then
    # Unlocked by the TPM at boot: clevis (tpm2 pin) or systemd-cryptenroll (systemd-tpm2 token).
    # Read it whole first: "grep -q" stopping early would fail the pipe under pipefail.
    local dump
    dump=$(cryptsetup luksDump "$luks" 2>/dev/null || true)
    if grep -qiE 'clevis|systemd-tpm2' <<<"$dump"; then tpm=true; fi
  fi
  printf '{"label":"%s","path":"%s","found":true,"device":"%s","encrypted":%s,"tpm2":%s}' "$(esc "$label")" "$(esc "$path")" "$(esc "$device")" "$encrypted" "$tpm"
}

disks=("$(check_path "Database and app (Docker)" "$docker_root")")
if [[ -n $backup_disk && $backup_disk == /* ]]; then
  disks+=("$(check_path "Backup disk" "$backup_disk")")
fi
json="{\"checkedAt\":\"$(date -u +%FT%TZ)\",\"host\":\"$(esc "$(hostname)")\",\"disks\":[$(IFS=,; echo "${disks[*]}")]}"

all_ok=true
echo "Disk encryption on $(hostname):"
for d in "${disks[@]}"; do
  label=$(sed -E 's/.*"label":"([^"]*)".*/\1/' <<<"$d")
  path=$(sed -E 's/.*"path":"([^"]*)".*/\1/' <<<"$d")
  if grep -q '"encrypted":true' <<<"$d"; then
    if grep -q '"tpm2":true' <<<"$d"; then
      echo "  OK   $label ($path): encrypted, unlocks by itself at boot (TPM2)"
    else
      echo "  OK   $label ($path): encrypted (needs its passphrase at boot unless unlocked another way)"
    fi
  else
    all_ok=false
    echo "  FAIL $label ($path): NOT encrypted. A stolen disk would expose patient records."
  fi
done

# Where the backup worker reads it (the state folder on the backup disk).
if [[ -n $backup_disk && -d $backup_disk ]]; then
  mkdir -p "$backup_disk/state"
  printf '%s\n' "$json" >"$backup_disk/state/host-security.json"
  chown 999:999 "$backup_disk/state/host-security.json" 2>/dev/null || true
  echo "Result saved for Settings → Backups."
else
  echo "(BACKUP_DISK is not set in $env_file: the result is not shown in HMIS.)"
fi
$all_ok || {
  echo "See docs/security/disk-encryption.md to encrypt."
  exit 1
}
