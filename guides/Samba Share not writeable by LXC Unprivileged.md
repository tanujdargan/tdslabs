Run the following on the root node console:

```bash
mount -o remount /mnt/samba
chown -R 100000:100000 /mnt/samba/MOVIES
chown -R 100000:100000 /mnt/samba/TV_SHOWS
chmod -R 775 /mnt/samba/MOVIES
chmod -R 775 /mnt/samba/TV_SHOWS
ls -ln /mnt/samba
```

if u see the output say uid and guid 100000 then it should be working