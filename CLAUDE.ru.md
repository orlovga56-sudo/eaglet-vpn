# CLAUDE.ru.md

[English version](CLAUDE.md) · [Русская версия](CLAUDE.ru.md)

Руководство для ИИ-агентов и людей, работающих в репозитории **Eaglet**.

## Что это за проект

Eaglet — настольный **VPN-клиент** для Windows/macOS/Linux, построенный на
**Electron + React + TypeScript + Vite**. Его две определяющие особенности:

1. **Три настоящих туннельных ядра** — sing-box, Xray-core и Mihomo — выбираемые
   на уровне профиля, глобально или автоматически, каждое со своим нативным
   адаптером конфигурации.
2. **Шесть переключаемых визуальных тем** — *Electric Cyber, Glassmorphism,
   Minimal Dark, HUD/Scifi, Neon Purple, Nature Aurora*. Каждый экран, анимация и
   акцентный цвет управляются CSS-переменными, поэтому тема — это просто набор
   токенов, без кода компонентов под конкретную тему.

Туннель настоящий: Eaglet генерирует нативную конфигурацию, проверяет её выбранным
ядром, запускает его, проверяет адрес выхода через локальный входящий порт,
применяет системную маршрутизацию и защиту и восстанавливает всё при отключении
или сбое.

## Технологический стек

| Слой         | Выбор                                          | Почему                                          |
| ------------ | ---------------------------------------------- | ----------------------------------------------- |
| Оболочка     | Electron (окно без рамки)                      | Нужен контроль над оформлением до пикселя       |
| UI           | React 19 + TypeScript                          | Компонентная модель для шести тем               |
| Сборка       | electron-vite (Vite 8)                         | HMR в dev, единый `build` для main/preload/UI   |
| Стили        | Написанный вручную CSS с переменными           | Максимум соответствия концепту, ноль зависимостей |
| Туннели      | sing-box, Xray-core, Mihomo (дочерние процессы)| Все мейнстрим-протоколы, без нативных привязок  |
| Карта        | Предрендеренный путь Natural Earth (`npm run map`) | Офлайн, без рантайм-зависимостей для карт   |
| Упаковка     | electron-builder                               | `npm run dist` собирает установщики             |

Ни CSS-фреймворка, ни библиотеки компонентов, ни пакета иконок — иконки это
встроенный SVG в `src/renderer/src/components/Icons.tsx`.

## Команды

```bash
npm install
npm run core       # download sing-box into resources/bin
npm run dev        # HMR dev session (Electron + Vite)
npm run build      # bundle main, preload and renderer into out/
npm start          # preview the production bundle
npm run typecheck  # tsc for node + web projects
npm run map        # regenerate the dotted world map from world-atlas data
npm run shots      # render offscreen and capture screenshots/*.png
npm run dist       # electron-builder installers
```

> На этой машине `npm`, `git` и `gh` не в `PATH` для оболочки; используйте полные
> пути (например, `& 'C:\Program Files\nodejs\npm.cmd'`) или добавьте их в начало.
> GUI-пакеты Electron нужно запускать через `Start-Process -Wait`, иначе команда
> вернётся до выхода приложения.

## Структура репозитория

```
resources/bin/         sing-box.exe + libcronet.dll (git-ignored, npm run core)
scripts/fetch-core.mjs downloads the bundled sing-box core
src/
  shared/types.ts      single source of truth for the IPC contract
  shared/validation.ts IPC payload validators and settings/scenario sanitisers
  shared/i18n.ts       language list, English-keyed `ru` dictionary, translate()
  main/
    index.ts           window, IPC handlers, tray, subscriptions, QR/backup, shots
    i18n.ts            main-process translator (t / setMainLanguage)
    store.ts           JSON settings/profiles/subscriptions/scenarios/sessions
    secret-vault.ts    safeStorage-encrypted vault for share links/subscription URLs
    vpn/
      engine.ts        state machine, connect/teardown, telemetry, protection,
                       diagnostics, scenarios, engine comparison
      singbox.ts       sing-box config, Clash API, speed transfer, port helpers
      engines/
        manager.ts     discovery, install/update/remove, auto choice, TUN staging
        types.ts       EngineAdapter contract
        singbox-adapter.ts
        xray-adapter.ts + xray-stats.ts
        mihomo-adapter.ts
      firewall/        Windows Firewall, macOS pf, Linux iptables kill switch
      system-proxy/    WinINET, networksetup, GSettings backends
      dns-guard.ts     dual-stack DoH relay + IPv4/IPv6 resolver backup/restore
      scenarios.ts     built-in Gaming/Performance/Privacy/Manual presets
      profiles.ts      share-link + base64 subscription parser
      free-sources.ts  public catalogs, TCP probe, live node verification
      geo.ts           DNS + ip-api geolocation (no invented coordinates)
      process-usage.ts CPU/RAM sampler for the core process
      engine-test.ts   dev harness for the full engine matrix
  preload/index.ts     contextBridge → window.eaglet
  renderer/
    index.html
    src/
      App.tsx          page routing, theme override plumbing
      i18n.ts          renderer translator (t / setLanguage)
      format.ts        speed/bytes/duration/date-time formatters
      data/worldMap.json
      components/      TitleBar, Sidebar, PowerDial, WorldMap, …
      pages/           Home, Servers, Scenarios, Routing, Stats, Settings, MiniView
      styles/theme.css theme tokens + backdrops
      styles/app.css   layout and components
```

## Локализация (i18n)

Eaglet поставляется на английском и русском, причём **русский — язык интерфейса по
умолчанию**. Слой i18n намеренно минималистичен и без зависимостей:

1. `src/shared/i18n.ts` хранит список `LANGUAGES`, `DEFAULT_LANGUAGE = 'ru'`,
   словарь `ru` и `translate()`. **Английская исходная строка — это ключ перевода**,
   поэтому отсутствующая русская запись просто откатывается к английской, а не
   показывает заглушку. Интерполяция использует плейсхолдеры `{name}`.
2. `src/renderer/src/i18n.ts` предоставляет модульные `t()` и `setLanguage()`.
   `App.tsx` вызывает `setLanguage(snap.settings.language)` во время рендера.
   В приложении нет мемоизированных дочерних компонентов, поэтому смена языка
   перерисовывает всё дерево.
3. `src/main/i18n.ts` предоставляет модульные `t()` и `setMainLanguage()`.
   `src/main/index.ts` синхронизирует язык из сохранённых настроек при запуске и в
   обработчике `settings:update`.
4. `format.ts` выбирает локаль (`ru-RU` / `en-US`) через `getLanguage()`.
5. `test/i18n.test.ts` сканирует все вызовы `t('...')` в `src` и падает, если для
   строки нет русской записи, поэтому забытые ключи ловятся в CI.

Правила при добавлении строк:

- Оборачивайте каждую пользовательскую строку в `t('English source')` и передавайте
  переменные как `t('... {count} ...', { count })`.
- Никогда не вызывайте `t()` на верхнем уровне модуля — язык меняется в рантайме.
  Преобразуйте модульные константы с текстом в функции, вызываемые при рендере.
- Не переводите технические идентификаторы: id ядер и протоколов, `TUN`, `DoH`,
  `DNS`, `IPv6`, пути, URL, CSS-классы.
- Добавляйте перевод в словарь `ru` в `src/shared/i18n.ts`. Пропущенный ключ
  безопасно откатывается к английскому.

## Система тем

1. `src/renderer/src/styles/theme.css` определяет каждый токен под
   `[data-theme='<id>']` — фоновые слои, заливки панелей, границы, текст,
   `--accent`, `--accent-rgb`, `--glow`, радиусы, размытие и палитру карты.
2. `App.tsx` задаёт `document.documentElement.dataset.theme` из сохранённой
   настройки (`themeOverride` существует только для пакета скриншотов).
3. `ThemeBackdrop.tsx` рендерит только декоративные слои, относящиеся к активной
   теме (молнии, стеклянные пятна, ленты северного сияния, сетку HUD).

**Добавление темы:** добавьте id в `ThemeId` в `src/shared/types.ts`, добавьте блок
токенов в `theme.css`, добавьте запись в `THEMES` в
`src/renderer/src/pages/Settings.tsx`, при желании добавьте фон в
`ThemeBackdrop.tsx`. Больше ничего менять не нужно.

Правила дизайна, сохраняющие согласованность шести стилей:

- Никогда не задавайте цвет в компоненте жёстко — всегда используйте токен.
- Движение сдержанное: 0.16–0.35s с `var(--ease)`; фоновые циклы длинные.
- `hud` меняет весь стек шрифтов на моноширинный и убирает скругления; держите
  подписи короткими и удобными для верхнего регистра.
- `minimal` не имеет свечения (`--glow: none`) — не добавляйте box-shadow в
  компонентах условно.

## Архитектура с несколькими ядрами

`src/main/vpn/engines/manager.ts` — единственное место, которое знает о конкретных
ядрах. Каждое ядро реализует `EngineAdapter` (`engines/types.ts`):

```ts
interface EngineAdapter {
  id: EngineId
  name: string
  releaseRepo: string
  protocols: ProtocolId[]
  telemetry: boolean
  supportsTun: boolean
  supportsProfile?: (profile: Profile) => boolean
  assetPattern(platform, arch): RegExp
  binaryName(platform): string
  configFileName: string
  buildConfig(input): string
  validateArgs(configPath): string[]
  versionArgs: string[]
  parseVersion(output): string | null
  runArgs(configPath): string[]
}
```

Ключевые правила:

- Порядок `EngineManager.choose()`: **переопределение профиля → глобальный выбор →
  авто**. Авто перебирает `sing-box, mihomo, xray`, требует установленный бинарник,
  который проходит `supportsProfile()` и, когда включён `tunMode`, `supportsTun`.
- `supportsProfile()` — это не просто принадлежность к протоколу. Адаптер Xray
  отклоняет устаревшие шифры Shadowsocks (`aes-256-cfb`, …) до запуска;
  привязанное ядро, не способное обслужить узел, сообщается в логе, и менеджер
  переходит к другому.
- `buildConfig()` получает `{ profile, settings, mixedPort, apiPort, auxPort,
  apiSecret }`. У Xray нет смешанного входящего порта, поэтому `auxPort` — это его
  слушатель SOCKS; `apiPort` — нативный stats API Xray, а не Clash API.
- `validate()` вызывает `sing-box check`, `xray run -test` или `mihomo -t` и
  показывает stderr в интерфейсе.
- `start()` запускает с `cwd = userData/bin`, потому что Windows разрешает
  `wintun.dll` относительно рабочего каталога. `ensureTun()` один раз скачивает
  `wintun-0.14.1.zip`, извлекает совпадающую архитектуру и размещает ядро рядом с
  DLL.
- Установки идут из официальных релизов GitHub в `userData/bin`; `resources/bin` —
  это лишь встроенный резерв sing-box. Архивы, имя полезной нагрузки которых
  отличается от имени бинарника (Mihomo), сопоставляются по содержимому
  исполняемого файла, а не по фиксированному имени.
- Прежде чем что-либо выполнить или скопировать, скачанный архив должен совпасть с
  GitHub-дайджестом релиза (с откатом к опубликованному файлу контрольных сумм).
  Бинарники Windows дополнительно проверяются через `Get-AuthenticodeSignature`;
  неподписанные сборки принимаются, недействительная или подделанная подпись
  прерывает установку. `wintun-0.14.1.zip` сверяется с закреплённым SHA-256.
- `stop()` ждёт выхода процесса (и его дочерних процессов) до завершения, чтобы
  заменяющее ядро могло привязать адаптер TUN без конфликта.
- Конфигурация Mihomo использует явные приватные CIDR и
  `fallback-filter.geoip: false`, поэтому проверка никогда не скачивает базу GeoIP.

### Конечный автомат ядра (`vpn/engine.ts`)

`VpnEngine extends EventEmitter` владеет рантаймом:

- `connect(profileId?, automatic?)` — проверка прямого IP → подготовка/установка
  ядра → при необходимости подготовка TUN → сборка + проверка нативной
  конфигурации → запуск → ожидание смешанного порта → проверка IP выхода →
  применение системного прокси → активация защиты (fail-closed) → подключено.
- `applyProtection()` — настоящий kill switch через `firewall/` и настоящий
  DoH-ретранслятор через `dns-guard.ts`. Обоим нужны права администратора; сбои
  логируются, а запрошенный, но не активированный слой прерывает подключение (см.
  «Слои защиты») и никогда не скрывается.
- `setEngine(choice)` — если туннель активен, отключается, принудительно включает
  новое ядро, переподключается и проверяет, что выбранное ядро действительно
  работает; при сбое снова отключается, переподключается с предыдущим ядром и
  восстанавливает настройку. Прямой профиль никогда не получает kill switch.
- `disconnect()` / `shutdown()` — один финальный снимок телеметрии, остановка
  телеметрии, уничтожение дерева процессов, восстановление прокси, снятие
  kill switch/DNS-защиты, сохранение сессии, отправка снимка «отключено».
- `onCoreExit()` — сохраняет защиту активной во время сбоя, записывает сессию и
  вызывает `scheduleReconnect()` (три попытки, 2.5 s × n).
- `diagnose()` — возвращает реальные проверки (бинарник, версия, конфигурация,
  прокси, TUN, kill switch, DNS, разрешение имён, IP выхода, задержка, потери,
  подписки, обновления, поддержка платформы).
- `applyScenario()` — записывает реальные настройки, выбирает ядро, фиксирует
  переключение и может выбрать самый быстрый/избранный сервер.
- `validateEngineConfig(id)` — собирает нативную конфигурацию для одного ядра без
  подключения и запускает его валидатор.
- `prepareTun()` — готовит `wintun.dll` и подготовленное ядро, не открывая туннель.

### Телеметрия

- sing-box/Mihomo: Clash API (`/connections`) с bearer-секретом.
- Xray: нативный `StatsService` через `xray api statsquery --server=…`;
  суммируются только счётчики входящих. Опрашивается через тик, потому что
  запускает CLI.
- Задержка: HTTP-проба через локальный входящий порт каждые 5 с. Джиттер — средняя
  абсолютная разница между последовательными пробами; потери — неудачные пробы,
  делённые на скользящее окно.
- CPU/RAM: `process-usage.ts` читает живой PID ядра.
- `SessionRecord` хранит ядро, трафик, длительность, IP выхода, ping, джиттер и
  потери.

### Слои защиты

| Слой | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Системный прокси | реестр WinINET | `networksetup` | GSettings (GNOME) |
| Kill switch | Брандмауэр: исходящий Block по умолчанию + ограниченные правила allow, привязанные к программе | якорь `pf` (`com.apple/eaglet`) | выделенные цепочки `iptables` + `ip6tables` |
| DNS-защита | Двухстековый DoH-ретранслятор на `127.0.0.1:53`/`::1:53`, резервное копирование/восстановление резолверов IPv4+IPv6 | то же | то же |
| TUN | `wintun.dll` + ядро с правами администратора | — | — |

Правила kill switch разрешают только loopback, DHCP/ND, IP и порт узла, закреплённые
IP/порт DoH, разрешённые конечные точки подписок/обновлений на их реальных портах
и — только когда DNS-защита выключена — прежние резолверы на порту 53. Правила
Windows привязаны к исполняемому файлу Eaglet/ядра, поэтому нет широкого
исключения для `80/443` или «любой программы»; macOS/Linux ограничены уровнем
пакетов, потому что эти бэкенды не могут надёжно определить программу без
дополнительных cgroups/помощников. Windows также сохраняет состояния разрешений
для соединений, установленных до активации политики (нет драйвера-колаута WFP),
поэтому такие потоки могут пережить переключатель до закрытия. Когда DNS-защита
включена, все правила для открытого DNS удаляются, и loopback-ретранслятор
становится единственным резолвером. У IPv6 своя политика, и он отбрасывается даже
для узла только с IPv4. В Linux отсутствующий `ip6tables` прерывает весь kill
switch (если только ядро не отключило IPv6); macOS сохраняет/восстанавливает
предыдущее состояние `pf` и содержимое собственного якоря Eaglet. Намеренно нет
ярлыка `conntrack`/`ESTABLISHED`.

Авто-переподключение сохраняет активную политику: `connect(..., automatic)
сохраняет правила и ретранслятор, ядро разрешает имена через них, а
`applyProtection()` не трогает уже активированную политику (повторный `enable()`
перезаписал бы сохранённое состояние «до активации» в Windows/macOS и сделал бы
последующее отключение необратимым). Политика пересобирается из свежей резервной
копии при следующем ручном подключении. Если три попытки не удались, защита
остаётся активной, и пользователь должен отключиться, чтобы восстановить прямой
доступ. Linux сначала пересобирает цепочку с завершающим `DROP`, поэтому окно
между очисткой и заполнением не может утечь. Ручные отключения и явные
переключения ядер по своей природе разрушают туннель и восстанавливают прямое
сетевое взаимодействие.

Защита работает по принципу **fail-closed**. `connect()` активирует kill switch и
DNS-ретранслятор, а затем проверяет записанное состояние: если
`killSwitch`/`networkProtection` были запрошены (профиль не `direct`, и платформа
это поддерживает), но политика не активировалась, или если
`dnsProtection`/`networkProtection` были запрошены, но ретранслятор не
запустился, подключение разрушается и сообщается как ошибка вместо заявления
`connected` на незащищённом туннеле. Дополнительно
`windowsKillSwitch.disable()` перечитывает действия исходящих по каждому профилю
после их восстановления и выбрасывает ошибку, если какое-либо значение отличается
от резервной копии, поэтому неудачное восстановление всплывает и повторяется при
следующей попытке (или запуске), а не молча оставляет машину заблокированной.

Секреты (ссылки-приглашения, URL подписок) живут в `userData/secrets.bin`,
записываются атомарно и шифруются Electron `safeStorage`. Файлы только с base64 из
старых сборок мигрируются один раз; новый открытый текст никогда не записывается.
Если связка ключей недоступна, хранилище сообщает `unavailable` и отказывается
записывать, а `Store` хранит ссылку в `config.json`, и `Snapshot.security`
предупреждает, что она в открытом виде. Повреждённое/нерасшифровываемое хранилище
остаётся нетронутым и сообщается как `corrupt`, поэтому метаданные профиля никогда
не теряются. `snapshot()` удаляет `Profile.raw` и скрывает URL подписок;
`copyProfileLink` и обновление подписки читают секрет внутри главного процесса.
Конечная точка DoH разрешается до перенаправления системного резолвера, а затем
запрашивается по HTTPS по закреплённому IP с исходными SNI/Host; `::1`
объявляется только когда IPv6-ретранслятор привязался.

Поддержка намеренно асимметрична: только Windows входит в проверенную матрицу;
бэкенды macOS/Linux существуют, но помечены как **экспериментальные**. Никогда не
заявляйте о возможности платформы, которую вы не тестировали.

## Контракт IPC

Весь трафик рендерер↔main идёт через `window.eaglet` (`src/shared/types.ts`
определяет `EagletApi`). Основное:

- снимок/состояние: `snapshot()`, `onState(cb)` — у профилей `raw: ''`, URL
  скрыты, а `security` честно описывает хранение секретов
- туннель: `connect`, `quickConnect`, `disconnect`, `selectProfile`,
  `checkIp`, `runSpeedTest`
- профили: `importProfiles`, `importQr`, `updateSubscription`,
  `updateAllSubscriptions`, `removeSubscription`, `removeProfile`,
  `setFavorite`, `testProfiles`, `clearSessions`, `copyProfileLink`
- ядра: `refreshEngines`, `installEngine`, `removeEngine`,
  `checkEngineUpdates`, `setEngine`, `setProfileEngine`, `clearEngineHistory`
- сценарии/диагностика: `applyScenario`, `saveScenario`, `removeScenario`,
  `diagnose`
- данные: `exportBackup`, `importBackup`, `exportConfig`
- настройки/окно: `updateSettings`, `setMini`, minimize/close/maximize

Не добавляйте `nodeIntegration`; рендерер должен оставаться изолированным за
preload (`sandbox: true`, `contextIsolation: true`, `webviewTag: false`). Навигация
и `window.open` запрещены, внешние ссылки ограничены `http(s)`, и каждый
обработчик IPC проверяет, что отправитель — главный фрейм главного окна, прежде
чем выполниться. Полезные нагрузки валидируются в `src/shared/validation.ts` (id,
патч настроек, ввод сценария, массивы), неизвестные ключи настроек отклоняются, а
HTML продакшена и каждый ответ сессии несут строгий CSP. Считайте ввод рендерера
недоверенным, даже если он локальный.

## Пакеты разработчика

Все пакеты пишут JSON, потому что stdout Electron невидим в Windows.

- `npm test` (Vitest) — модульные тесты для генерации правил брандмауэра, политики
  контрольных сумм и Authenticode, выбора ядра, закрепления цели DoH и
  хранилища/миграции секретов. `electron` замаплен на `test/electron-stub.ts`,
  поэтому GUI не запускается.
- `electron . --eaglet-engine-test` (`vpn/engine-test.ts`) — устанавливает все три
  ядра, проверяет стандартные/укреплённые конфигурации, открывает настоящий туннель
  каждым ядром, убивает каждое ядро, чтобы доказать авто-переподключение,
  проверяет выбор на уровне профиля/глобальный/авто, применяет сценарии,
  проверяет восстановление прокси и подготовку TUN и выполняет аварийное
  завершение. Слои защиты, требующие прав администратора, сообщаются как
  пропущенные. Перед выходом восстанавливает настройки пользователя, привязки
  профилей, список сессий и историю ядер. Пишет `engine-test.json`.
- `--eaglet-free-test` / `--eaglet-free-connect-test` — каталоги бесплатных
  серверов и реальное подключение к обнаруженному узлу.
- `--eaglet-feature-test` — избранное, правила обхода, тест скорости,
  принудительное убийство ядра, сохранение сессий и проверка восстановления
  устаревшего прокси.

## Чек-лист тестирования

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Запустите `electron . --eaglet-engine-test` (с правами администратора при
   тестировании kill switch/DNS/TUN). Все три ядра должны установиться,
   провериться, подключиться, показывать живые счётчики, переподключиться после
   `taskkill` и восстановить прокси.
3. Импортируйте `direct://Test` или реальный узел и подключитесь. Убедитесь, что
   смешанный входящий порт открылся, прокси WinINET восстановился после
   отключения, телеметрия движется, а главный экран показывает прямой/выходной
   адреса.
4. Проверьте, что `Get-Process sing-box, xray, mihomo` пуст после отключения.
5. Проверьте раздельное туннелирование: добавьте домены/CIDR, подключитесь,
   изучите `userData/core/config.json` (или `config.yaml`) на наличие ожидаемых
   прямых правил.
6. Проверьте пакет удобств: отметьте узел звездой, скопируйте/вставьте ссылки,
   запустите тест скорости, подтвердите строку сессии, примените сценарий,
   запустите диагностику, экспортируйте резервную копию и конфигурацию активного
   ядра.
7. `npm run shots` создаёт демо-профили, создаёт две реальные сессии, подключается
   через прямой профиль, нажимает тест скорости, снимает каждую страницу (включая
   «Сценарии») и убирает за собой. Установите `EAGLET_SHOT_FREE=1`, чтобы также
   снять панель бесплатных серверов.

## Соглашения

- TypeScript в строгом режиме; никаких `any` в коммитируемом коде.
- Комментарии объясняют *почему*; код говорит *что*.
- Компоненты остаются презентационными — данные и действия приходят как props из
  `App.tsx`.
- Интерфейс локализован: английские строки-источники оборачиваются в `t()`, а
  русские переводы лежат в словаре `ru` в `src/shared/i18n.ts`. См. раздел
  «Локализация (i18n)».
- Никогда не выдумывайте координаты серверов, телеметрию, трафик или статус
  защиты. Если возможность требует прав администратора или не реализована,
  сообщайте об этом честно.

## Пакет скриншотов

`npm run shots` собирает приложение и запускает главный процесс с
`--eaglet-shots`. `scheduleShots()` в `src/main/index.ts` создаёт демо-профили
(источник `__shots__`, один со звездой), очищает историю сессий, временно задаёт
демо-список обхода, выполняет две короткие реальные сессии (каждая с тестом
скорости на 10 МБ), затем подключается к прямому профилю и пишет
`screenshots/*.png`. Страница статистики снимается дважды: один раз сверху и один
раз с прокруткой к таблице сессий. Созданные профили удаляются, список обхода
восстанавливается, а туннель останавливается перед выходом. Окно показывается во
время съёмки (`showInactive`), а `backgroundThrottling` отключён, иначе Chromium
может вернуть устаревшие кадры.
