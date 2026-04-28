# aipanel

Локальная панель для просмотра Claude sessions, наблюдений из claude-mem и kanban-задач из beads.

![aipanel project sessions view](public/aipanel-screenshot.png)

![aipanel Claude Office view](public/aipanel-office-screenshot.png)

![aipanel Tasks view](public/aipanel-tasks-screenshot.png)

## Требования

- Node.js 20+
- pnpm
- установлен `bd` ([beads CLI](https://github.com/gastownhall/beads))
- локальная база [claude-mem](https://github.com/thedotmack/claude-mem) по пути `~/.claude-mem/claude-mem.db`
- хотя бы один проект с историей Claude Code (`~/.claude/projects/...`)

## Проекты

aipanel автоматически находит проекты из истории Claude Code (`~/.claude/projects/...`), поэтому `projects.json` создавать не обязательно.

Создайте `projects.json`, только если хотите явно настроить список проектов: задать имена, отключить лишние проекты или указать конкретные пути.

```bash
cp projects.example.json projects.json
```

Пример `projects.json`:

```json
{
  "projects": [
    {
      "path": "/absolute/path/to/project",
      "name": "project-name",
      "enabled": true
    }
  ]
}
```

`path` может быть абсолютным или в формате `~/...`.

## Подключение claude-mem

aipanel читает SQLite-файл `~/.claude-mem/claude-mem.db` в read-only режиме.

Проверьте, что файл существует:

```bash
ls ~/.claude-mem/claude-mem.db
```

Если файла нет, сначала инициализируйте claude-mem в вашей среде.

## Подключение beads

aipanel читает beads через CLI-команду `bd list --all --format json` в директории каждого проекта из `projects.json`.

Для каждого проекта:

1. Убедитесь, что `bd` доступен:

```bash
bd --version
```

2. Убедитесь, что в проекте есть `.beads/` (если нет, выполните `bd init` в директории проекта).

3. Проверьте, что beads возвращает JSON:

```bash
cd /absolute/path/to/project
bd list --all --format json
```

## Локальный запуск

Установите зависимости:

```bash
pnpm install
```

Создайте локальный env-файл:

```bash
cp .env.example .env.local
```

Запустите dev-сервер:

```bash
make dev
```

Откройте URL из терминала (например, `http://localhost:3000`).

## E2E-проверки (Playwright)

Фаза/итерация разработки:

```bash
pnpm e2e:smoke
```

Полный прогон E2E:

```bash
pnpm e2e
```

Запуск с UI/headed:

```bash
pnpm e2e:headed
pnpm e2e:ui
```

Если не установлены браузерные бинарники Playwright:

```bash
pnpm exec playwright install chromium
```

E2E запускаются на `http://127.0.0.1:3107` и используют изолированный конфиг `AIPANEL_CONFIG_DIR=.tmp/e2e/aipanel`.
Эти smoke-тесты не отправляют реальные Telegram-сообщения.

## LAN-запуск (опционально)

Разовый запуск с переменной окружения:

```bash
AIPANEL_ALLOWED_DEV_ORIGINS=localhost,100.89.42.77 make dev
```

Постоянно через `.env.local`:

```bash
AIPANEL_ALLOWED_DEV_ORIGINS=localhost,100.89.42.77
```

## Guard для write API (security)

Mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) for notification/settings flows are protected by local write guard:
- same-origin / loopback (`localhost`, `127.0.0.1`, `::1`) requests are allowed;
- unknown cross-origin requests are rejected;
- `Sec-Fetch-Site: cross-site` is rejected;
- JSON write routes require `Content-Type: application/json`.

Optional stricter protection:

```bash
AIPANEL_WRITE_TOKEN=your-local-secret
```

When set, write requests must include:

```bash
x-aipanel-write-token: your-local-secret
```

Do not use `NEXT_PUBLIC_AIPANEL_WRITE_TOKEN`.

curl example:

```bash
curl -X PUT "http://localhost:3000/api/notification-settings" \
  -H "content-type: application/json" \
  -H "origin: http://localhost:3000" \
  -H "x-aipanel-write-token: $AIPANEL_WRITE_TOKEN" \
  -d '{"enabled":true,"channels":{"browser":true,"telegram":false,"macos":false},"defaults":{"contextTokensThreshold":1000000,"contextPercentageThreshold":80},"rules":[]}'
```

## Browser desktop alerts (во вкладке)

Realtime-обновления и browser desktop alerts включены по умолчанию. В интерфейсе нажмите `Enable desktop alerts` и подтвердите permission в браузере.

Чтобы явно выключить realtime или desktop alerts:

```bash
NEXT_PUBLIC_AIPANEL_REALTIME_ENABLED=false
NEXT_PUBLIC_AIPANEL_BROWSER_NOTIFICATIONS_ENABLED=false
```

Ограничения:
- Browser desktop alerts work while this aipanel tab is open.
- при активной видимой вкладке OS-уведомления не показываются;
- включён dedupe и rate-limit, чтобы не спамить повторяющимися событиями.
- For always-on delivery, use Telegram daemon (see below).

## Telegram + macOS notifier daemon (always-on)

Для always-on доставки без открытой вкладки aipanel запустите локальный daemon:

```bash
pnpm notify
```

Разовый безопасный запуск (без historical spam по умолчанию):

```bash
pnpm notify:once
```

Daemon отправляет внешние уведомления только для human-intervention событий:
- Claude asks a question
- Task ready for review

Не отправляются permission/tool/Bash и context-threshold alert уведомления.

macOS native notification (optional):
- включается в глобальных Notification settings (`macOS native notification`);
- работает только на macOS;
- текущая реализация daemon-based (`osascript`), не packaged app и не service-worker push;
- на non-macOS канал safely skip без падения.

Поведение:
- daemon использует общий human-intervention dispatcher path;
- dedupe обеспечивается общим delivery log, отдельно по channel (`telegram` и `macos`);
- первый scan устанавливает baseline и не отправляет исторические события;
- уведомления во время офлайна daemon по умолчанию не досылаются.

Секреты Telegram хранятся в:
- `~/.aipanel/notification-secrets.json`

Delivery log хранится в:
- `~/.aipanel/notification-delivery-log.sqlite`

Future: packaged app/Tauri shell сможет добавить richer permissions, click/deeplink behavior.

Если `concurrently` не установлен, запускайте в двух терминалах:
1. `pnpm dev`
2. `pnpm notify`

## Если данные не появились

- Daemon не запущен: стартуйте `pnpm notify`.
- Нет Telegram-доставки: проверьте global Notification settings и Telegram credentials.
- Проверка without-send: используйте `pnpm notify:once --dry-run`.
- Нет beads-задач: проверьте `bd --version`, наличие `.beads/` и вывод `bd list --all --format json`.
- Нет observations из claude-mem: проверьте наличие `~/.claude-mem/claude-mem.db`.
- Проект не виден в sidebar: проверьте `projects.json` и поле `"enabled": true`.

