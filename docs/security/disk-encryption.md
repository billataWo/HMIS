# Disk encryption

For the technician setting up a clinic server or the clinic's PCs. With full-disk encryption, a
stolen or lost computer, or a disk thrown away later, does not expose patient records: without
the key, the disk is unreadable.

| Machine | Why | How |
|---|---|---|
| Clinic server: system disk (database) | Holds every patient record | Ubuntu with LUKS, unlocked by the TPM at boot |
| Clinic server: backup disk | Encrypted backups, but also the raw copy kept during a restore | LUKS, unlocked by a key file on the system disk |
| PCs that use offline mode | Keep the day's patients in the browser | BitLocker / Device encryption |
| Admin and doctor laptops | Leave the building | BitLocker / Device encryption |
| Cloud server | Every clinic's records | The provider's encrypted volumes (or LUKS) |

After setting up a clinic server, run `sudo deploy/host-check.sh`: it checks the database and
backup disks and reports to **Settings → Backups** ("Disk encryption").

## Clinic server (Ubuntu Server 24.04 LTS)

### 1. Encrypt the system disk when installing

In the installer's storage step choose **Use an entire disk**, tick **Set up this disk as an LVM
group** and **Encrypt the LVM group with LUKS**, and set a long passphrase.

**Write the passphrase down** and keep it with the backup encryption key: in the clinic's safe and
with the HMIS support team. It is needed if the TPM cannot unlock the disk (see below).

### 2. Unlock it without anyone typing (power cuts)

A clinic server must start again on its own after a power cut. The TPM (the security chip on the
motherboard) can release the key automatically, but only to this machine, unchanged. A disk
taken out and put in another computer stays locked.

```sh
sudo apt install clevis clevis-tpm2 clevis-luks clevis-initramfs
lsblk -f                                   # the partition marked crypto_LUKS, e.g. /dev/nvme0n1p3
sudo clevis luks bind -d /dev/nvme0n1p3 tpm2 '{"pcr_ids":"7"}'   # asks for the passphrase once
sudo update-initramfs -u -k all
sudo reboot                                # must start without asking for the passphrase
```

The passphrase keeps working as a fallback: after a firmware or Secure Boot change the TPM may
refuse, and the server waits for it on the screen. Then type it once and bind again:
`sudo clevis luks regen -d /dev/nvme0n1p3 -s 1`.

The machine needs TPM 2.0 switched on in the BIOS/UEFI (often "PTT" on Intel, "fTPM" on AMD).

### 3. Encrypt the backup disk

The backup disk unlocks with a key file kept on the (encrypted) system disk: it opens by itself
when the server starts, and on its own (stolen) it is unreadable.

```sh
DISK=/dev/sdb                                       # the backup disk: check with lsblk first!
sudo cryptsetup luksFormat "$DISK"                  # a passphrase: write it down with the other keys
sudo install -d -m 700 /etc/luks-keys
sudo dd if=/dev/urandom of=/etc/luks-keys/backup.key bs=64 count=1
sudo chmod 400 /etc/luks-keys/backup.key
sudo cryptsetup luksAddKey "$DISK" /etc/luks-keys/backup.key
sudo cryptsetup open "$DISK" backup --key-file /etc/luks-keys/backup.key
sudo mkfs.ext4 /dev/mapper/backup
echo "backup UUID=$(sudo blkid -s UUID -o value "$DISK") /etc/luks-keys/backup.key luks" | sudo tee -a /etc/crypttab
sudo mkdir -p /mnt/backup
echo "/dev/mapper/backup /mnt/backup ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
sudo mount -a && sudo chown 999:999 /mnt/backup && sudo chmod 700 /mnt/backup
```

Then set `BACKUP_DISK=/mnt/backup` in `deploy/.env` ([backup guide](../backup/README.md)).

### 4. Check it, every day

```sh
sudo deploy/host-check.sh
echo '0 6 * * * root /opt/hmis/deploy/host-check.sh >/dev/null 2>&1' | sudo tee /etc/cron.d/hmis-host-check
```

(Adjust `/opt/hmis` to where HMIS is installed.) Each run updates Settings → Backups. It warns if
a disk is not encrypted, or if the check has not run for more than 8 days.

## Windows PCs and laptops

- **Windows 10/11 Pro or Enterprise**: Control Panel → **BitLocker Drive Encryption** → **Turn on
  BitLocker** for drive C:. Save the recovery key by printing it (keep it with the other keys)
  or in the clinic's Microsoft account. With the TPM the PC starts normally, with no extra password.
- **Windows Home**: Settings → Privacy & security → **Device encryption** → On. It appears only on
  PCs that support it (TPM 2.0 and modern hardware). If it is not there, upgrade to Pro for
  BitLocker, or do not use that PC for offline work.
- **Check**: Settings → Privacy & security → Device encryption shows "On", or in an administrator
  PowerShell `manage-bde -status C:` shows "Protection On".

## Keys and recovery

Keep one sealed envelope per server or PC, in the clinic's safe, with a copy held by the support
team. Each envelope holds:
- the LUKS passphrase(s) or BitLocker recovery key;
- the backup encryption key;
- the archive key.

Without them, a dead motherboard or TPM means the disk cannot be read. The data then comes back
from the off-site backups ([RESTORE.md](../backup/RESTORE.md)), but that takes longer.

## What it does not protect

Encryption protects a machine that is switched off or stolen. A running server, or a PC that is
on and signed in, is protected by passwords, two-step sign-in, screen locks and HTTPS instead:
- set PCs to lock after 5 minutes without use;
- never leave a server's console signed in.
