# Complete Guide: Cloning Proxmox Boot Drive to a Larger SSD/NVMe

## Overview
This guide walks you through cloning a Proxmox VE boot drive from a smaller SSD to a larger SSD/NVMe drive, including troubleshooting common issues like LVM duplicate PVs and systemd-journald failures.

**Scenario**: Upgrading from a 256GB Patriot SSD to a 512GB Samsung NVMe drive while preserving all VMs, containers, and configurations.

**Time Required**: 1-3 hours depending on drive size and issues encountered

**Difficulty**: Intermediate

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Create Clonezilla Bootable USB](#step-1-create-clonezilla-bootable-usb)
3. [Step 2: Clone the Drive](#step-2-clone-the-drive)
4. [Step 3: First Boot Attempt](#step-3-first-boot-attempt)
5. [Step 4: Fix LVM Duplicate PV Issue](#step-4-fix-lvm-duplicate-pv-issue)
6. [Step 5: Fix systemd-journald Issue](#step-5-fix-systemd-journald-issue)
7. [Step 6: Verification and Expansion](#step-6-verification-and-expansion)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Hardware Required
- Source drive (original Proxmox boot drive) - e.g., 256GB SSD
- Destination drive (new larger drive) - e.g., 512GB NVMe
- Both drives installed in the server
- USB flash drive (8GB+) for Clonezilla
- Another computer to create bootable USB (optional but helpful)

### Software Required
- [Clonezilla Live ISO](https://clonezilla.org/downloads.php) (download the AMD64 version)
- [Rufus](https://rufus.ie/) or similar USB creation tool (for Windows)
- [SystemRescue ISO](https://www.system-rescue.org/Download/) (backup option for troubleshooting)

### Before You Start
- ⚠️ **BACKUP YOUR DATA** - While cloning is generally safe, always have backups
- Know which drive is which (check serial numbers, sizes, device names)
- Ensure both drives are connected to the server
- Have physical access to the server

---

## Step 1: Create Clonezilla Bootable USB

### On Windows:

1. **Download Clonezilla Live**
   - Go to https://clonezilla.org/downloads.php
   - Download "Clonezilla live (Alternative stable releases)" → AMD64 version
   - File will be named something like `clonezilla-live-3.x.x-amd64.iso`

2. **Download Rufus**
   - Go to https://rufus.ie/
   - Download the portable version (no installation needed)

3. **Create Bootable USB**
   - Insert your USB flash drive (will be erased!)
   - Run Rufus as Administrator
   - Settings:
     - **Device**: Select your USB drive
     - **Boot selection**: Click SELECT and choose the Clonezilla ISO
     - **Partition scheme**: GPT
     - **Target system**: UEFI
   - Click **START**
   - Wait for completion (2-5 minutes)

Note: I used VENTOY

### On Linux:

```bash
# Insert USB drive and find its device name
lsblk

# Write ISO to USB (replace /dev/sdX with your USB device!)
sudo dd if=clonezilla-live-3.x.x-amd64.iso of=/dev/sdX bs=4M status=progress
sudo sync
```

---

## Step 2: Clone the Drive

### Boot into Clonezilla

1. **Insert the Clonezilla USB** into your Proxmox server
2. **Reboot the server** and enter BIOS/UEFI (usually F2, F12, DEL, or ESC)
3. **Change boot order** to boot from USB first
4. **Save and exit** BIOS

### Clonezilla Menu Navigation

5. **Select Clonezilla boot option**
   - Choose: `Clonezilla live (Default settings, VGA 800x600)`
   - Press Enter

6. **Language Selection**
   - Choose your language (default is English)
   - Press Enter

7. **Keyboard Layout**
   - Choose "Don't touch keymap" (or select your layout)
   - Press Enter

8. **Start Clonezilla**
   - Select: `Start_Clonezilla` 
   - Press Enter

9. **Choose Mode**
   - Select: `device-device work directly from a disk or partition to a disk or partition`
   - Press Enter

10. **Choose Clone Type**
    - Select: `Beginner mode: Accept the default options`
    - Press Enter

11. **Select Clone Option**
    - Select: `disk_to_local_disk local_disk_to_local_disk_clone`
    - Press Enter

### Perform the Clone

12. **Select Source Disk**
    - You'll see a list of drives with their sizes
    - Example:
      ```
      sda [256.06 GB] Patriot_P210_256GB
      nvme0n1 [512.11 GB] SAMSUNG_MZAL8512HFLU...
      ```
    - **Use arrow keys** to select your **SOURCE** drive (the old 256GB drive)
    - Press Enter

13. **Select Destination Disk**
    - From the remaining drives, select your **DESTINATION** drive (new 512GB NVMe)
    - **⚠️ CRITICAL**: Double-check you selected the correct drive - the destination will be ERASED!
    - Press Enter

14. **Skip Checking Source Filesystem**
    - Select: `-sfsck Skip checking/repairing source file system`
    - Press Enter

15. **Choose Clone Options**
    - Select: `-k1 Create partition table proportionally`
    - This will allow you to expand partitions later
    - Press Enter

16. **Final Confirmation**
    - You'll see a summary of what will be cloned
    - Type `y` and press Enter to confirm
    - Type `y` again when asked if you want to continue
    - Press Enter to start cloning

### Wait for Cloning to Complete

17. **Monitor Progress**
    - Cloning time depends on drive size and data amount
    - For 256GB with ~100GB used: 15-30 minutes
    - You'll see a progress bar with estimated time

18. **Cloning Complete**
    - When done, you'll see: `The disk was successfully cloned`
    - Press Enter to continue
    - Select: `reboot`
    - Press Enter
    - **Remove the Clonezilla USB** when prompted

---

## Step 3: First Boot Attempt

### Change Boot Order in BIOS

1. **Enter BIOS/UEFI** during boot (F2, F12, DEL, or ESC)
2. **Navigate to Boot Menu**
3. **Change boot priority**:
   - Set the **new NVMe drive** (512GB) as first boot device
   - Old SSD should be lower priority or disabled
4. **Save and Exit**

### Expected Error - LVM Duplicate PV

When you boot, you'll likely see errors like:

```
WARNING: Not using device /dev/nvme0n1p3 for PV DBJJsy-35dL-FFf2-x152-h7fB-uT1K-r16X4I.
WARNING: PV DBJJsy-35dL-FFf2-x152-h7fB-uT1K-r16X4I prefers device /dev/sda3 because device is used by LV.
Cannot activate LVs in VG pve while PVs appear on duplicate devices.
Cannot activate LVs in VG pve while PVs appear on duplicate devices.
[FAILED] Failed to start systemd-journald.service - Journal Service.
```

**Why this happens**: Both drives have identical LVM Physical Volume UUIDs. LVM doesn't know which one to use.

**Don't panic!** This is expected and easy to fix.

---

## Step 4: Fix LVM Duplicate PV Issue

You have two options to fix this:

### Option A: Disconnect Old Drive (Recommended)

**This is the simplest solution.**

1. **Power down the server completely**
   ```bash
   poweroff
   ```

2. **Physically disconnect the old 256GB drive**
   - Unplug the SATA data cable
   - Or remove the drive entirely

3. **Boot from the new NVMe drive only**
   - The system will boot successfully without the duplicate
   - You can skip to [Step 6: Verification](#step-6-verification-and-expansion)

4. **Wipe the old drive (to prevent future conflicts)**

   **Method 1: Using Another Computer**
   - Connect old drive via SATA-to-USB adapter to another PC
   - Open Disk Management (Windows) or GParted (Linux)
   - Delete all partitions on the drive
   - **Or use Windows diskpart:**
     ```cmd
     diskpart
     list disk
     select disk X  (where X is your old drive - verify size!)
     clean
     exit
     ```

   **Method 2: After Proxmox Boots**
   - Once Proxmox boots successfully from NVMe
   - Hot-plug the old drive (if your server supports it)
   - Run:
     ```bash
     wipefs -a /dev/sda
     ```

5. **Done!** You can now keep the old drive as backup storage or repurpose it.

### Option B: Boot from Live USB and Remove Duplicate

**If you can't disconnect the old drive:**

1. **Boot from a Linux Live USB** (Clonezilla or SystemRescue)

2. **Open a terminal and become root**
   ```bash
   sudo su -
   ```

3. **Identify the old drive**
   ```bash
   lsblk
   # Look for the 256GB drive - usually /dev/sda
   ```

4. **Wipe LVM signatures from old drive**
   ```bash
   # Deactivate all LVM volumes first
   vgchange -an pve
   
   # Remove PV signature from old drive
   pvremove /dev/sda3  # Adjust partition number if different
   
   # Wipe all signatures
   wipefs -a /dev/sda
   ```

5. **Reboot**
   ```bash
   reboot
   ```

6. **Remove Live USB and boot normally**
   - Both drives can now coexist
   - Boot from the NVMe drive

---

## Step 5: Fix systemd-journald Issue

After fixing the LVM duplicate issue, you might encounter a new error on boot:

```
Found volume group "pve" using metadata type lvm2
15 logical volume(s) in volume group "pve" now active
/dev/mapper/pve-root: clean, 107811/4554752 files, 5056783/18214912 blocks
[FAILED] Failed to start systemd-journald.service - Journal Service.
```

**The system hangs here completely** - no login prompt, no shell access.

**Why this happens**: The journal directory structure got corrupted during cloning or boot issues.

### Fix Using Live USB

1. **Boot from Linux Live USB** (Clonezilla, SystemRescue, or Ubuntu Live)

2. **Open terminal and become root**
   ```bash
   sudo su -
   ```

3. **Activate LVM volumes**
   ```bash
   vgchange -ay pve
   ```

4. **Verify volumes are active**
   ```bash
   lvs
   ```
   
   You should see output like:
   ```
   LV        VG  Attr       LSize
   data      pve twi-a-tz-- <141.57g
   root      pve -wi-a-----  68.00g
   swap      pve -wi-a-----   7.54g
   ```

5. **Run filesystem check**
   ```bash
   fsck -y /dev/mapper/pve-root
   ```
   
   Expected output:
   ```
   /dev/mapper/pve-root: recovering journal
   /dev/mapper/pve-root: clean, 107805/4554752 files, 5062915/18214912 blocks
   ```

6. **Mount the root filesystem**
   ```bash
   mkdir -p /mnt
   mount /dev/mapper/pve-root /mnt
   ```

7. **Verify mount succeeded**
   ```bash
   ls -la /mnt
   ```
   
   You should see Proxmox's root directory structure:
   ```
   bin  boot  dev  etc  home  lib  lib64  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
   ```

8. **Mount necessary filesystems for chroot**
   ```bash
   mount -t proc /proc /mnt/proc
   mount -t sysfs /sys /mnt/sys
   mount --rbind /dev /mnt/dev
   mount --rbind /run /mnt/run
   ```

9. **Enter chroot environment**
   ```bash
   chroot /mnt /bin/bash
   ```
   
   Your prompt should change to show you're in the Proxmox system

10. **Fix the journal directory**
    ```bash
    # Create journal directory with correct structure
    systemd-tmpfiles --create --prefix /var/log/journal
    
    # Set correct permissions
    chmod 2755 /var/log/journal
    
    # Flush journal (may show errors - that's okay)
    journalctl --flush
    ```

11. **Exit chroot**
    ```bash
    exit
    ```

12. **Unmount everything**
    ```bash
    # Change back to home directory (important!)
    cd ~
    
    # Lazy unmount (handles busy mounts gracefully)
    umount -l /mnt
    
    # Deactivate LVM
    vgchange -an pve
    ```

13. **Reboot**
    ```bash
    reboot
    ```

14. **Remove Live USB and boot normally**
    - The system should now boot successfully!

---

## Step 6: Verification and Expansion

### Verify Successful Boot

1. **System should boot to login prompt**
   - No LVM errors
   - No systemd-journald errors
   - Normal Proxmox boot sequence

2. **Log in via console or web interface**
   - Console: username `root` + your password
   - Web: `https://your-server-ip:8006`

3. **Check system status**
   ```bash
   # Check all VMs and containers
   qm list       # Virtual machines
   pct list      # Containers
   
   # Check storage
   pvs
   vgs
   lvs
   df -h
   ```

### Expand Partitions to Use Full Drive

Currently, your 512GB drive only uses 256GB (the cloned size). Let's expand it properly:

1. **Check current partition layout**
   ```bash
   lsblk
   fdisk -l /dev/nvme0n1
   ```

2. **Expand the LVM partition**
   ```bash
   # Install parted if not available
   apt update && apt install parted
   
   # Resize partition 3 (LVM partition) to use all space
   parted /dev/nvme0n1 resizepart 3 100%
   ```

3. **⚠️ CRITICAL: Resize the Physical Volume**
   
   **This step is essential!** Just expanding the partition isn't enough - you must tell LVM to use the new space:
   
   ```bash
   # Tell LVM about the expanded partition
   pvresize /dev/nvme0n1p3
   ```
   
   Expected output:
   ```
   Physical volume "/dev/nvme0n1p3" changed
   1 physical volume(s) resized or updated / 0 physical volume(s) not resized
   ```

4. **Verify the expansion worked**
   ```bash
   # Check Physical Volume size
   pvs
   ```
   
   You should see:
   ```
   PV             VG  Fmt  Attr PSize   PFree  
   /dev/nvme0n1p3 pve lvm2 a--  475.93g 254.46g
   ```
   
   **Before pvresize**: PSize shows ~237GB  
   **After pvresize**: PSize shows ~476GB with ~254GB free ✅
   
   ```bash
   # Check Volume Group
   vgs
   ```
   
   Should show:
   ```
   VG  #PV #LV #SN Attr   VSize   VFree  
   pve   1  16   0 wz--n- 475.93g 254.46g
   ```

5. **Extend the data volume for VMs/containers**
   
   Now allocate the free space to your VM storage:
   
   ```bash
   # Give ALL free space to VM/container storage (recommended)
   lvextend -l +100%FREE /dev/pve/data
   ```
   
   **Alternative options:**
   
   ```bash
   # Option A: Add 100GB to root, rest to data
   lvextend -L +100G /dev/pve/root
   resize2fs /dev/pve/root
   lvextend -l +100%FREE /dev/pve/data
   
   # Option B: Add 50GB to root, rest to data
   lvextend -L +50G /dev/pve/root
   resize2fs /dev/pve/root
   lvextend -l +100%FREE /dev/pve/data
   
   # Option C: Just extend root (not recommended for Proxmox)
   lvextend -L +100G /dev/pve/root
   resize2fs /dev/pve/root
   ```

6. **Verify final sizes**
   ```bash
   # Check logical volumes
   lvs
   ```
   
   Your `data` volume should now show **~396GB** instead of 141.6GB:
   ```
   LV   VG  Attr       LSize   Pool Origin Data%  Meta%
   data pve twi-aotz-- 396.03g                31.41  4.03
   root pve -wi-ao----  69.48g
   swap pve -wi-ao----  <7.54g
   ```
   
   ```bash
   # Verify all space is allocated
   vgs
   ```
   
   VFree should show **0** (all space used):
   ```
   VG  #PV #LV #SN Attr   VSize   VFree
   pve   1  16   0 wz--n- 475.93g    0
   ```
   
   ```bash
   # Check filesystem usage
   df -h
   ```

### Final Checks

```bash
# Verify everything is healthy
pvs
vgs
lvs
df -h

# Check SMART status of new drive
smartctl -a /dev/nvme0n1

# Verify all VMs/containers start
qm start <VMID>
pct start <CTID>
```

**Success!** Your Proxmox installation is now running on the larger drive with room to grow.

---

## Troubleshooting

### Issue: "Cannot find device /dev/nvme0n1p3" during boot

**Cause**: GRUB bootloader still pointing to old drive

**Solution**:
```bash
# Boot from live USB
mount /dev/mapper/pve-root /mnt
mount /dev/nvme0n1p2 /mnt/boot/efi  # EFI partition
chroot /mnt /bin/bash

# Reinstall GRUB
grub-install /dev/nvme0n1
update-grub

exit
reboot
```

### Issue: "Incompatible libdevmapper" error

**Cause**: Running LVM commands without root privileges

**Solution**:
```bash
# Always use sudo or become root
sudo vgchange -ay pve
# Or
sudo su -
vgchange -ay pve
```

### Issue: USB adapter not detecting old drive

**Symptoms**: Old drive shows in Disk Management but disappears

**Solutions**:
- Try different USB port (USB 3.0 recommended)
- Check if adapter needs external power
- Try different cable
- Use the live USB method instead

### Issue: "target is busy" when unmounting

**Cause**: Process still using the mounted filesystem

**Solutions**:
```bash
# Make sure you're not in /mnt directory
cd ~

# Lazy unmount
umount -l /mnt

# Or force kill processes
fuser -km /mnt
umount /mnt

# Or just reboot (easiest)
reboot
```

### Issue: Clone succeeded but NVMe not bootable

**Symptoms**: BIOS doesn't show NVMe as boot option

**Solutions**:
1. Check if NVMe is enabled in BIOS
2. Enable UEFI boot mode (not Legacy)
3. Check if secure boot is interfering (disable it)
4. Some BIOSes require manual boot entry creation
5. Try different M.2 slot if available

### Issue: Proxmox web interface not accessible after clone

**Symptoms**: Can't reach https://server-ip:8006

**Solutions**:
```bash
# Check if pveproxy is running
systemctl status pveproxy

# Restart if needed
systemctl restart pveproxy

# Check network configuration
ip addr
cat /etc/network/interfaces

# Regenerate SSL certificates if needed
pvecm updatecerts
```

---

## Best Practices

### Do's ✅
- Always backup before cloning
- Verify both drives are detected before starting
- Double-check source/destination before cloning
- Keep old drive as backup for a while
- Test all VMs/containers after migration
- Update firmware on new drive before cloning
- Document which drive is which (labels, serial numbers)

### Don'ts ❌
- Don't clone while Proxmox is running
- Don't skip filesystem checks
- Don't rush through Clonezilla menus
- Don't delete old drive data immediately
- Don't assume clone was successful without verification
- Don't expand partitions before verifying boot
- Don't use the old drive as boot device after clone

---

## Alternative: Proxmox Backup/Restore Method

**When to use this instead of cloning:**
- Moving to completely different hardware
- Want to clean install Proxmox
- Selective restoration of VMs/containers only
- Source drive has errors or bad sectors

**Pros:**
- Fresh Proxmox installation
- Can skip unwanted VMs/containers
- Works across different hardware
- Cleaner approach for major upgrades

**Cons:**
- More time-consuming
- Requires reconfiguring Proxmox settings
- Network configuration might need adjusting
- Lose system customizations unless documented

**Quick steps:**
1. Install Proxmox Backup Server or use PBS
2. Backup all VMs/containers from source
3. Fresh install Proxmox on new drive
4. Restore VMs/containers from backup
5. Reconfigure network, storage, users, etc.

---

## Summary

**What we accomplished:**
1. ✅ Cloned 256GB Proxmox boot drive to 512GB NVMe
2. ✅ Fixed LVM duplicate PV conflicts
3. ✅ Repaired systemd-journald corruption
4. ✅ Expanded partitions to use full drive capacity
5. ✅ Verified all VMs and containers working
6. ✅ Repurposed old drive for storage/backup

**Total process:**
- Cloning: 15-30 minutes
- Troubleshooting: 30-60 minutes
- Verification & expansion: 15-30 minutes
- **Total: 1-2 hours**

**Key takeaways:**
- Clonezilla is reliable for drive cloning
- LVM duplicate issues are expected and easy to fix
- systemd-journald can be repaired from live USB
- Always verify before deleting old drive
- Expansion gives you full use of new drive capacity

---

## Resources

- [Proxmox VE Documentation](https://pve.proxmox.com/pve-docs/)
- [Clonezilla Official Site](https://clonezilla.org/)
- [SystemRescue](https://www.system-rescue.org/)
- [LVM Administration Guide](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/configuring_and_managing_logical_volumes/)

---

## Credits

This guide was created based on real-world experience cloning a Proxmox server from a 256GB Patriot P210 SSD to a 512GB Samsung NVMe drive (MZAL8512HFLU).

**Written**: December 2024  
**Tested on**: Proxmox VE 8.x  
**Clonezilla version**: 3.3.0-33

---

## License

This guide is provided as-is for educational purposes. Always backup your data before performing any disk operations.

**Good luck with your clone! 🚀**
