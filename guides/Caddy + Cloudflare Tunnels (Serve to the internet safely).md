
# 🛡️ Caddy + Cloudflare Tunnels Setup Guide

This guide walks you through setting up a **Cloudflare Tunnel** to expose services running in a **Caddy LXC container**, with optional configuration for apps like `paperless-ngx`.

---

## 📦 Step 1: Install `cloudflared` in the Caddy LXC

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | \
    sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update && sudo apt install cloudflared
```

Reference: [Cloudflare Docs – Local Tunnel Setup](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/local-management/create-local-tunnel/)

---

## 🔐 Step 2: Authenticate & Create Tunnel

Authenticate your instance:

```bash
cloudflared tunnel login
```

> A browser window will open — select your domain and authorize.

After successful login, you should see:

```text
You have successfully logged in.
If you wish to copy your credentials to a server, they have been saved to:
/root/.cloudflared/cert.pem
```

Now, create a tunnel:

```bash
cloudflared tunnel create caddy-tunnel
```

Sample output:

```text
Tunnel credentials written to /root/.cloudflared/<your-tunnel-id>.json.
Created tunnel caddy-tunnel with ID <your-tunnel-id>
```

---

## ⚙️ Step 3: Configure Cloudflared

Create the configuration directory and install `cloudflared` as a service:

```bash
sudo mkdir -p /etc/cloudflared
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### Example config (`/etc/cloudflared/config.yml`):

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: subdomain.domain.com
    service: http://<ip-address>:<port>
  - service: http_status:404
```

---

## 🌐 Step 4: Configure Caddy Reverse Proxy

Edit the Caddyfile:

```bash
sudo nano /etc/caddy/Caddyfile
```

### Example Caddyfile:

```caddyfile
subdomain.domain.com {
    reverse_proxy <ip-address>:<port>
}
```

Then reload Caddy:

```bash
caddy reload
```

---

## 📝 Optional: Fix CSRF Issues for `paperless-ngx`

Some apps (like `paperless-ngx`) require additional environment variables to work properly behind a reverse proxy.

Edit the service definition:

```bash
sudo nano /etc/systemd/system/paperless-webserver.service
```

Add the following under the `[Service]` block:

```ini
Environment="PAPERLESS_CSRF_TRUSTED_ORIGINS=https://paperless.yourdomain.com"
Environment="PAPERLESS_SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https"
```

Reload systemd and restart the service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart paperless-webserver
```

---

## ✅ You're Done!

You’ve now securely exposed a service through Cloudflare using Caddy and `cloudflared`.
