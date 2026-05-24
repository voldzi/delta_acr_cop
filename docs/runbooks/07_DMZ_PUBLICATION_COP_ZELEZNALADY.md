# 07 DMZ Publication for cop.zeleznalady.cz

Tento runbook publikuje pilotni COP aplikaci bez otevreni API jako samostatne verejne sluzby. Verejna domena `cop.zeleznalady.cz` bezi na `dmz.home.cz`, nginx tam reverzne proxyuje:

- web UI na `http://docker.home.cz:4311`,
- COP API na `http://docker.home.cz:4310` pod stejnou domenou pres `/api/`, `/health/` a volitelne `/metrics`.

Frontend musi byt buildnuty se same-origin API base URL, tedy s prazdnou hodnotou `COP_PUBLIC_API_BASE_URL=`.

## Predpoklady

- DNS `cop.zeleznalady.cz` smeruje na verejnou IP serveru `dmz.home.cz`.
- Z internetu jsou na `dmz.home.cz` dostupne porty `80` a pozdeji `443`.
- `dmz.home.cz` vidi interni host `docker.home.cz` a porty `4310`, `4311`.
- Na `docker.home.cz` bezi aktualni repozitar v `/srv/cop`.

Kontrola z `dmz.home.cz`:

```bash
curl -fsS http://docker.home.cz:4310/health/ready
curl -I http://docker.home.cz:4311
```

## 1. Priprav docker.home.cz pro verejnou domenu

Na `docker.home.cz` nastav frontend tak, aby API volal relativne pres stejnou domenu. Priklad:

```bash
cd /srv/cop
git pull --ff-only
cp .env .env.bak.$(date +%Y%m%d-%H%M%S)
nano .env
```

Doporucene hodnoty:

```bash
COP_API_PORT=4310
COP_WEB_PORT=4311
COP_PUBLIC_API_BASE_URL=
COP_DEPLOY_DOMAIN=cop.zeleznalady.cz
COP_WEB_ALLOWED_HOSTS=docker.home.cz,cop.zeleznalady.cz
COP_WEB_REFRESH_MS=5000
```

`COP_PUBLIC_API_BASE_URL=` musi zustat prazdne, aby frontend volal `/api/...` pres verejnou domenu. `COP_DEPLOY_DOMAIN` a `COP_WEB_ALLOWED_HOSTS` se predavaji do Vite preview serveru a povoluji verejny host i lokalni pilot `docker.home.cz`.

Pro internetovy pilot zmen vychozi lab token. Hodnota `COP_PUBLIC_LAB_VALUE` je soucasti frontendu, proto to neni produkcni autentizace, pouze pilotni ochrana API endpointu:

```bash
COP_LAB_TOKEN=<nahodne-dlouhe-tajne-heslo>
COP_PUBLIC_LAB_VALUE=<stejna-hodnota-jako-COP_LAB_TOKEN>
```

Rebuild a kontrola:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:4310/health/ready
curl -I http://localhost:4311
```

Pokud uzivatel neni ve skupine `docker`, pridej pred docker prikazy `sudo`.

## 2. HTTP publikace bez HTTPS

Na `dmz.home.cz` nainstaluj nginx, pokud tam jeste neni:

```bash
sudo apt update
sudo apt install -y nginx
sudo mkdir -p /var/www/html/.well-known/acme-challenge
```

Vytvor `/etc/nginx/sites-available/cop.zeleznalady.cz`:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name cop.zeleznalady.cz;

    # User reports may contain photos, PDFs and videos. Keep this aligned with
    # COP_MEDIA_MAX_ATTACHMENT_BYTES / COP_API_BODY_LIMIT_BYTES on docker.home.cz.
    client_max_body_size 600m;
    send_timeout 120s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location /api/ {
        proxy_pass http://docker.home.cz:4310/api/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_request_buffering off;
        proxy_buffering off;
    }

    location /health/ {
        proxy_pass http://docker.home.cz:4310/health/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }

    location = /metrics {
        proxy_pass http://docker.home.cz:4310/metrics;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }

    location / {
        proxy_pass http://docker.home.cz:4311;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }
}
```

Aktivace:

```bash
sudo ln -sfn /etc/nginx/sites-available/cop.zeleznalady.cz /etc/nginx/sites-enabled/cop.zeleznalady.cz
sudo nginx -t
sudo systemctl reload nginx
```

Kontrola:

```bash
curl -I http://cop.zeleznalady.cz
curl -fsS http://cop.zeleznalady.cz/health/ready
curl -fsS http://cop.zeleznalady.cz/metrics | grep cop_stream_clients_total
```

V teto fazi musi fungovat `http://cop.zeleznalady.cz` bez redirectu na HTTPS.

Pokud `curl -I http://cop.zeleznalady.cz` vraci `301` na HTTPS uz v teto fazi, nginx stale pouziva jinou nebo starou konfiguraci. Najdi aktivni redirect:

```bash
sudo nginx -T | grep -nE 'server_name cop\.zeleznalady\.cz|return 301 https|ssl_certificate'
```

Pak uprav prislusny soubor v `/etc/nginx/sites-enabled/` nebo `/etc/nginx/sites-available/`, reloadni nginx a kontrolu zopakuj.

## 3. Let's Encrypt certifikat

Na `dmz.home.cz`:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly \
  --webroot \
  --webroot-path /var/www/html \
  --domain cop.zeleznalady.cz \
  --email admin@zeleznalady.cz \
  --agree-tos \
  --no-eff-email
```

Kontrola souboru:

```bash
sudo ls -l /etc/letsencrypt/live/cop.zeleznalady.cz/fullchain.pem
sudo ls -l /etc/letsencrypt/live/cop.zeleznalady.cz/privkey.pem
```

Test obnovy:

```bash
sudo certbot renew --dry-run
```

## 4. HTTPS konfigurace

Po vydani certifikatu nahrad `/etc/nginx/sites-available/cop.zeleznalady.cz` touto konfiguraci:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name cop.zeleznalady.cz;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name cop.zeleznalady.cz;

    ssl_certificate     /etc/letsencrypt/live/cop.zeleznalady.cz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cop.zeleznalady.cz/privkey.pem;

    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # User reports may contain photos, PDFs and videos. Keep this aligned with
    # COP_MEDIA_MAX_ATTACHMENT_BYTES / COP_API_BODY_LIMIT_BYTES on docker.home.cz.
    client_max_body_size 600m;
    send_timeout 120s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location /api/ {
        proxy_pass http://docker.home.cz:4310/api/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_request_buffering off;
        proxy_buffering off;
    }

    location /health/ {
        proxy_pass http://docker.home.cz:4310/health/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }

    location = /metrics {
        proxy_pass http://docker.home.cz:4310/metrics;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }

    location / {
        proxy_pass http://docker.home.cz:4311;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }
}
```

Aktivace:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Kontrola:

```bash
curl -I http://cop.zeleznalady.cz
curl -I https://cop.zeleznalady.cz
curl -fsS https://cop.zeleznalady.cz/health/ready
curl -fsS https://cop.zeleznalady.cz/metrics | grep cop_stream_clients_total
dd if=/dev/zero bs=1M count=30 2>/dev/null | \
  curl -sS -o /tmp/cop_upload_limit_probe.txt -w "%{http_code}\n" \
    -X POST -H 'Content-Type: application/octet-stream' \
    --data-binary @- https://cop.zeleznalady.cz/api/v1/upload-limit-probe
```

Upload limit probe nesmi vratit `413` z nginxu. Ocekavane je `401`, `404`
nebo jina aplikacni odpoved z COP API, protoze test posila data na kontrolni
neexistujici nebo neautorizovanou cestu.

V prohlizeci otevri:

```text
https://cop.zeleznalady.cz?history=1&prediction=1&refresh=1&historySeconds=60
```

## Rollback

Na `dmz.home.cz` lze vratit HTTP-only konfiguraci z casti 2 a reloadnout nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Na `docker.home.cz` lze vratit predchozi `.env`:

```bash
cd /srv/cop
cp .env.bak.YYYYMMDD-HHMMSS .env
docker compose up -d --build
```
