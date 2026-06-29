# DNC egress proxy — DigitalOcean Singapore (runbook)

**Purpose:** give the MKTR backend ONE permanent outbound IP for PDPC DNC API calls. PDPC firewall-allowlists this IP. Only DNC calls route through the proxy (via `DNC_HTTPS_PROXY`); all other backend traffic is unaffected.

**Decision:** DigitalOcean droplet in Singapore (SGP1) running **tinyproxy** as an HTTP `CONNECT` proxy. ~USD 4/mo.

> **PROVISIONED 2026-06-29.** Droplet `dnc-egress` (SGP1, Ubuntu 24.04). **Egress IP = `159.89.201.126`** (verified — this is the IP to give PDPC). tinyproxy live on `:8888` with Basic auth + DNC-only filter (verified: `dnc.gov.sg` → 302, everything else → blocked). SSH key-only, root login disabled, admin user `mktr` (passwordless sudo), `ufw` + `fail2ban` active. Proxy credentials saved locally at `~/dnc-keys/proxy-credentials.txt`. **Still TODO:** (1) restrict port 8888 to the 3 Render egress IPs via DO Cloud Firewall (currently open to the internet but gated by Basic auth + filter); (2) optional stunnel TLS (§4) before heavy prod.

---

## Architecture

```
Render backend (mktr-backend-jo6r, shared egress)
      │  HTTPS CONNECT  (only DNC calls, via DNC_HTTPS_PROXY)
      ▼
DO droplet "dnc-egress"  (Singapore, fixed primary IPv4)  ── tinyproxy :8888
      │  TLS tunnel (end-to-end to DNC)
      ▼
https://www.dnc.gov.sg/realtime/check/registry   (prod)   |   https://uat.dnc.gov.sg/... (UAT)
```

- The proxy uses HTTP **`CONNECT`**, so TLS is negotiated **end-to-end between the backend and DNC**. The proxy only sees `CONNECT www.dnc.gov.sg:443` — **never the phone-number payload**.
- **The IP you give PDPC = the droplet's PRIMARY public IPv4.** It is static for the life of the droplet.

> ⚠️ **Gotcha — do NOT use a Reserved/Floating IP for this.** DO Reserved IPs are **inbound-only**; a droplet's *outbound* traffic egresses from its **primary** public IP by default, not the Reserved IP (that needs SNAT gymnastics). Since we care about *egress*, submit the droplet's **primary** IPv4 to PDPC and skip the Reserved IP. (Reserved-IP-as-egress via SNAT is an optional DR enhancement — see §8.)

---

## 0. Prerequisites

- A DigitalOcean account; optionally `doctl` (`brew install doctl && doctl auth init`).
- An SSH keypair (`~/.ssh/id_ed25519.pub`).
- The **3 Render outbound IPs** for `mktr-backend-jo6r` — dashboard → the service → **Connect** (or Settings) → **Outbound IP Addresses**. Needed for the firewall allowlist.

---

## 1. Provision the droplet

Dashboard: **Create → Droplet**
- **Region:** Singapore (SGP1)
- **Image:** Ubuntu 24.04 LTS
- **Type:** Basic → Regular → **$4–6/mo** (512 MB–1 GB; tinyproxy is tiny)
- **Auth:** SSH key (no password)
- **Hostname:** `dnc-egress`

Or via `doctl`:
```bash
doctl compute droplet create dnc-egress \
  --region sgp1 --image ubuntu-24-04-x64 --size s-1vcpu-512mb-10gb \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | head -1)" \
  --wait
doctl compute droplet get dnc-egress --format PublicIPv4 --no-header
```

**Record the PRIMARY public IPv4** that prints — this is the IP you submit to PDPC.

---

## 2. Lock down the box

SSH in (`ssh root@<droplet-ip>`), then:

```bash
# Non-root sudo user
adduser --disabled-password --gecos "" mktr
usermod -aG sudo mktr
echo 'mktr ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/mktr && chmod 440 /etc/sudoers.d/mktr
install -d -m 700 -o mktr -g mktr /home/mktr/.ssh
cp /root/.ssh/authorized_keys /home/mktr/.ssh/ && chown mktr:mktr /home/mktr/.ssh/authorized_keys && chmod 600 /home/mktr/.ssh/authorized_keys

# SSH: keys only, no root login
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Auto security patches
apt update && apt -y install unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# Host firewall (ufw) — SSH + proxy port only
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp
ufw allow 8888/tcp
ufw --force enable
```

**DigitalOcean Cloud Firewall** (dashboard → Networking → Firewalls, or `doctl`): attach to `dnc-egress`.
- **Inbound:**
  - SSH `22` — from your admin IP only (tighten later).
  - Proxy `8888` — from the **3 Render egress IPs only**.
- **Outbound:** `443` to all (or restrict to DNC — see §3 filter).

> ⚠️ Render egress IPs are **shared across Render tenants**, so an IP allowlist alone is not enough — anyone else on those IPs could reach port 8888. That's why **Basic auth + a destination filter** (next step) are mandatory, not optional.

---

## 3. Install + configure tinyproxy

```bash
apt -y install tinyproxy
```

Edit `/etc/tinyproxy/tinyproxy.conf` — set/replace these directives:

```conf
User tinyproxy
Group tinyproxy
Port 8888
Timeout 600
Listen 0.0.0.0
# Identity (defence-in-depth alongside the cloud firewall)
BasicAuth dncproxy CHANGE_ME_TO_A_LONG_RANDOM_SECRET
# Only allow CONNECT to 443 (drop the default 563/8443 lines)
ConnectPort 443
# Whitelist destinations — DNC only, even if creds leak (no open relay)
FilterDefaultDeny Yes
FilterExtended Yes
Filter "/etc/tinyproxy/dnc-allow.filter"
# Hygiene
DisableViaHeader Yes
# Optional: also IP-restrict at the app layer (mirror the 3 Render egress IPs)
# Allow 1.2.3.4
# Allow 5.6.7.8
# Allow 9.10.11.12
```

Destination whitelist `/etc/tinyproxy/dnc-allow.filter`:
```
dnc\.gov\.sg$
```
(Matches `www.dnc.gov.sg` and `uat.dnc.gov.sg`; blocks everything else.)

```bash
# Generate a strong proxy password and drop it into the config
PROXY_PASS="$(openssl rand -base64 24)"
sed -i "s|CHANGE_ME_TO_A_LONG_RANDOM_SECRET|${PROXY_PASS}|" /etc/tinyproxy/tinyproxy.conf
echo "Proxy password (store in your secret manager): ${PROXY_PASS}"

systemctl restart tinyproxy && systemctl enable tinyproxy
```

---

## 4. (Recommended) Encrypt the proxy hop — stunnel TLS

`CONNECT` already encrypts the DNC payload end-to-end. TLS to the proxy additionally protects the **Basic-auth credentials** and the destination metadata on the Render→DO hop. For a government-PII integration, do this before heavy production use.

**Option A — real subdomain + Let's Encrypt (no client-side CA needed).**
1. Point `dnc-egress.mktr.sg` (A record) at the droplet IP.
2. `apt -y install stunnel4 certbot && certbot certonly --standalone -d dnc-egress.mktr.sg` (temporarily open 80).
3. `/etc/stunnel/dnc.conf`:
   ```conf
   [dnc-proxy]
   accept = 0.0.0.0:8443
   connect = 127.0.0.1:8888
   cert = /etc/letsencrypt/live/dnc-egress.mktr.sg/fullchain.pem
   key  = /etc/letsencrypt/live/dnc-egress.mktr.sg/privkey.pem
   ```
4. `systemctl enable --now stunnel4`; open `8443` (firewall) and **close `8888`** to the internet (bind tinyproxy `Listen 127.0.0.1`). Backend then uses `https://…@dnc-egress.mktr.sg:8443`.

**Option B — self-signed cert pinned in the backend.** Generate a cert on the droplet, point stunnel at it, and pin it in the backend via undici `proxyTls.ca` (see §5). Avoids needing a public DNS record.

For a v1 / UAT you may run plain `:8888` (firewall + auth + filter) and add TLS before prod.

---

## 5. Wire into the backend

**Env var on `mktr-backend-jo6r`** (Render → Environment):
```
# plain (v1 / UAT):
DNC_HTTPS_PROXY=http://dncproxy:<PROXY_PASS>@<droplet-ip>:8888
# with stunnel TLS (prod):
DNC_HTTPS_PROXY=https://dncproxy:<PROXY_PASS>@dnc-egress.mktr.sg:8443
```

**In `dncService.js`** — route only the DNC fetch through the proxy with undici's `ProxyAgent` (Node 18+ `fetch` does **not** honour `*_PROXY` env vars automatically):
```js
import { ProxyAgent } from 'undici';

function dncDispatcher() {
  const uri = process.env.DNC_HTTPS_PROXY;
  if (!uri) return undefined; // no proxy → direct (UAT-on-allowlisted-IP / tests)
  const u = new URL(uri);
  const token =
    u.username ? 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64') : undefined;
  return new ProxyAgent({
    uri: `${u.protocol}//${u.host}`,
    ...(token ? { token } : {}),
    // Option B (self-signed proxy cert) only:
    // proxyTls: { ca: process.env.DNC_PROXY_CA },
  });
}

const res = await fetch(`${baseUrl}/check/registry`, {
  method: 'POST',
  headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  dispatcher: dncDispatcher(),
  signal: AbortSignal.timeout(5000),
});
```

---

## 6. Verify the egress IP (do this BEFORE submitting to PDPC)

```bash
# On the droplet — its own egress IP:
curl -s https://ifconfig.me ; echo

# Through the proxy (from your laptop, temporarily allowed in the firewall):
curl -s -x "http://dncproxy:<PROXY_PASS>@<droplet-ip>:8888" https://ifconfig.me ; echo
#   → MUST print the droplet's PRIMARY IPv4 (that's the IP PDPC will see).

# Filter works — DNC allowed, everything else blocked:
curl -s -o /dev/null -w '%{http_code}\n' -x "http://dncproxy:<PROXY_PASS>@<droplet-ip>:8888" https://uat.dnc.gov.sg   # connects
curl -s -x "http://dncproxy:<PROXY_PASS>@<droplet-ip>:8888" https://example.com                                       # blocked/filtered
```

The IP printed by the proxy test is the value to submit to PDPC.

---

## 7. Submit to PDPC

Give PDPC, for **both UAT and Production** onboarding:
- **Public IP:** the droplet's primary IPv4 (same proxy serves UAT + prod — only the DNC base URL differs, not the egress IP).
- **Hostname:** `dnc-egress.mktr.sg` (if you set the DNS record) or the droplet's reverse-DNS.
- The **X.509 cert** `~/dnc-keys/mycert.cer` (self-signed, already generated).

---

## 8. Operations & failure mode

- **Fail-safe:** if the droplet/proxy is down, DNC checks error → leads go `pending`/held, **never delivered un-scrubbed**. Surfaced via `dnc.check.error` logs + Sentry. So an outage degrades safely.
- **Monitoring:** DO droplet "down" alert + backend Sentry alert on DNC errors.
- **Patching:** `unattended-upgrades` handles security patches; reboot occasionally (`needrestart`).
- **Cost:** ~USD 4–6/mo droplet. No Reserved IP needed.
- **Disaster recovery:** rebuilding the droplet yields a **new** primary IP → re-submit to PDPC (a paperwork hop). To make the IP portable across rebuilds, attach a **Reserved IP and route egress through it via SNAT** (`iptables -t nat -A POSTROUTING -o eth0 -j SNAT --to <reserved-ip>` + DO's anchor-IP setup) — advanced; only worth it once you're tired of re-submitting. Snapshot the droplet weekly regardless.

---

## Checklist

- [ ] Droplet in SGP1, primary IPv4 recorded
- [ ] Non-root user, SSH keys only, root/password login disabled
- [ ] `unattended-upgrades` + `fail2ban` + `ufw`
- [ ] DO Cloud Firewall: SSH from admin IP, 8888/8443 from Render egress IPs only
- [ ] tinyproxy: `BasicAuth`, `ConnectPort 443` only, `FilterDefaultDeny Yes` → DNC-only
- [ ] (prod) stunnel TLS, port 8888 closed to the internet
- [ ] `DNC_HTTPS_PROXY` set on `mktr-backend-jo6r`; `ProxyAgent` wired in `dncService`
- [ ] Verified the proxy egress IP == droplet primary IPv4
- [ ] Submitted IP + hostname + `mycert.cer` to PDPC (UAT + prod)
