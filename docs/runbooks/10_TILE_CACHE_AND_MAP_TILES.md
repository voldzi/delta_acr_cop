# 10 Tile Cache and Map Tiles

Tento runbook popisuje postup, jak v produkci snížit externí dotazy na mapový podklad a připravit COP na vlastní mapové dlaždice nad OSM/PostGIS.

## Cíl

- web i budoucí nativní aplikace používají konfigurovatelný mapový endpoint,
- produkční klienti nevolají veřejný `tile.openstreetmap.org` přímo,
- krátkodobě lze použít vlastní HTTP cache na `tiles.zeleznalady.cz`,
- cílově běží vlastní tile server nad OSM daty v PostGIS, PMTiles nebo MBTiles,
- URL v klientovi zůstává stabilní i při výměně backendu dlaždic.

PostGIS není vhodné úložiště pro PNG dlaždice. Je vhodný jako zdroj geometrií pro generování vektorových nebo rasterizovaných dlaždic. Cache samotných dlaždic má být HTTP/file cache: nginx proxy cache, CDN, tile server cache, PMTiles/MBTiles soubor nebo objektové úložiště.

## Stav v COP

Stav ověřený 10. 8. 2026:

- `https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png` je společný stabilní
  veřejný endpoint, ale stále jde o cache před veřejným rasterovým OSM;
- nejde zatím o vlastní aktuální OSM vector dataset;
- COP používá neutrální `@zeleznalady/geo-client` pro validaci konfigurace,
  raster fallback a povinnou atribuci;
- další produkty mají používat stejný host a nesmějí vytvářet vlastní tile
  proxy pouze pro svou aplikaci.

COP podporuje tyto proměnné:

```env
COP_MAP_STYLE_URL=
COP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
COP_TILE_GLYPHS_URL=https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf
COP_TILE_ATTRIBUTION="&copy; OpenStreetMap contributors"
```

Mapové popisky v COP používají font stack `Noto Sans Regular` a `Noto Sans Bold`, protože tyto glyph sady jsou dostupné na výchozím MapLibre demo endpointu i přes připravenou `/fonts/` cache. `Open Sans Regular` není vhodný kontrolní request pro tuto konfiguraci.

Produkční cílové hodnoty po zřízení `tiles.zeleznalady.cz`:

```env
COP_MAP_STYLE_URL=
COP_TILE_URL=https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png
COP_TILE_GLYPHS_URL=https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf
COP_TILE_ATTRIBUTION="&copy; OpenStreetMap contributors"
```

Pro budoucí vector-tile režim:

```env
COP_MAP_STYLE_URL=https://tiles.zeleznalady.cz/styles/civil/style.json
COP_TILE_URL=
COP_TILE_GLYPHS_URL=https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf
```

Cílový style JSON, fonty, sprites a atribuce musí být vydávány jako jedna
verzovaná sada (například `/styles/civil/v1/style.json`). Změna tile backendu
nesmí měnit veřejný host. Klienti mají mít řízený raster fallback pro případ,
že vector style není dostupný.

Pokud je `COP_MAP_STYLE_URL` vyplněné, web použije přímo MapLibre style URL. Pokud je prázdné, vytvoří raster style z `COP_TILE_URL`.

## Fáze 1: Dočasná nginx cache

Toto je přechodný krok. Veřejná OSM tile služba vyžaduje správnou atribuci, identifikaci, referer a cachování podle HTTP hlaviček; vlastní proxy před `tile.openstreetmap.org` není doporučený cílový stav. Pro tisíce uživatelů má následovat vlastní tile server nebo placený/hostovaný poskytovatel s odpovídající licencí.

Referenční policy: <https://operations.osmfoundation.org/policies/tiles/>.

Na `dmz.home.cz` připrav cache adresář a cache zónu:

```bash
sudo mkdir -p /var/cache/nginx/cop_tiles
sudo chown -R www-data:www-data /var/cache/nginx/cop_tiles

sudo tee /etc/nginx/conf.d/cop_tile_cache.conf >/dev/null <<'EOF'
proxy_cache_path /var/cache/nginx/cop_tiles
  levels=1:2
  keys_zone=cop_tiles:256m
  max_size=50g
  inactive=30d
  use_temp_path=off;
EOF

sudo nginx -t
sudo systemctl reload nginx
```

Nejprve HTTP vhost pro ověření a ACME challenge:

```bash
sudo tee /etc/nginx/sites-available/tiles.zeleznalady.cz >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name tiles.zeleznalady.cz;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location /osm/ {
        proxy_pass https://tile.openstreetmap.org/;
        proxy_http_version 1.1;
        proxy_set_header Host tile.openstreetmap.org;
        proxy_ssl_server_name on;
        proxy_ssl_name tile.openstreetmap.org;
        proxy_set_header Referer $http_referer;
        proxy_set_header User-Agent "CivilniSituacniMapaTileCache/0.1 (+https://cop.zeleznalady.cz)";
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_cache cop_tiles;
        proxy_cache_revalidate on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_valid 200 301 302 7d;
        proxy_cache_lock on;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header Access-Control-Allow-Origin "*" always;
    }

    location /fonts/ {
        proxy_pass https://demotiles.maplibre.org/font/;
        proxy_http_version 1.1;
        proxy_set_header Host demotiles.maplibre.org;
        proxy_ssl_server_name on;
        proxy_ssl_name demotiles.maplibre.org;
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_cache cop_tiles;
        proxy_cache_revalidate on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_valid 200 301 302 30d;
        proxy_cache_lock on;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header Access-Control-Allow-Origin "*" always;
    }
}
EOF

sudo ln -sfn /etc/nginx/sites-available/tiles.zeleznalady.cz /etc/nginx/sites-enabled/tiles.zeleznalady.cz
sudo nginx -t
sudo systemctl reload nginx
```

Ověření HTTP:

```bash
curl -I http://tiles.zeleznalady.cz/osm/8/138/88.png
curl -I http://tiles.zeleznalady.cz/fonts/Noto%20Sans%20Regular/0-255.pbf
curl -I http://tiles.zeleznalady.cz/fonts/Noto%20Sans%20Bold/0-255.pbf
```

## Fáze 2: Let's Encrypt a HTTPS

```bash
sudo certbot certonly --webroot -w /var/www/html -d tiles.zeleznalady.cz
```

Po vystavení certifikátu přepiš vhost:

```bash
sudo tee /etc/nginx/sites-available/tiles.zeleznalady.cz >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name tiles.zeleznalady.cz;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tiles.zeleznalady.cz;

    ssl_certificate     /etc/letsencrypt/live/tiles.zeleznalady.cz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tiles.zeleznalady.cz/privkey.pem;

    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    access_log /var/log/nginx/tiles.zeleznalady.cz.access.log;
    error_log  /var/log/nginx/tiles.zeleznalady.cz.error.log;

    location /osm/ {
        proxy_pass https://tile.openstreetmap.org/;
        proxy_http_version 1.1;
        proxy_set_header Host tile.openstreetmap.org;
        proxy_ssl_server_name on;
        proxy_ssl_name tile.openstreetmap.org;
        proxy_set_header Referer $http_referer;
        proxy_set_header User-Agent "CivilniSituacniMapaTileCache/0.1 (+https://cop.zeleznalady.cz)";
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_cache cop_tiles;
        proxy_cache_revalidate on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_valid 200 301 302 7d;
        proxy_cache_lock on;
        expires 7d;
        add_header Cache-Control "public, max-age=604800" always;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header Access-Control-Allow-Origin "*" always;
    }

    location /fonts/ {
        proxy_pass https://demotiles.maplibre.org/font/;
        proxy_http_version 1.1;
        proxy_set_header Host demotiles.maplibre.org;
        proxy_ssl_server_name on;
        proxy_ssl_name demotiles.maplibre.org;
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_cache cop_tiles;
        proxy_cache_revalidate on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_valid 200 301 302 30d;
        proxy_cache_lock on;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000" always;
        add_header X-Cache-Status $upstream_cache_status always;
        add_header Access-Control-Allow-Origin "*" always;
    }
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

Ověření HTTPS a cache hit:

```bash
curl -I https://tiles.zeleznalady.cz/osm/8/138/88.png
curl -I https://tiles.zeleznalady.cz/osm/8/138/88.png
curl -I https://tiles.zeleznalady.cz/fonts/Noto%20Sans%20Regular/0-255.pbf
curl -I https://tiles.zeleznalady.cz/fonts/Noto%20Sans%20Bold/0-255.pbf
```

Druhé volání stejné dlaždice má ideálně vrátit `X-Cache-Status: HIT`.

## Fáze 3: Přepnutí COP produkce

Přepínej až po ověření HTTPS tile endpointu:

```bash
cd /srv/cop
cp -a .env ".env.bak.$(date +%Y%m%d-%H%M%S)"

tmp="$(mktemp)"
grep -vE '^(COP_MAP_STYLE_URL|COP_TILE_URL|COP_TILE_GLYPHS_URL|COP_TILE_ATTRIBUTION)=' .env > "$tmp"
cat "$tmp" > .env
rm "$tmp"

cat >> .env <<'EOF'
COP_MAP_STYLE_URL=
COP_TILE_URL=https://tiles.zeleznalady.cz/osm/{z}/{x}/{y}.png
COP_TILE_GLYPHS_URL=https://tiles.zeleznalady.cz/fonts/{fontstack}/{range}.pbf
COP_TILE_ATTRIBUTION="&copy; OpenStreetMap contributors"
EOF

docker compose up -d --build
```

Ověření:

```bash
curl -fsS http://127.0.0.1:4310/health/ready
curl -I https://cop.zeleznalady.cz
curl -I https://tiles.zeleznalady.cz/osm/8/138/88.png
```

## Fáze 4: Vlastní tile server

Cílové řešení pro tisíce uživatelů:

1. Pravidelný import OSM dat do PostGIS nebo PMTiles/MBTiles.
2. Tile server:
   - Martin/Tegola pro vector tiles z PostGIS,
   - TileServer GL pro style + rasterizaci/vector tiles,
   - PMTiles pro statické vektorové dlaždice s HTTP range requesty.
3. `tiles.zeleznalady.cz` proxyuje interní tile server, ne veřejné OSM.
4. COP nastaví `COP_MAP_STYLE_URL=https://tiles.zeleznalady.cz/styles/civil/style.json`.
5. Nginx/CDN cache drží tiles a style assets; PostGIS řeší dotazování geometrií, ne opakované požadavky každého klienta.

## Provozní pravidla

- Neklikat ani nepřidávat funkci pro hromadné stažení map z veřejného OSM.
- Neprefetchovat velké oblasti a zoomy z veřejného OSM.
- Atribuce OpenStreetMap musí zůstat viditelná.
- U veřejného OSM respektovat cache hlavičky a používat jasný `User-Agent`.
- Pro offline mapy používat pouze vlastní nebo licencovaný tile dataset.
