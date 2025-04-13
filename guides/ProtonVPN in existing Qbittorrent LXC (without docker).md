### Step 1: Download ProtonVPN Wireguard Config file
- Scroll down to the wireguard section here: https://account.protonvpn.com/downloads
- Give your connection a name, select Linux, and set it to block malware, ads and trackers
- Enable vpn accelerator
- Select **Secure Core configs** and a server of your choice underneath that.
## 1. Install Required Packages

```bash
apt update
apt install wireguard resolvconf iptables iptables-persistent -y
```
## 2. Place WireGuard Config

Put your ProtonVPN `.conf` file into `/etc/wireguard/`:

```bash
# Example
cp /path/to/your/protonvpn.conf /etc/wireguard/your-connection-name.conf
```

> ✅ Make sure the file name is consistent throughout this guide (`your-connection-name.conf`)

---
## 3. Test the VPN Connection

```bash
wg-quick up your-connection-name
curl -4 ifconfig.me  # Should return your ProtonVPN IP
```

> Use `wg show` to inspect tunnel stats
> Check details of ip shown on some ip lookup website

---
## 4. Enable VPN on Boot

```bash
systemctl enable your-connection-name
```
---
## 5. Create the Killswitch (Firewall Rules)

### Step 1: Create the Rules

```bash
mkdir -p /etc/iptables
iptables -F
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -o your-connection-name -j ACCEPT
iptables -A OUTPUT -j DROP
iptables-save > /etc/iptables/rules.v4
```

> - `lo`: Keeps local traffic alive
>     
> - `your-connection-name`: Allows traffic over VPN only
>     
> - DROP everything else = no leaks
>     
---
### Step 2: Apply Rules on Boot (After VPN is Up)

Create a systemd service to apply iptables _after_ WireGuard comes online:

```bash
nano /etc/systemd/system/vpn-killswitch.service
```

Paste this:

```ini
[Unit]
Description=Apply iptables killswitch after WireGuard is up
After=wg-quick@your-connection-name.service
Requires=wg-quick@your-connection-name.service

[Service]
Type=oneshot
ExecStart=/sbin/iptables-restore < /etc/iptables/rules.v4
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
systemctl daemon-reexec
systemctl daemon-reload
systemctl enable vpn-killswitch.service
```

---
## 6. Reboot & Verify

```bash
reboot
```

Then check:

```bash
curl -4 ifconfig.me            # ✅ Should show ProtonVPN IP
wg show                        # ✅ Tunnel is up
iptables -L -v -n              # ✅ DROP rule is active
```

---
## (Optional) Disable IPv6 to Prevent Leaks

Add to `/etc/sysctl.conf` or `/etc/sysctl.d/disable-ipv6.conf`:

```bash
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

Apply:

```bash
sysctl -p
```

Test:

```bash
curl -6 ifconfig.me  # Should fail or hang
```

---
## (Optional) Leak Test

```bash
curl https://ipleak.net/json/
```

Make sure:

- IPv6 is not listed
    
- IP matches ProtonVPN
    
- DNS is from ProtonVPN
    
---
### 🎉 Done!

Your LXC container now:

- Tunnels all traffic through ProtonVPN via WireGuard
    
- Drops all traffic if the VPN drops
    
- Starts up cleanly and securely on boot