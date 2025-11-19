1) https://jellyfin.org/docs/general/administration/hardware-acceleration/intel/#lxc-on-proxmox
2) Note: Jellyfin documentation requires you to add three lines to the config file for your LXC however, when using the community script, these lines are already added to the config for you LXC during creation so its unnecessary.
3) Navigate to root node (tds) and run `nano /etc/modprobe.d/i915.conf` and in this file add:
   `options i915 enable_guc=3`
4) Reboot Full System aka Proxmox VE
5) `nano /ect/pve/lxc/<containerid>.conf` we want to nano into it to cross check the lines from the jellyfin documentation:
   Look for the following lines:
```bash
lxc.cgroup2.devices.allow: c 226:0 rwm
lxc.cgroup2.devices.allow: c 226:128 rwm
lxc.mount.entry: /dev/dri/renderD128 dev/dri/renderD128 none bind,optional,create=file
```
1) If these lines are there then we can continue otherwise, add them
2) run the following to give correct permissions to access the gpu in the LXC by doing:
   `chmod -R 777 /dev/dri/*`
3) Now we can switch to the jellyfin lxc console:
   run `ls /dev/dri` to see if the device is accessible within the lxc
4) Now run: `apt install vainfo intel-gpu-tools`
5) run `vainfo`
6) now run `intel_gpu_top`, it should be idling with everything at 0%
7) Finally we need to give the user permissions for the render, video and input groups:
```bash
usermod -aG video jellyfin
usermod -aG input jellyfin
usermod -aG render jellyfin
```
1) then restart the jellyfin service by doing: `systemctl restart jellyfin.service`
2) Now we can test transcoding by enabling it in the jellyfin dashboard
Reference Youtube Video: https://www.youtube.com/watch?v=XAa_qpNmzZs

In Jellyfin, remember to adjust your settings based on your hardware, for me the following settings work with an i5-8500:

<img width="1099" height="987" alt="image" src="https://github.com/user-attachments/assets/34c4b6f2-e1a8-490b-bf30-8ba793161499" />
<img width="1079" height="564" alt="image" src="https://github.com/user-attachments/assets/ee4eb141-6a31-400b-87c3-997ad9d47c61" />

