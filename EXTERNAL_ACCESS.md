# MelodySync External Access

This guide covers operator-managed ways to reach a locally installed MelodySync instance from outside the host machine.

MelodySync itself only manages the local chat service. External exposure is intentionally treated as infrastructure around the app, not as built-in product logic.

## Choose a path

- **Server reverse proxy**: recommended for a stable public deployment with your own server and domain.
- **Cloudflare Tunnel**: useful when you want public HTTPS access without opening inbound ports.
- **Tailscale**: useful for private access across your own devices without public exposure.

Before using any of these methods, finish the local setup first with [`docs/setup.md`](docs/setup.md) and make sure MelodySync works at `http://127.0.0.1:7760`.

## Shared checks

Make sure these work before adding any external ingress:

```bash
melodysync start
curl -I http://127.0.0.1:7760/
```

If the local service is not healthy, fix that first. Do not debug the proxy until the local app is stable.

## Option 1: Server Reverse Proxy

This is the recommended production path.

Use this when:

- you have a server or VPS
- you control a domain
- you want a stable public URL
- you want TLS terminated by Nginx or Caddy

### Recommended shape

```text
Internet
  -> HTTPS reverse proxy (Caddy or Nginx)
  -> MelodySync on 127.0.0.1:7760
```

If the proxy runs on the same machine, keep MelodySync bound to `127.0.0.1`.

If the proxy runs on another machine or container network and cannot reach localhost, set:

- `CHAT_BIND_HOST=0.0.0.0`
- `SECURE_COOKIES=1`

### Caddy example

```caddyfile
melody.example.com {
  encode gzip zstd
  reverse_proxy 127.0.0.1:7760
}
```

### Nginx example

```nginx
server {
    listen 80;
    server_name melody.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name melody.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7760;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Service env when using HTTPS

For HTTPS reverse proxy access, keep `SECURE_COOKIES=1`.

Local setup currently seeds plain-HTTP local access. To switch to HTTPS cookie mode, edit the MelodySync service definition and change `SECURE_COOKIES`:

- macOS: `~/Library/LaunchAgents/com.melodysync.chat.plist`
- Linux: `~/.config/systemd/user/melodysync-chat.service`

Then restart MelodySync:

```bash
melodysync restart chat
```

### Validate

```bash
curl -I https://melody.example.com/
```

Then open:

```text
https://melody.example.com/?token=YOUR_TOKEN
```

## Option 2: Cloudflare Tunnel

Use this when:

- you want public HTTPS access
- you do not want to open inbound ports on the host
- you are okay operating Cloudflare outside MelodySync

### Basic flow

1. Install `cloudflared`.
2. Log in: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create melodysync`
4. Route a hostname to it: `cloudflared tunnel route dns melodysync melody.example.com`
5. Write `~/.cloudflared/config.yml`
6. Run the tunnel as its own service

### Example config

```yaml
tunnel: melodysync
credentials-file: /home/USER/.cloudflared/TUNNEL_ID.json

ingress:
  - hostname: melody.example.com
    service: http://127.0.0.1:7760
  - service: http_status:404
```

MelodySync does not manage this tunnel for you. Treat `cloudflared` as a separate operator service.

### Cookie mode

If users reach MelodySync through HTTPS on the public hostname, set `SECURE_COOKIES=1` in the MelodySync service config before exposing it.

### Validate

```bash
cloudflared tunnel info melodysync
curl -I https://melody.example.com/
```

Then open:

```text
https://melody.example.com/?token=YOUR_TOKEN
```

## Option 3: Tailscale

Use this when:

- access is private to your own devices or team devices
- you do not need a public website
- you want the smallest operational surface

### Basic flow

1. Install Tailscale on the host and client devices.
2. Join the same tailnet.
3. Set MelodySync to listen on a reachable interface.
4. Access the MagicDNS hostname from another device on the same tailnet.

### Service env for Tailscale

Edit the MelodySync service definition:

- `CHAT_BIND_HOST=0.0.0.0`
- `SECURE_COOKIES=0`

Files to edit:

- macOS: `~/Library/LaunchAgents/com.melodysync.chat.plist`
- Linux: `~/.config/systemd/user/melodysync-chat.service`

Then restart MelodySync:

```bash
melodysync restart chat
```

### Validate

Find the host name:

```bash
tailscale status
```

Then open:

```text
http://HOSTNAME.tailnet.ts.net:7760/?token=YOUR_TOKEN
```

On untrusted networks, combine this with a firewall and do not expose port `7760` broadly outside Tailscale.

## Operational note

Whichever path you choose:

- MelodySync owns the local app.
- Your proxy, tunnel, or VPN owns external reachability.
- Their logs, restarts, and certificates are managed separately.
