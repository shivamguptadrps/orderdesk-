# OrderDesk on the server

Server: Ubuntu, Docker. Shares the machine with kamkarao.com, whose Caddy (ports 80/443) forwards
`https://orderdesk.kamkarao.com` to the `orderdesk-api` container. OrderDesk has its own database.

## First install

```sh
git clone https://github.com/shivamguptadrps/orderdesk-.git ~/orderdesk
cd ~/orderdesk/deploy/server
cp .env.example .env   # fill JWT_SECRET and DB_PASSWORD with long random values
docker compose up -d --build
```

Add `Caddyfile.orderdesk` to `~/kamkarao/deploy/Caddyfile` (back it up first), check and reload:

```sh
cd ~/kamkarao
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

DNS: `A  orderdesk.kamkarao.com -> server IP`.

## Update to the latest code

```sh
cd ~/orderdesk && git pull && cd deploy/server && docker compose up -d --build api
```

Migrations run automatically when the api starts.

## Backups

Nightly at 02:30 IST (server clock is UTC), in root's crontab (`sudo crontab -e`):

```
0 21 * * * BACKUP_DIR=/home/ubuntu/orderdesk-backups /home/ubuntu/orderdesk/deploy/server/backup.sh >> /home/ubuntu/orderdesk-backups/backup.log 2>&1
```

Backups stay on the same server; copy them off now and then (a dead server takes them with it).

Restore a database dump:

```sh
docker compose exec -T db pg_restore -U orderdesk -d orderdesk --clean --if-exists < ~/orderdesk-backups/db_<date>.dump
```

## Platform admin

Distributors can be added from the app (Profile or More > Platform admin) by phones listed in
`PLATFORM_ADMIN_PHONES`, after entering `PLATFORM_ADMIN_KEY` once. Both live in `.env`; change the key by
editing `.env` and running `docker compose up -d api`. The script still works:
`docker compose exec api python -m scripts.seed_tenant --name "..." --owner-phone 98xxxxxxxx`.

## Useful

```sh
docker compose ps            # status
docker compose logs -f api   # live logs (login codes appear here in staging)
```
