# SearXNG — бесплатный SERP (Google + Yandex) для пайплайна статей

Self-hosted метапоисковик с JSON API. Заменяет платный Yandex Cloud SearchAPI
и хрупкий Puppeteer-скрейпинг. Используется в `server/_core/serpParser.ts`
(`fetchSearxngSerp` — primary, Puppeteer/Cloud — фолбэк).

- **Yandex-слот** → движок `yandex` (чистая РФ-выдача).
- **Google-слот** → движок `duckduckgo` (Google блокирует SearXNG-скрейпинг;
  duckduckgo капча-free и уважает регион `ru-RU`).

## Деплой (сервер n, `/root/searxng`)

1. Сгенерировать секреты:
   ```sh
   openssl rand -hex 32                                   # → secret_key в searxng/settings.yml
   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'ВАШ_ПАРОЛЬ'   # → caddy/Caddyfile
   ```
2. Подставить их в `searxng/settings.yml` (secret_key) и `caddy/Caddyfile` (bcrypt-хеш).
3. Поднять:
   ```sh
   cd /root/searxng && docker compose up -d
   ```
4. Прописать в `.env` дашборда:
   ```
   SEARXNG_URL=http://serp:ВАШ_ПАРОЛЬ@167.86.116.15:8899
   ```
   (IP `167.86.116.15` уже в `NO_PROXY` — SearXNG берётся напрямую, не через SERP-прокси.)

## Проверка

```sh
curl -s -u serp:ВАШ_ПАРОЛЬ \
  "http://167.86.116.15:8899/search?q=кадастровая+карта&format=json&language=ru-RU&engines=yandex" | head -c 300
```

Защита: caddy basic-auth перед SearXNG (открытый метапоиск нельзя светить — иначе
используют как бесплатный прокси и забанят наш IP по капче).
