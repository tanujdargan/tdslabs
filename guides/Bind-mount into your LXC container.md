Example with my configuration and container 100:

From your node: `nano /etc/pve/lxc/100.conf`

On the bottom of the file add your mounts:

```
mp0: /disk1,mp=/disk1
mp1: /disk2,mp=/disk2
```

save, exit, restart container. `pct reboot 100`