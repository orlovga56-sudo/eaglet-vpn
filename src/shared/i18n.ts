/**
 * Tiny zero-dependency i18n layer shared by the main process, the preload bridge
 * and the renderer.
 *
 * The English source string is the translation key, so a missing Russian entry
 * simply falls back to English instead of showing a placeholder. Interpolation
 * uses `{name}` placeholders. Product and protocol names (sing-box, Xray-core,
 * Mihomo, VLESS, DNS, IPv4, …) are intentionally left untranslated.
 */
import type { Language } from './types'

export interface LanguageOption {
  id: Language
  /** Native name of the language, shown in the settings selector. */
  label: string
}

export const LANGUAGES: LanguageOption[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' }
]

/** Russian is the primary interface language on a fresh install. */
export const DEFAULT_LANGUAGE: Language = 'ru'

export type Vars = Record<string, string | number>

/** Russian dictionary keyed by the English source string. */
const ru: Record<string, string> = {
  ' · {country}': ' · {country}',
  ' · {loss}%': ' · {loss}%',
  ' · ±{jitter}': ' · ±{jitter}',
  ', {count} updated': ', обновлено: {count}',
  '. Up to 120 entries.': '. До 120 записей.',
  'A private desktop VPN client with three tunnel cores — sing-box, Xray-core and Mihomo. Six interchangeable themes, live core telemetry, real exit-IP verification and subscription import in one window.':
    'Приватный VPN-клиент для компьютера с тремя туннельными ядрами — sing-box, Xray-core и Mihomo. Шесть сменных тем, телеметрия ядра в реальном времени, настоящая проверка выходного IP и импорт подписок в одном окне.',
  'A scenario needs a name': 'Сценарию нужно имя',
  About: 'О программе',
  Active: 'Активен',
  'Active engine': 'Активный движок',
  'Active exit': 'Активный выход',
  'Add a node': 'Добавить узел',
  'Add nodes': 'Добавить узлы',
  'Add selected': 'Добавить выбранные',
  'Added {count} free node(s) from public catalogs':
    'Добавлено бесплатных узлов из публичных каталогов: {count}',
  'Added {count} free {nodeLabel}. Use Test all, then Connect — public nodes are often slow.':
    'Добавлено бесплатных {nodeLabel}: {count}. Нажмите «Проверить все», затем «Подключиться» — публичные узлы часто медленные.',
  'Aggregated from your recorded sessions': 'Сводка по записанным сессиям',
  All: 'Все',
  'All installed engines are up to date': 'Все установленные движки обновлены',
  'Always direct': 'Всегда напрямую',
  'Apply scenario': 'Применить сценарий',
  'Applying…': 'Применение…',
  Armed: 'Включён',
  'Arms the kill switch and the DNS guard together on every connection.':
    'Включает Kill Switch и защиту DNS при каждом подключении.',
  Auto: 'Авто',
  'Auto (best installed)': 'Авто (лучший установленный)',
  'Auto engine': 'Автоматический движок',
  'Auto prefers an installed core that supports the profile protocol and TUN when it is enabled. Profiles can override this choice individually.':
    'В режиме «Авто» выбирается установленный движок, который поддерживает протокол профиля и TUN, если он включён. Профиль может переопределить этот выбор.',
  'Auto · best installed': 'Авто · лучший установленный',
  'Auto-connect': 'Автоподключение',
  'Auto-connect on launch': 'Подключаться при запуске',
  'Auto-pick': 'Автовыбор',
  'Auto-reconnect': 'Автопереподключение',
  'Auto-update failed · {name}: {message}': 'Автообновление не удалось · {name}: {message}',
  'Automatic (core)': 'Автоматически (ядро)',
  'Automatic subscription updates': 'Автоматическое обновление подписок',
  'Automatic updates': 'Автоматические обновления',
  'Avg latency': 'Средняя задержка',
  'Backup restored · {count} profiles': 'Резервная копия восстановлена · профилей: {count}',
  'Backup saved to {path}': 'Резервная копия сохранена в {path}',
  'Basic counters': 'Базовые счётчики',
  'Binary not found': 'Исполняемый файл не найден',
  Blocked: 'Заблокировано',
  'Bring the tunnel up as soon as Eaglet starts.':
    'Поднимать туннель сразу после запуска Eaglet.',
  'Built-in': 'Встроенный',
  'Built-in direct route': 'Встроенный прямой маршрут',
  Bundled: 'В комплекте',
  'Capture every process through a virtual adapter. Needs admin and a reconnect.':
    'Захватывать весь трафик через виртуальный адаптер. Нужны права администратора и переподключение.',
  Changed: 'Изменено',
  'Check engine updates': 'Проверить обновления движков',
  'Check updates': 'Проверить обновления',
  Checking: 'Проверка',
  'Checking {count} node ports': 'Проверка портов узлов: {count}',
  'Checking…': 'Проверка…',
  'Choose the language used across the app. It applies immediately.':
    'Выберите язык интерфейса. Он применяется сразу.',
  Clear: 'Очистить',
  'Clear history': 'Очистить историю',
  Close: 'Закрыть',
  'Close to tray': 'Сворачивать в трей',
  Closing: 'Закрытие',
  'Cloudflare · 1.1.1.1': 'Cloudflare · 1.1.1.1',
  'Compact mode': 'Компактный режим',
  Connect: 'Подключиться',
  'Connect a tunnel to run the test': 'Подключите туннель, чтобы запустить тест',
  'Connect to measure the exit': 'Подключитесь, чтобы измерить выход',
  Connected: 'Подключено',
  Connecting: 'Подключение',
  Connection: 'Соединение',
  'Copy share link': 'Копировать ссылку',
  Core: 'Ядро',
  'Core CPU': 'CPU ядра',
  'Core configuration saved to {path}': 'Конфигурация ядра сохранена в {path}',
  'Core memory': 'Память ядра',
  'Could not create a direct profile for the engine test':
    'Не удалось создать прямой профиль для теста движка',
  'Could not install {name}: {error}': 'Не удалось установить {name}: {error}',
  'Could not switch to {name}: {error}': 'Не удалось переключиться на {name}: {error}',
  'Create a custom scenario': 'Создать свой сценарий',
  'Creates a virtual adapter and captures every process, including games and terminals. Needs an administrator session and a reconnect.':
    'Создаёт виртуальный адаптер и захватывает весь трафик, включая игры и терминалы. Нужна сессия администратора и переподключение.',
  Custom: 'Свой',
  'Custom resolver': 'Свой резолвер',
  'Custom scenario saved.': 'Свой сценарий сохранён.',
  'Custom…': 'Другой…',
  DNS: 'DNS',
  'DNS guard': 'Защита DNS',
  'DNS protection': 'Защита DNS',
  'DNS resolver': 'DNS-резолвер',
  'Decide what travels through the core. Routing changes apply on the next connection.':
    'Определите, что идёт через ядро. Изменения маршрутизации применяются при следующем подключении.',
  'Decode a QR code from an image file': 'Распознать QR-код из файла изображения',
  Delete: 'Удалить',
  'Delete this custom scenario?': 'Удалить этот сценарий?',
  Description: 'Описание',
  'Desktop notifications': 'Уведомления на рабочем столе',
  'Detecting…': 'Определение…',
  'Diagnostics & maintenance': 'Диагностика и обслуживание',
  Direct: 'Напрямую',
  'Direct address': 'Прямой адрес',
  'Direct connection': 'Прямое соединение',
  'Direct connection restored': 'Прямое соединение восстановлено',
  Disconnect: 'Отключиться',
  'Disconnect before picking a new fastest node':
    'Отключитесь, прежде чем выбирать новый быстрый узел',
  'Disconnect before removing the engine that is currently running':
    'Отключитесь, прежде чем удалять работающий движок',
  Disconnected: 'Отключено',
  Disconnecting: 'Отключение',
  'DoH endpoint used for tunnelled queries.':
    'DoH-эндпоинт для запросов через туннель.',
  'Domains, IPs or CIDRs that never enter the tunnel. These rules win in both Global and Smart mode and apply on the next connection.':
    'Домены, IP-адреса и CIDR, которые никогда не попадают в туннель. Эти правила действуют в режимах «Глобальный» и «Умный» и применяются при следующем подключении.',
  Down: 'Скачивание',
  Download: 'Скачать',
  Downloaded: 'Скачано',
  'Downloading 10 MB through the tunnel…': 'Скачивание 10 МБ через туннель…',
  'Downloading community catalogs': 'Загрузка публичных каталогов',
  Duration: 'Длительность',
  'EAGLET v{version} · {count} SUB': 'EAGLET v{version} · {count} ПОДПИСКА',
  'EAGLET v{version} · {count} SUBS': 'EAGLET v{version} · {count} ПОДПИСОК',
  EXIT: 'ВЫХОД',
  'Eaglet VPN': 'Eaglet VPN',
  'Eaglet downloads it on first use': 'Eaglet скачает его при первом использовании',
  'Eaglet engine ready · engine manager online':
    'Движок Eaglet готов · менеджер движков онлайн',
  'Eaglet {version}': 'Eaglet {version}',
  'Eaglet · Disconnected': 'Eaglet · Отключено',
  'Eaglet · Exit IP changed': 'Eaglet · Выходной IP изменился',
  'Eaglet · Tunnel dropped': 'Eaglet · Туннель оборван',
  'Eaglet · Tunnel up': 'Eaglet · Туннель поднят',
  'Eaglet · {status}': 'Eaglet · {status}',
  'Electric Cyber': 'Electric Cyber',
  'Electric blue on deep space': 'Электрик-синий на глубоком космосе',
  Enabled: 'Включено',
  'Encrypted DNS': 'Зашифрованный DNS',
  'Encrypted route': 'Зашифрованный маршрут',
  'Encrypted tunnel established': 'Зашифрованный туннель установлен',
  Engine: 'Движок',
  'Engine comparison': 'Сравнение движков',
  'Engine installed': 'Движок установлен',
  'Engine removed': 'Движок удалён',
  'Engine set to {name}': 'Движок: {name}',
  'Engine switch failed · {error} · rolling back to {name}':
    'Не удалось сменить движок · {error} · возврат к {name}',
  'Engine switch history': 'История смены движков',
  'Engine switched to {name}': 'Движок переключён на {name}',
  'Enter a DoH endpoint such as https://dns.example.com/dns-query.':
    'Введите DoH-эндпоинт, например https://dns.example.com/dns-query.',
  Error: 'Ошибка',
  'Event log': 'Журнал событий',
  'Every 12 hours': 'Каждые 12 часов',
  'Every 24 hours': 'Каждые 24 часа',
  'Every 3 hours': 'Каждые 3 часа',
  'Every 6 hours': 'Каждые 6 часов',
  'Every hour': 'Каждый час',
  'Every packet, including the local network, leaves through the encrypted tunnel. Maximum privacy.':
    'Каждый пакет, включая локальную сеть, уходит через зашифрованный туннель. Максимальная приватность.',
  Exit: 'Выход',
  'Exit IP': 'Выходной IP',
  'Exit location': 'Расположение выхода',
  'Export backup': 'Экспорт резервной копии',
  'Export core config': 'Экспорт конфигурации ядра',
  'Fastest node': 'Самый быстрый узел',
  'Favourite node': 'Избранный узел',
  Favourites: 'Избранное',
  'Fetching community catalogs and testing latency…':
    'Загрузка публичных каталогов и проверка задержки…',
  'Find a server first': 'Сначала найдите сервер',
  'Find free servers': 'Найти бесплатные серверы',
  Finder: 'Поиск',
  'Force an update of every HTTP subscription, ignoring the interval.':
    'Принудительно обновить все HTTP-подписки, игнорируя интервал.',
  'Free public nodes': 'Бесплатные публичные узлы',
  'Free public servers': 'Бесплатные публичные серверы',
  'Free search failed: {message}': 'Поиск бесплатных серверов не удался: {message}',
  'Free search · {found} found · {reachable} reachable · {working} working':
    'Поиск бесплатных · найдено: {found} · доступно: {reachable} · рабочих: {working}',
  'Frosted layers, violet light': 'Матовая слоистость, фиолетовый свет',
  Gaming: 'Игры',
  'Give the scenario a name first.': 'Сначала задайте имя сценарию.',
  Glassmorphism: 'Glassmorphism',
  Global: 'Глобальный',
  'Global engine': 'Глобальный движок',
  'Global tunnel, encrypted DNS, IPv6 leaks blocked, kill switch and strict reconnect.':
    'Глобальный туннель, зашифрованный DNS, блокировка утечек IPv6, Kill Switch и строгое переподключение.',
  'Google · 8.8.8.8': 'Google · 8.8.8.8',
  'HTTP {status}': 'HTTP {status}',
  'HUD / Scifi': 'HUD / Sci-fi',
  'Happ, v2rayN and Shadowrocket base64 subscriptions work. Use Update on a subscription to refresh its nodes.':
    'Поддерживаются base64-подписки Happ, v2rayN и Shadowrocket. Нажмите «Обновить» у подписки, чтобы обновить её узлы.',
  Home: 'Главная',
  'How often a due subscription is refreshed.':
    'Как часто обновлять подписку, когда срок подошёл.',
  'How traffic is captured': 'Как перехватывается трафик',
  'IP changed': 'IP изменён',
  'IPv4 only': 'Только IPv4',
  IPv6: 'IPv6',
  Idle: 'Простой',
  'If the core drops, retry up to three times with a growing delay.':
    'Если ядро падает, повторить до трёх раз с увеличивающейся задержкой.',
  Import: 'Импорт',
  'Import a subscription': 'Импортировать подписку',
  'Import a subscription URL or paste share links. Eaglet runs them on the sing-box core — VLESS, VMess, Trojan, Shadowsocks, Hysteria2 and TUIC.':
    'Импортируйте URL подписки или вставьте ссылки. Eaglet запускает их на ядре sing-box — VLESS, VMess, Trojan, Shadowsocks, Hysteria2 и TUIC.',
  'Import a subscription or run the free-server finder':
    'Импортируйте подписку или запустите поиск бесплатных серверов',
  'Import a subscription to begin': 'Импортируйте подписку, чтобы начать',
  'Imported {count} node(s) from a share link': 'Импортировано узлов из ссылки: {count}',
  'Imported {count} node(s) from the clipboard.':
    'Импортировано узлов из буфера обмена: {count}.',
  'Importing…': 'Импорт…',
  Install: 'Установить',
  Installed: 'Установлен',
  'Interface language': 'Язык интерфейса',
  Jitter: 'Джиттер',
  'Keep Eaglet and the tunnel running from the system tray.':
    'Eaglet и туннель продолжают работать в системном трее.',
  'Keep in tray': 'Оставлять в трее',
  'Keep my selection': 'Сохранить мой выбор',
  'Keep selection': 'Сохранить выбор',
  'Keep the tunnel-only policy after an unexpected drop.':
    'Сохранять политику «только туннель» после неожиданного обрыва.',
  'Kill switch': 'Kill Switch',
  'Kill switch · ': 'Kill Switch · ',
  Language: 'Язык',
  'Last known': 'Последний известный',
  'Last used': 'Последнее использование',
  'Last {count} switches': 'Последних переключений: {count}',
  Latency: 'Задержка',
  'Latency & jitter · ms': 'Задержка и джиттер · мс',
  'Launch at startup': 'Запускать при старте',
  Live: 'В реальном времени',
  'Live counters': 'Счётчики в реальном времени',
  'Live session': 'Текущая сессия',
  'Live tunnel': 'Активный туннель',
  Loss: 'Потери',
  'Low-latency gaming': 'Игры с низкой задержкой',
  'Manage servers': 'Управление серверами',
  Manual: 'Вручную',
  'Master switch: arms the kill switch and the local DNS guard together.':
    'Общий переключатель: включает Kill Switch и локальную защиту DNS вместе.',
  Maximize: 'Развернуть',
  'Maximum throughput: Mihomo, global routing, IPv6 enabled, full-device TUN.':
    'Максимальная пропускная способность: Mihomo, глобальная маршрутизация, IPv6 включён, TUN для всего устройства.',
  'Measure latency': 'Измерить задержку',
  'Measure real throughput through the active core':
    'Измерить реальную пропускную способность через активное ядро',
  'Minimal Dark': 'Minimal Dark',
  Minimize: 'Свернуть',
  Missing: 'Отсутствует',
  'NO PROFILE': 'НЕТ ПРОФИЛЯ',
  NODE: 'УЗЕЛ',
  Name: 'Название',
  'Nature Aurora': 'Nature Aurora',
  'Neon Purple': 'Neon Purple',
  Network: 'Сеть',
  'Network protection': 'Сетевая защита',
  'Neutral baseline: system proxy, smart routing and automatic core selection for hand tuning.':
    'Нейтральная основа: системный прокси, умная маршрутизация и автоматический выбор ядра для ручной настройки.',
  'No HTTP subscriptions to refresh': 'Нет HTTP-подписок для обновления',
  'No QR code was found in that image': 'В этом изображении не найден QR-код',
  'No TUN': 'Без TUN',
  'No alternative engine is installed': 'Другой движок не установлен',
  'No change': 'Без изменений',
  'No engine switches recorded yet.': 'Переключения движков пока не записаны.',
  'No favourites yet — tap the star on any node to pin it here.':
    'Избранного пока нет — нажмите звезду у любого узла, чтобы закрепить его здесь.',
  'No finished sessions yet. Connect and disconnect to record one.':
    'Завершённых сессий пока нет. Подключитесь и отключитесь, чтобы записать сессию.',
  'No node selected': 'Узел не выбран',
  'No nodes match “{query}”.': 'Нет узлов, соответствующих «{query}».',
  'No nodes yet': 'Узлов пока нет',
  'No nodes yet — import a subscription or find free servers first':
    'Узлов пока нет — сначала импортируйте подписку или найдите бесплатные серверы',
  'No probe yet': 'Замеров пока нет',
  'No profile': 'Нет профиля',
  'No profile selected': 'Профиль не выбран',
  'No remote profile is configured — import a node before running the engine test':
    'Удалённый профиль не настроен — импортируйте узел перед запуском теста движка',
  'No supported share links found in that text':
    'В этом тексте не найдено поддерживаемых ссылок',
  'No tunnel': 'Без туннеля',
  'No valid share links were selected': 'Не выбрано ни одной корректной ссылки',
  'No working nodes in the first sample · trying another batch':
    'В первой выборке нет рабочих узлов · пробуем другую партию',
  'No working nodes right now': 'Сейчас нет рабочих узлов',
  Node: 'Узел',
  'None selected': 'Ничего не выбрано',
  'Northern lights over teal': 'Северное сияние над бирюзой',
  'Not connected': 'Не подключено',
  'Not installed': 'Не установлен',
  'Nothing logged yet.': 'Журнал пока пуст.',
  'Nothing new was imported.': 'Новых узлов не импортировано.',
  Notifications: 'Уведомления',
  'Notify on connect, disconnect, drops and exit-IP changes.':
    'Уведомлять о подключении, отключении, обрывах и смене выходного IP.',
  'Numbers come straight from the running core’s native telemetry. Latency, jitter and loss are measured by real probes; history resets on every reconnect.':
    'Числа берутся напрямую из телеметрии работающего ядра. Задержка, джиттер и потери измеряются реальными пробами; история сбрасывается при каждом переподключении.',
  'OS keyring unavailable': 'Системное хранилище ключей недоступно',
  Off: 'Выкл.',
  'Off rejects IPv6 inside the tunnel so leaks cannot bypass the core.':
    'При выключении IPv6 внутри туннеля отклоняется, чтобы утечки не обходили ядро.',
  Offline: 'Не в сети',
  'One click applies a tested combination of engine, routing, DNS and protection settings. Everything here is a real setting — nothing is cosmetic.':
    'Один щелчок применяет проверенное сочетание настроек движка, маршрутизации, DNS и защиты. Всё здесь — реальные настройки, ничего декоративного.',
  'One click applies engine, routing and protection settings':
    'Один щелчок применяет настройки движка, маршрутизации и защиты',
  'One entry per line or comma-separated · suffix matches cover subdomains, so':
    'По одной записи в строке или через запятую · совпадение по суффиксу покрывает поддомены, поэтому',
  'Open Eaglet': 'Открыть Eaglet',
  'Open dashboard': 'Открыть панель',
  'Open servers': 'Открыть серверы',
  'Open the server list': 'Открыть список серверов',
  PID: 'PID',
  'Packet loss · %': 'Потери пакетов · %',
  'Paste & import': 'Вставить и импортировать',
  'Paste a share link, a subscription URL or a base64 list':
    'Вставьте ссылку, URL подписки или список base64',
  'Paste a subscription URL above. A subscription usually looks like https://provider.example/api/sub/…':
    'Вставьте URL подписки выше. Обычно подписка выглядит так: https://provider.example/api/sub/…',
  'Per-profile engine override': 'Переопределение движка для профиля',
  Performance: 'Производительность',
  'Pin to favourites': 'Закрепить в избранном',
  Ping: 'Пинг',
  'Ping nodes and connect to the fastest': 'Проверить узлы и подключиться к самому быстрому',
  'Pings your nodes in parallel and connects to the fastest one':
    'Проверяет узлы параллельно и подключается к самому быстрому',
  'Pinned node to favourites': 'Узел закреплён в избранном',
  'Pinned resolvers are queried inside the tunnel.':
    'Закреплённые резолверы опрашиваются внутри туннеля.',
  'Planned · {name}': 'Запланировано · {name}',
  'Point WinINet apps at the local mixed inbound while the tunnel is up.':
    'Направлять приложения WinINet на локальный смешанный inbound, пока туннель активен.',
  Preferences: 'Настройки',
  Privacy: 'Приватность',
  'Private addresses and local domains stay direct; everything else is tunnelled. The everyday default.':
    'Частные адреса и локальные домены идут напрямую, всё остальное — через туннель. Повседневный вариант по умолчанию.',
  'Private network': 'Локальная сеть',
  'Probing the tunnel…': 'Проверка туннеля…',
  'Probing…': 'Проверка…',
  Profile: 'Профиль',
  'Profiles of behaviour': 'Профили поведения',
  Protection: 'Защита',
  Protocol: 'Протокол',
  'QR code decoded · {count} node(s) added': 'QR-код распознан · добавлено узлов: {count}',
  'QR import': 'Импорт QR',
  Quality: 'Качество',
  'Queries are sent through the tunnel when a resolver is pinned. Automatic uses the core defaults.':
    'При закреплённом резолвере запросы идут через туннель. «Авто» использует настройки ядра по умолчанию.',
  'Quick connect': 'Быстрое подключение',
  'Quick connect · fastest node {name}{ping}':
    'Быстрое подключение · самый быстрый узел {name}{ping}',
  'Quiet, typographic, precise': 'Тихая, типографская, точная',
  Quit: 'Выйти',
  'Re-check': 'Перепроверить',
  'Re-detect engines': 'Найти движки заново',
  'Re-probe both addresses': 'Проверить оба адреса заново',
  'Read the clipboard in the main process and import it':
    'Прочитать буфер обмена в основном процессе и импортировать',
  Ready: 'Готово',
  'Real checks against the running system': 'Реальные проверки работающей системы',
  'Recent sessions · {count}': 'Недавние сессии · {count}',
  'Refresh HTTP subscriptions in the background so nodes and keys stay current.':
    'Обновлять HTTP-подписки в фоне, чтобы узлы и ключи оставались актуальными.',
  'Refresh all now': 'Обновить всё сейчас',
  Remove: 'Удалить',
  'Remove from favourites': 'Убрать из избранного',
  'Remove node': 'Удалить узел',
  'Remove {name} and its nodes?': 'Удалить {name} и его узлы?',
  'Removed node from favourites': 'Узел убран из избранного',
  'Request failed': 'Запрос не выполнен',
  Resolver: 'Резолвер',
  'Restore backup': 'Восстановить резервную копию',
  'Restores the tunnel-only policy after a drop. Pair it with TUN mode for full coverage.':
    'Восстанавливает политику «только туннель» после обрыва. Сочетайте с режимом TUN для полного покрытия.',
  Retry: 'Повторить',
  'Rollback failed: {error}': 'Откат не удался: {error}',
  'Rolled back to {name}': 'Выполнен возврат к {name}',
  'Routes browsers and desktop apps that honour the OS proxy through 127.0.0.1. WinINet on Windows, networksetup on macOS, GSettings on GNOME.':
    'Направляет браузеры и настольные приложения, соблюдающие системный прокси, через 127.0.0.1. WinINet в Windows, networksetup в macOS, GSettings в GNOME.',
  Routing: 'Маршрутизация',
  'Run a real DoH relay on 127.0.0.1 and point the system resolver at it.':
    'Запускать настоящий DoH-ретранслятор на 127.0.0.1 и направлять на него системный резолвер.',
  'Run diagnostics': 'Запустить диагностику',
  'Run speed test': 'Запустить тест скорости',
  Running: 'Работает',
  'Scenario applied. Reconnect if a tunnel is already running so the new engine and routing take effect.':
    'Сценарий применён. Если туннель уже работает, переподключитесь, чтобы новый движок и маршрутизация вступили в силу.',
  Scenarios: 'Сценарии',
  'Search name, protocol or host…': 'Поиск по имени, протоколу или хосту…',
  'Searching public free-node catalogs…':
    'Поиск в публичных каталогах бесплатных узлов…',
  'Searching…': 'Поиск…',
  'Secret storage:': 'Хранилище секретов:',
  'Select a profile before switching engines': 'Выберите профиль перед сменой движка',
  'Select all': 'Выбрать все',
  'Server strategy': 'Стратегия серверов',
  Servers: 'Серверы',
  Session: 'Сессия',
  'Session data, engine comparisons and diagnostics are stored locally on this machine.':
    'Данные сессий, сравнения движков и диагностика хранятся локально на этом компьютере.',
  'Session history': 'История сессий',
  'Session {duration} · {exit}': 'Сессия {duration} · {exit}',
  Sessions: 'Сессии',
  Settings: 'Настройки',
  'Shrink Eaglet to an always-on-top mini window.':
    'Свернуть Eaglet в мини-окно поверх остальных.',
  'Six interface styles ship with Eaglet. Pick the one that fits your desk.':
    'В Eaglet шесть стилей интерфейса. Выберите подходящий.',
  Smart: 'Умный',
  'Some selected free nodes expired; run the search again':
    'Некоторые выбранные бесплатные узлы устарели; запустите поиск снова',
  'Something went wrong': 'Что-то пошло не так',
  'Speed test': 'Тест скорости',
  'Split tunneling · bypass list': 'Раздельное туннелирование · список исключений',
  'Stable low-latency path, IPv4 only, kill switch armed, TUN capture for games.':
    'Стабильный путь с низкой задержкой, только IPv4, включён Kill Switch, захват TUN для игр.',
  'Standard DNS': 'Обычный DNS',
  Standby: 'Ожидание',
  'Start Eaglet automatically when the computer boots.':
    'Запускать Eaglet автоматически при загрузке компьютера.',
  Started: 'Запущено',
  'Starting Eaglet core…': 'Запуск ядра Eaglet…',
  'Starts a real DNS-over-HTTPS relay on 127.0.0.1:53, backs up the system resolver and restores it on disconnect.':
    'Запускает настоящий DNS-over-HTTPS ретранслятор на 127.0.0.1:53, сохраняет системный резолвер и восстанавливает его при отключении.',
  Stats: 'Статистика',
  'Subscription URL · share link · base64 list':
    'URL подписки · ссылка · список base64',
  'Subscription imported · {count} nodes · {name}':
    'Подписка импортирована · узлов: {count} · {name}',
  'Subscription not found': 'Подписка не найдена',
  'Subscription refresh failed: {message}': 'Не удалось обновить подписку: {message}',
  'Subscription refreshed · {count} nodes · {name}':
    'Подписка обновлена · узлов: {count} · {name}',
  'Subscription request failed ({status})':
    'Запрос подписки не выполнен ({status})',
  'Subscription returned no supported nodes':
    'Подписка не содержит поддерживаемых узлов',
  'Subscription saved · {count} nodes from {name}':
    'Подписка сохранена · узлов: {count} из {name}',
  'Subscription updated · {count} nodes': 'Подписка обновлена · узлов: {count}',
  'Subscription {name} imported · {count} nodes':
    'Подписка {name} импортирована · узлов: {count}',
  'Subscription {name} refreshed · {count} nodes':
    'Подписка {name} обновлена · узлов: {count}',
  Subscriptions: 'Подписки',
  'Switching engine · {from} → {to}': 'Смена движка · {from} → {to}',
  'System proxy': 'Системный прокси',
  'System proxy · ': 'Системный прокси · ',
  'System tray': 'Системный трей',
  'TUN adapter capture itself requires an elevated process':
    'Захват через адаптер TUN требует процесса с повышенными правами',
  'TUN capture': 'Захват TUN',
  'TUN mode': 'Режим TUN',
  'TUN mode is enabled. The next connect will ask the core to create the adapter; make sure Eaglet runs as administrator.':
    'Режим TUN включён. При следующем подключении ядро создаст адаптер; убедитесь, что Eaglet запущен от имени администратора.',
  'TUN mode · ': 'Режим TUN · ',
  'Tap the dial to connect': 'Нажмите на диск, чтобы подключиться',
  Telemetry: 'Телеметрия',
  'Telemetry green on black': 'Зелёная телеметрия на чёрном',
  Test: 'Проверить',
  'Test all': 'Проверить все',
  'Testing…': 'Проверка…',
  'That image could not be read': 'Не удалось прочитать это изображение',
  'That image has no pixels': 'В этом изображении нет пикселей',
  'The catalogs responded, but none of the sampled nodes carried real traffic. Try again in a minute — these lists change constantly.':
    'Каталоги ответили, но ни один из проверенных узлов не передавал реальный трафик. Повторите через минуту — эти списки постоянно меняются.',
  'The core still runs, but traffic bypasses the proxy. Useful for debugging and split setups.':
    'Ядро продолжает работать, но трафик идёт мимо прокси. Полезно для отладки и раздельных схем.',
  'The core stopped unexpectedly': 'Ядро неожиданно остановилось',
  'The sing-box core was unavailable, so these nodes were only port-checked and may not actually carry traffic.':
    'Ядро sing-box было недоступно, поэтому узлы проверены только по портам и могут не передавать трафик.',
  'The subscription did not contain any supported nodes':
    'Подписка не содержала поддерживаемых узлов',
  'The window hides instead of quitting when you press close.':
    'При закрытии окно скрывается, а не завершает работу.',
  'This can take up to two minutes. Each candidate is started in a throwaway sing-box instance to confirm real traffic, so only working nodes are listed.':
    'Это может занять до двух минут. Каждый кандидат запускается в одноразовом экземпляре sing-box для проверки реального трафика, поэтому в список попадают только рабочие узлы.',
  'Throughput · Mbps': 'Пропускная способность · Мбит/с',
  'Traffic is leaving through {exit}.': 'Трафик выходит через {exit}.',
  Tunnel: 'Туннель',
  'Tunnel engines': 'Движки туннеля',
  'Tunnel exit': 'Выход туннеля',
  'Tunnel facts': 'Параметры туннеля',
  'Tunnel up': 'Туннель поднят',
  'Turn off to reject IPv6 inside the tunnel and prevent leaks around the core.':
    'Выключите, чтобы отклонять IPv6 внутри туннеля и предотвращать утечки в обход ядра.',
  Unchanged: 'Без изменений',
  Up: 'Отдача',
  Update: 'Обновить',
  'Update all': 'Обновить всё',
  'Update available · {version}': 'Доступно обновление · {version}',
  'Update interval': 'Интервал обновления',
  'Updates available: {list}': 'Доступны обновления: {list}',
  'Updating…': 'Обновление…',
  Upload: 'Загрузить',
  Uploaded: 'Загружено',
  'Verifying node {current} of {total}': 'Проверка узла {current} из {total}',
  'Version unknown': 'Версия неизвестна',
  'Violet bloom after dark': 'Фиолетовое свечение в темноте',
  'Waiting for a tunnel': 'Ожидание туннеля',
  'Waiting for the first probe': 'Ожидание первого замера',
  'What is this preset for?': 'Для чего этот пресет?',
  'Working…': 'Выполняется…',
  'World map with real node, direct and tunnel exit locations':
    'Карта мира с реальными расположениями узла, прямого подключения и выхода туннеля',
  YOU: 'ВЫ',
  'Your public address changed from': 'Ваш публичный адрес изменился с',
  'also bypasses': 'также обходит',
  armed: 'включён',
  'before tunnel': 'до туннеля',
  connected: 'подключено',
  encrypted: 'зашифровано',
  'engine is not installed': 'движок не установлен',
  entries: 'записей',
  entry: 'запись',
  'https://provider.example/sub/abc  ·  vless://…  ·  ss://…':
    'https://provider.example/sub/abc  ·  vless://…  ·  ss://…',
  'just now': 'только что',
  manual: 'вручную',
  max: 'макс.',
  'measuring…': 'измерение…',
  node: 'узел',
  nodes: 'узлы',
  none: 'нет',
  'not installed': 'не установлен',
  'not probed on this platform': 'не проверяется на этой платформе',
  offline: 'не в сети',
  pending: 'ожидает',
  'requires an elevated process: firewall policy, system DNS override and TUN capture were not exercised':
    'требует процесса с повышенными правами: политика брандмауэра, переопределение системного DNS и захват TUN не проверялись',
  'system proxy': 'системный прокси',
  to: 'на',
  tunnel: 'туннель',
  'tunnel active': 'туннель активен',
  unknown: 'неизвестно',
  'unknown error': 'неизвестная ошибка',
  'unreadable vault': 'хранилище не читается',
  '{avg} ms avg · jitter {jitter} ms · {loss}% loss':
    'среднее {avg} мс · джиттер {jitter} мс · потери {loss}%',
  '{bytes} in {seconds}s · measured at {clock}':
    '{bytes} за {seconds} с · измерено в {clock}',
  '{count} active connections': 'активных соединений: {count}',
  '{count} connections': 'соединений: {count}',
  '{count} failed probes': 'неудачных замеров: {count}',
  '{count} h ago': '{count} ч назад',
  '{count} latency probes': 'замеров задержки: {count}',
  '{count} located nodes': 'узлов на карте: {count}',
  '{count} min ago': '{count} мин назад',
  '{count} node(s) added{updated}': 'добавлено узлов: {count}{updated}',
  '{count} protocols': 'протоколов: {count}',
  '{count} selected': 'выбрано: {count}',
  '{count} subscription(s) refreshed · {nodes} nodes':
    'подписок обновлено: {count} · узлов: {nodes}',
  '{engine} · not installed': '{engine} · не установлен',
  '{from} → {to}': '{from} → {to}',
  '{ip} · {country}': '{ip} · {country}',
  '{mode} routing': 'маршрутизация: {mode}',
  '{name} cannot carry this {protocol} profile':
    '{name} не поддерживает профиль {protocol}',
  '{name} could not establish a tunnel': '{name} не смог установить туннель',
  '{name} detected{version}': '{name} обнаружен{version}',
  '{name} does not support TUN mode': '{name} не поддерживает режим TUN',
  '{name} installed': '{name} установлен',
  '{name} is already running': '{name} уже работает',
  '{name} is not installed in the user data folder':
    '{name} не установлен в папке пользовательских данных',
  '{name} is not installed · it will be downloaded on first connect':
    '{name} не установлен · будет скачан при первом подключении',
  '{name} removed': '{name} удалён',
  '{name} selected · it applies on the next connection':
    '{name} выбран · применится при следующем подключении',
  '{name} · exit {ip}': '{name} · выход {ip}',
  '{name} · {city} {country} · {ping} ms': '{name} · {city} {country} · {ping} мс',
  '{ping} ms': '{ping} мс',
  '{working} working · {reachable} reachable · {found} found in catalogs':
    'рабочих: {working} · доступно: {reachable} · найдено в каталогах: {found}',
  'Could not remove the kill switch: {error}': 'Не удалось снять Kill Switch: {error}',
  'Could not remove the kill-switch firewall rules: {error}':
    'Не удалось удалить правила брандмауэра Kill Switch: {error}',
  'DNS protection could not change the system resolver: {error}':
    'Защита DNS не смогла изменить системный резолвер: {error}',
  'DNS protection could not start: {error}': 'Защита DNS не запустилась: {error}',
  'DNS protection failed ({error}) and the previous resolvers could not be restored ({restore}). The DoH relay stays running so DNS keeps working; disconnect and re-run Eaglet as administrator.':
    'Защита DNS не запустилась ({error}), и прежние резолверы не удалось восстановить ({restore}). DoH-ретранслятор продолжает работать, чтобы DNS не сломался; отключитесь и перезапустите Eaglet от имени администратора.',
  'DNS protection was enabled but the relay did not start · connection aborted to avoid a leak':
    'Защита DNS была включена, но ретранслятор не запустился · подключение прервано, чтобы избежать утечки',
  'Kill switch already armed for this node · policy kept':
    'Kill Switch уже включён для этого узла · политика сохранена',
  'Kill switch cannot protect a direct profile. Choose a tunnel profile or turn protection off.':
    'Kill Switch не может защитить прямой профиль. Выберите туннельный профиль или отключите защиту.',
  'Kill switch could not be armed: {error}': 'Не удалось включить Kill Switch: {error}',
  'Kill switch is not supported on this platform. Turn protection off or use a supported OS.':
    'Kill Switch не поддерживается на этой платформе. Отключите защиту или используйте поддерживаемую ОС.',
  'Kill switch was enabled but could not be armed · connection aborted to avoid a leak':
    'Kill Switch был включён, но не смог активироваться · подключение прервано, чтобы избежать утечки',
  'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.':
    'Политику брандмауэра Windows не удалось полностью восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени администратора, чтобы повторить попытку.',
  'The existing firewall backup is unreadable: {error}. Delete {path} after checking the firewall policy manually.':
    'Существующая резервная копия брандмауэра не читается: {error}. Удалите {path} после ручной проверки политики брандмауэра.',
  'The existing pf backup is unreadable: {error}. Delete {path} after checking pf manually.':
    'Существующая резервная копия pf не читается: {error}. Удалите {path} после ручной проверки pf.',
  'The previous kill-switch policy could not be removed: {error}':
    'Не удалось снять предыдущую политику Kill Switch: {error}',
  'The previous pf state could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.':
    'Прежнее состояние pf не удалось полностью восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени root, чтобы повторить попытку.',
  'The system DNS could not be restored ({error}). The DoH relay stays active so DNS keeps working and the backup is kept for the next launch; disconnect again or restart Eaglet as administrator.':
    'Системный DNS не удалось восстановить ({error}). DoH-ретранслятор остаётся активным, чтобы DNS продолжал работать, а резервная копия сохранена для следующего запуска; отключитесь ещё раз или перезапустите Eaglet от имени администратора.',
  Unsupported: 'Не поддерживается',
  'Windows firewall rejected the kill-switch policy: {error}':
    'Брандмауэр Windows отклонил политику Kill Switch: {error}',
  'Windows rejected the kill-switch policy and the previous outbound policy could not be restored ({error}). The backup is kept at {path}; re-run Eaglet as administrator to retry.':
    'Windows отклонил политику Kill Switch, и прежнюю исходящую политику не удалось восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени администратора, чтобы повторить попытку.',
  'not active': 'не активен',
  'pf rejected the kill-switch rules (run Eaglet as root): {error}':
    'pf отклонил правила Kill Switch (запустите Eaglet от имени root): {error}',
  'pf rejected the kill-switch rules and the previous state could not be restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.':
    'pf отклонил правила Kill Switch, и прежнее состояние не удалось восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени root, чтобы повторить попытку.',
  '{count} kill-switch firewall rules are still present':
    'Правил брандмауэра Kill Switch всё ещё установлено: {count}',
  '{count} kill-switch rules are still present':
    'Правил Kill Switch всё ещё установлено: {count}',
  'Disconnect before switching to another profile':
    'Отключитесь, прежде чем переключаться на другой профиль',
  'Selected {name} · {protocol} · {engine}': 'Выбран {name} · {protocol} · {engine}',
  'Disconnect before switching to another node':
    'Отключитесь, прежде чем переключаться на другой узел',
  'No profile selected. Import a subscription or a share link first.':
    'Профиль не выбран. Сначала импортируйте подписку или ссылку.',
  '{name} cannot carry this profile · using {other}':
    '{name} не поддерживает этот профиль · используется {other}',
  'Connecting · {name} · {protocol}': 'Подключение · {name} · {protocol}',
  'Preparing profile': 'Подготовка профиля',
  'Loading {name} core': 'Загрузка ядра {name}',
  'Core: {name}{version}': 'Ядро: {name}{version}',
  'Building core configuration': 'Сборка конфигурации ядра',
  '{name} configuration validated': 'Конфигурация {name} проверена',
  'Starting encrypted tunnel': 'Запуск зашифрованного туннеля',
  'Verifying exit route': 'Проверка выхода',
  'The tunnel did not respond. Check the profile and try again.':
    'Туннель не отвечает. Проверьте профиль и повторите попытку.',
  'Exit IP changed · {from} → {to}': 'Выходной IP изменился · {from} → {to}',
  'Tunnel live · exit IP {ip}': 'Туннель работает · выходной IP {ip}',
  'Applying system routing': 'Применение системной маршрутизации',
  'System proxy routed through Eaglet ({platform})':
    'Системный прокси направлен через Eaglet ({platform})',
  'System proxy not applied: {error}': 'Системный прокси не применён: {error}',
  'TUN mode active · traffic captured at the adapter level':
    'Режим TUN активен · трафик захватывается на уровне адаптера',
  'Tunnel established · {name} · {engine}': 'Туннель установлен · {name} · {engine}',
  'Unknown connection error': 'Неизвестная ошибка подключения',
  'Kill switch stays armed · direct traffic is still blocked':
    'Kill Switch остаётся включённым · прямой трафик по-прежнему блокируется',
  'Falling back to {name}': 'Используется резервный движок {name}',
  'Kill switch armed · whitelisted {targets}':
    'Kill Switch включён · разрешено: {targets}',
  'loopback and Eaglet only': 'только loopback и Eaglet',
  'DNS protection active · DoH relay {endpoint}':
    'Защита DNS активна · DoH-ретранслятор {endpoint}',
  configured: 'настроен',
  '{name} cannot carry {protocol} · Eaglet will fall back to a compatible core':
    '{name} не поддерживает {protocol} · Eaglet перейдёт на совместимое ядро',
  '{name} pinned to {engine}': '{name} закреплён за {engine}',
  '{name} follows the global engine': '{name} использует глобальный движок',
  'Closing tunnel': 'Закрытие туннеля',
  'Closing the encrypted tunnel': 'Закрытие зашифрованного туннеля',
  'Tunnel closed · protection stays armed until the switch completes':
    'Туннель закрыт · защита остаётся включённой до завершения переключения',
  'Disconnected · direct connection restored':
    'Отключено · прямое соединение восстановлено',
  'Could not restore the system proxy: {error}':
    'Не удалось восстановить системный прокси: {error}',
  'Kill switch active · system proxy kept to block traffic':
    'Kill Switch активен · системный прокси сохранён для блокировки трафика',
  'Kill switch stays armed until the tunnel is restored':
    'Kill Switch остаётся включённым, пока туннель не будет восстановлен',
  'DNS protection stays active while reconnecting':
    'Защита DNS остаётся активной во время переподключения',
  'Core stopped unexpectedly (exit {code})':
    'Ядро неожиданно остановилось (код выхода {code})',
  'Unknown node': 'Неизвестный узел',
  'Auto-reconnect gave up after 3 attempts':
    'Автопереподключение прекращено после 3 попыток',
  'Protection stays armed after the failed reconnects · disconnect to restore direct access':
    'Защита остаётся включённой после неудачных переподключений · отключитесь, чтобы вернуть прямой доступ',
  'Auto-reconnect {attempt}/3 in {seconds}s':
    'Автопереподключение {attempt}/3 через {seconds} с',
  'Auto-reconnect restored the tunnel': 'Автопереподключение восстановило туннель',
  'IP check · direct {direct} · exit {exit}':
    'Проверка IP · прямой {direct} · выходной {exit}',
  'IP check failed: {error}': 'Проверка IP не удалась: {error}',
  'Latency tests are unavailable while the kill switch is armed — disconnect to measure nodes':
    'Проверка задержки недоступна, пока включён Kill Switch — отключитесь, чтобы измерить узлы',
  'Latency test finished · {count} profiles · {located} located':
    'Проверка задержки завершена · профилей: {count} · определено на карте: {located}',
  'Latency test finished · {count} profiles':
    'Проверка задержки завершена · профилей: {count}',
  'Session healthy · {ping} ms · {connections} connections · {loss}% loss':
    'Сессия стабильна · {ping} мс · соединений: {connections} · потери {loss}%',
  'Connect to a tunnel before running a speed test':
    'Подключитесь к туннелю перед запуском теста скорости',
  'Speed test · downloading 10 MB through the tunnel':
    'Тест скорости · скачивание 10 МБ через туннель',
  'Speed test · {mbps} Mbps · {size} MB in {seconds}s':
    'Тест скорости · {mbps} Мбит/с · {size} МБ за {seconds} с',
  'System proxy {state} for the next session':
    'Системный прокси {state} для следующей сессии',
  enabled: 'включён',
  disabled: 'выключен',
  'System proxy enabled': 'Системный прокси включён',
  'System proxy disabled · apps go direct':
    'Системный прокси выключен · приложения идут напрямую',
  'System proxy change failed: {error}':
    'Не удалось изменить системный прокси: {error}',
  'Scenario not found': 'Сценарий не найден',
  'Scenario applied: {name}': 'Сценарий применён: {name}',
  'Scenario server selection: {error}': 'Выбор сервера для сценария: {error}',
  'Scenario «{name}» applied · {engine} · {mode} routing · reconnect to use it':
    'Сценарий «{name}» применён · {engine} · маршрутизация: {mode} · переподключитесь, чтобы использовать его',
  'Scenario «{name}» applied · {engine} · {mode} routing':
    'Сценарий «{name}» применён · {engine} · маршрутизация: {mode}',
  'Settings changed; the live tunnel still uses the previous configuration':
    'Настройки изменены; активный туннель всё ещё использует прежнюю конфигурацию',
  'Scenario saved · {name}': 'Сценарий сохранён · {name}',
  'Select a profile before exporting a configuration':
    'Выберите профиль перед экспортом конфигурации',
  'Select a profile before validating an engine configuration':
    'Выберите профиль перед проверкой конфигурации движка',
  'configuration accepted by the core': 'конфигурация принята ядром',
  'TUN preparation is only implemented on Windows':
    'Подготовка TUN реализована только в Windows',
  'Select a profile before preparing TUN mode':
    'Выберите профиль перед подготовкой режима TUN',
  '{name} does not support TUN': '{name} не поддерживает TUN',
  '{name} binary': 'Исполняемый файл {name}',
  'Not installed — connect once to download it':
    'Не установлен — подключитесь один раз, чтобы скачать',
  'Engine version': 'Версия движка',
  'Version could not be read': 'Не удалось определить версию',
  'Validated configuration': 'Проверенная конфигурация',
  'No configuration generated yet': 'Конфигурация ещё не создана',
  'Applications are pointed at 127.0.0.1':
    'Приложения направлены на 127.0.0.1',
  'Enabled in settings but not applied to the OS':
    'Включено в настройках, но не применено в системе',
  'Applied on the next connection': 'Применится при следующем подключении',
  'Supported by {name}; needs an administrator session':
    'Поддерживается {name}; нужна сессия администратора',
  '{name} has no TUN implementation': 'У {name} нет реализации TUN',
  'OS firewall policy is armed': 'Политика брандмауэра ОС включена',
  'Not armed (disconnected or elevation denied)':
    'Не включён (нет подключения или отказано в повышении прав)',
  'No implementation for this platform': 'Для этой платформы реализации нет',
  'Local DoH relay active · {queries} queries · {failures} failures':
    'Локальный DoH-ретранслятор активен · запросов: {queries} · ошибок: {failures}',
  'Relay not running; system DNS is unchanged':
    'Ретранслятор не работает; системный DNS не изменён',
  'DNS resolution': 'Разрешение DNS',
  'example.com resolved': 'example.com разрешён',
  'Exit address': 'Выходной адрес',
  'Tunnel did not return an address': 'Туннель не вернул адрес',
  '{ping} ms · jitter {jitter} ms': '{ping} мс · джиттер {jitter} мс',
  'No successful probe yet': 'Успешных замеров пока нет',
  'Packet loss': 'Потери пакетов',
  '{loss}% over the last {count} probes':
    '{loss}% за последние замеры ({count})',
  'Subscription freshness': 'Актуальность подписок',
  'No stale HTTP subscriptions': 'Устаревших HTTP-подписок нет',
  '{count} subscription(s) older than {hours}h':
    'Подписок старше {hours} ч: {count}',
  'Engine updates': 'Обновления движков',
  'Platform support': 'Поддержка платформы',
  '{platform} · supported and tested path':
    '{platform} · поддерживаемый и проверенный путь',
  '{platform} · experimental, not part of the verified matrix':
    '{platform} · экспериментально, вне проверенной матрицы',
  '{failed} problem(s), {warned} warning(s)':
    'Проблем: {failed}, предупреждений: {warned}',
  'Healthy with {count} warning(s)': 'Работает, предупреждений: {count}',
  'All checks passed': 'Все проверки пройдены',
  'Backups can contain connection secrets': 'Резервные копии могут содержать секреты подключений',
  Cancel: 'Отмена',
  'Configuration restored from a backup': 'Конфигурация восстановлена из резервной копии',
  'Export Eaglet backup': 'Экспорт резервной копии Eaglet',
  'Export configuration': 'Экспортировать конфигурацию',
  'Export core configuration': 'Экспорт конфигурации ядра',
  'Export with secrets': 'Экспортировать с секретами',
  'Export without secrets': 'Экспортировать без секретов',
  'Export without secrets keeps your settings and server list, but the profiles must be re-imported before they can connect.':
    'Экспорт без секретов сохранит настройки и список серверов, но профили придётся импортировать заново, прежде чем они смогут подключаться.',
  'Export {engine} configuration': 'Экспорт конфигурации {engine}',
  Images: 'Изображения',
  'Import Eaglet backup': 'Импорт резервной копии Eaglet',
  'Import a QR code from an image': 'Импорт QR-кода из изображения',
  'No image selected': 'Изображение не выбрано',
  'Routing changes apply on the next connection':
    'Изменения маршрутизации применяются при следующем подключении',
  'Share links and subscription URLs may contain passwords and access tokens. Exporting them writes those secrets to the chosen file in readable form.':
    'Ссылки и URL подписок могут содержать пароли и токены доступа. При экспорте эти секреты записываются в выбранный файл в читаемом виде.',
  'That file is not an Eaglet backup': 'Этот файл не является резервной копией Eaglet',
  'The native core configuration includes the node UUID/password and any TLS secrets needed to connect. Anyone who can read the exported file can use those credentials. Store it securely and delete it when it is no longer needed.':
    'Конфигурация ядра содержит UUID/пароль узла и все TLS-секреты, необходимые для подключения. Любой, кто прочитает экспортированный файл, сможет использовать эти данные. Храните файл в защищённом месте и удалите его, когда он больше не нужен.',
  'This configuration contains credentials in plaintext':
    'Эта конфигурация содержит учётные данные в открытом виде',
  'Warning: the OS keyring is not protecting secrets in this profile; they are already stored in config.json without encryption.':
    'Внимание: системное хранилище ключей не защищает секреты в этом профиле; они уже хранятся в config.json без шифрования.',
  'Backup imported · {count} profiles':
    'Резервная копия импортирована · профилей: {count}',
  'Backup contained plaintext secrets; they were moved into the encrypted vault':
    'Резервная копия содержала секреты в открытом виде; они перенесены в зашифрованное хранилище',
  'Backup contained plaintext secrets and the OS keyring is unavailable; they remain in config.json without encryption':
    'Резервная копия содержала секреты в открытом виде, а системное хранилище ключей недоступно; они остались в config.json без шифрования',
  'Backup exported with plaintext secrets · {count} profiles':
    'Резервная копия экспортирована с секретами в открытом виде · профилей: {count}',
  'Backup exported without secrets · {count} profiles':
    'Резервная копия экспортирована без секретов · профилей: {count}',
  'Could not verify the Authenticode signature of {label}: {error}':
    'Не удалось проверить подпись Authenticode для {label}: {error}',
  '{label} failed Authenticode verification ({status})':
    'Проверка Authenticode для {label} не пройдена ({status})',
  '{name} rejected the config': '{name} отклонил конфигурацию',
  'GitHub release lookup failed ({status})':
    'Не удалось получить релиз с GitHub ({status})',
  'Downloading {name}…': 'Скачивание {name}…',
  'No {name} build found for {platform}/{arch}':
    'Не найдена сборка {name} для {platform}/{arch}',
  '{name} download failed ({status})': 'Не удалось скачать {name} ({status})',
  'No SHA-256 checksum was published for {name}; refusing to install an unverified core':
    'Для {name} не опубликована контрольная сумма SHA-256; установка непроверенного ядра отменена',
  '{name} failed SHA-256 verification (expected {expected}, got {actual})':
    'Проверка SHA-256 для {name} не пройдена (ожидалось {expected}, получено {actual})',
  '{name} archive verified · SHA-256 {hash}…':
    'Архив {name} проверен · SHA-256 {hash}…',
  '{name} archive did not contain an executable':
    'В архиве {name} не найден исполняемый файл',
  '{name} archive did not contain {file}': 'В архиве {name} не найден {file}',
  '{name} installed · {version}': '{name} установлен · {version}',
  'Downloading wintun.dll for TUN mode…':
    'Скачивание wintun.dll для режима TUN…',
  'wintun.dll download failed ({status})': 'Не удалось скачать wintun.dll ({status})',
  'wintun.dll archive failed integrity verification (SHA-256 {hash})':
    'Архив wintun.dll не прошёл проверку целостности (SHA-256 {hash})',
  'The wintun archive did not contain wintun.dll':
    'В архиве wintun не найден wintun.dll',
  'wintun.dll ready · TUN capture available':
    'wintun.dll готов · захват TUN доступен',
  '{name} staged next to wintun.dll': '{name} размещён рядом с wintun.dll',
  '{name} is bundled with Eaglet and cannot be removed from the app folder':
    '{name} входит в комплект Eaglet и не может быть удалён из папки приложения',
  'Kill switch is not implemented on this platform':
    'Kill Switch не реализован на этой платформе',
  'A kill switch cannot protect a direct connection':
    'Kill Switch не может защитить прямое соединение',
  'The node address could not be resolved; the kill switch was not armed':
    'Не удалось определить адрес узла; Kill Switch не включён',
  'DNS protection requires an https:// DoH endpoint':
    'Для защиты DNS нужен DoH-эндпоинт https://',
  'The DoH endpoint has no hostname': 'У DoH-эндпоинта нет имени хоста',
  'The DoH endpoint has an invalid port': 'У DoH-эндпоинта неверный порт',
  'The DoH endpoint {host} could not be resolved':
    'Не удалось определить адрес DoH-эндпоинта {host}',
  'PowerShell returned no adapter information':
    'PowerShell не вернул сведения об адаптерах',
  'No active network adapter was found': 'Активный сетевой адаптер не найден',
  'No network services were found': 'Сетевые службы не найдены',
  'Could not determine the default network interface':
    'Не удалось определить сетевой интерфейс по умолчанию',
  'DNS protection is not implemented on this platform':
    'Защита DNS не реализована на этой платформе',
  'System proxy is not implemented on {platform}':
    'Системный прокси не реализован на платформе {platform}',
  'The clipboard is empty. Copy a subscription URL or a share link first.':
    'Буфер обмена пуст. Сначала скопируйте URL подписки или ссылку.',
  'Profile not found': 'Профиль не найден',
  'The share link for this profile is unavailable — re-import it or unlock the OS keyring':
    'Ссылка для этого профиля недоступна — импортируйте его заново или разблокируйте системное хранилище ключей',
  'No working public nodes found': 'Рабочие публичные узлы не найдены',
  'Could not create a direct profile': 'Не удалось создать прямой профиль',
  'Direct profile missing': 'Прямой профиль отсутствует',
  'The secret vault is not valid JSON: {error}':
    'Хранилище секретов содержит некорректный JSON: {error}',
  'The OS keyring is unavailable, so the encrypted vault cannot be opened':
    'Системное хранилище ключей недоступно, поэтому зашифрованное хранилище нельзя открыть',
  'The secret vault uses the legacy base64 format and is not encrypted':
    'Хранилище секретов использует устаревший формат base64 и не зашифровано',
  'The secret vault could not be decrypted: {error}':
    'Не удалось расшифровать хранилище секретов: {error}',
  'The legacy vault could not be re-encrypted: {error}':
    'Не удалось повторно зашифровать старое хранилище: {error}',
  'The encrypted secret vault could not be opened this launch; refusing to overwrite it':
    'Зашифрованное хранилище секретов не удалось открыть при этом запуске; перезапись отменена',
  'The encrypted secret vault could not be read; refusing to overwrite it':
    'Зашифрованное хранилище секретов не удалось прочитать; перезапись отменена',
  'No OS keyring is available; refusing to store secrets without encryption':
    'Системное хранилище ключей недоступно; хранение секретов без шифрования отменено',
  'The OS keyring rejected the encryption request: {error}':
    'Системное хранилище ключей отклонило запрос на шифрование: {error}',
  'DNS protection needs UDP/TCP port 53 on the loopback interface: {error}':
    'Для защиты DNS нужен UDP/TCP-порт 53 на loopback-интерфейсе: {error}',
  '{name}: still points at the local relay':
    '{name}: по-прежнему указывает на локальный ретранслятор',
  '{name}: IPv4 resolvers differ': '{name}: IPv4-резолверы отличаются',
  '{name}: IPv6 resolvers differ': '{name}: IPv6-резолверы отличаются',
  'Session history cleared': 'История сессий очищена',
  'Subscription removed': 'Подписка удалена',
  'Subscription {name} removed': 'Подписка {name} удалена',
  'Node removed': 'Узел удалён',
  'Node {name} removed': 'Узел {name} удалён',
  'Speed test failed: {error}': 'Тест скорости не удался: {error}',
  'Engine update check failed: {error}':
    'Не удалось проверить обновления движков: {error}',
  'Engine install failed: {error}': 'Не удалось установить движок: {error}',
  'Engine removal failed: {error}': 'Не удалось удалить движок: {error}',
  'Scenario failed: {error}': 'Сценарий не выполнен: {error}',
  'Scenario save failed: {error}': 'Не удалось сохранить сценарий: {error}',
  disconnected: 'отключено',
  connecting: 'подключение',
  disconnecting: 'отключение',
  error: 'ошибка',
  '{engine} configuration exported': 'Конфигурация {engine} экспортирована',
  'Firewall profile state could not be read from PowerShell':
    'Не удалось прочитать состояние профилей брандмауэра из PowerShell',
  'kill-switch-backup.json is malformed':
    'Файл kill-switch-backup.json повреждён',
  'default outbound action is still Allow for {profiles}':
    'исходящее действие по умолчанию всё ещё Allow для {profiles}',
  'the kill-switch rules are missing after the script completed':
    'правила Kill Switch отсутствуют после завершения скрипта',
  'The speed test did not receive enough data — try again':
    'Тест скорости получил недостаточно данных — повторите попытку',
  "Public nodes are run by unknown people. Don't sign in to banking, work or other sensitive accounts while using them — treat this as a quick way to test the tunnel, not as a trustworthy provider.":
    'Публичные узлы принадлежат неизвестным людям. Не входите в банковские, рабочие и другие чувствительные аккаунты, пока пользуетесь ими — считайте это быстрым способом проверить туннель, а не надёжным провайдером.',
  'Save scenario': 'Сохранить сценарий',
  'Saving…': 'Сохранение…',
  'The OS keyring is unavailable. Connection links are kept in config.json without encryption until a keyring is available.':
    'Системное хранилище ключей недоступно. Ссылки подключений хранятся в config.json без шифрования, пока хранилище не станет доступно.',
  'The encrypted secret vault could not be decrypted. Profiles are preserved, but their share links must be re-imported. The vault file was not modified.':
    'Зашифрованное хранилище секретов не удалось расшифровать. Профили сохранены, но их ссылки нужно импортировать заново. Файл хранилища не изменён.',
  '{count} connection secret(s) are written to config.json in plaintext.':
    'Секретов подключений записано в config.json в открытом виде: {count}.',
  'TUN and system proxy are mutually exclusive — Eaglet uses TUN when both are enabled.':
    'TUN и системный прокси взаимоисключающие — при включении обоих Eaglet использует TUN.',
  'Kill switch could not be fully disabled': 'Kill Switch не удалось полностью отключить',
  'System DNS restore verification failed, backup preserved for retry': 'Проверка восстановления системного DNS не удалась, резервная копия сохранена для повторной попытки',
  'Linux kill switch was not armed': 'Linux Kill Switch не удалось включить',
  'Kill switch is not implemented on this platform': 'Kill Switch не реализован на этой платформе',
  'A kill switch cannot protect a direct connection': 'Kill Switch не может защитить прямое соединение',
  'The node address could not be resolved; the kill switch was not armed': 'Не удалось определить адрес узла; Kill Switch не включён',
  'DNS protection needs UDP/TCP port 53 on the loopback interface: {error}':
    'Для защиты DNS нужен UDP/TCP-порт 53 на loopback-интерфейсе: {error}',
  'The DoH endpoint {host} could not be resolved': 'Не удалось определить адрес DoH-эндпоинта {host}',
  'PowerShell returned no adapter information': 'PowerShell не вернул сведения об адаптерах',
  'No active network adapter was found': 'Активный сетевой адаптер не найден',
  'No network services were found': 'Сетевые службы не найдены',
  'Could not determine the default network interface': 'Не удалось определить сетевой интерфейс по умолчанию',
  'Firewall profile state could not be read from PowerShell': 'Не удалось прочитать состояние профилей брандмауэра из PowerShell',
  'kill-switch-backup.json is malformed': 'Файл kill-switch-backup.json повреждён',
  'default outbound action is still Allow for {profiles}':
    'исходящее действие по умолчанию всё ещё Allow для {profiles}',
  'the kill-switch rules are missing after the script completed':
    'правила Kill Switch отсутствуют после завершения скрипта',
  'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.':
    'Политику брандмауэра Windows не удалось полностью восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени администратора, чтобы повторить попытку.',
  'The existing firewall backup is unreadable: {error}. Delete {path} after checking the firewall policy manually.':
    'Существующая резервная копия брандмауэра не читается: {error}. Удалите {path} после ручной проверки политики брандмауэра.',
  'The existing pf backup is unreadable: {error}. Delete {path} after checking pf manually.':
    'Существующая резервная копия pf не читается: {error}. Удалите {path} после ручной проверки pf.',
  'The previous kill-switch policy could not be removed: {error}':
    'Не удалось снять предыдущую политику Kill Switch: {error}',
  'The previous pf state could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.':
    'Прежнее состояние pf не удалось полностью восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени root, чтобы повторить попытку.',
  'The system DNS could not be restored ({error}). The DoH relay stays active so DNS keeps working and the backup is kept for the next launch; disconnect again or restart Eaglet as administrator.':
    'Системный DNS не удалось восстановить ({error}). DoH-ретранслятор остаётся активным, чтобы DNS продолжал работать, а резервная копия сохранена для следующего запуска; отключитесь ещё раз или перезапустите Eaglet от имени администратора.',
  'Could not remove the kill-switch firewall rules: {error}':
    'Не удалось удалить правила брандмауэра Kill Switch: {error}',
  '{count} kill-switch firewall rules are still present':
    'Правил брандмауэра Kill Switch всё ещё установлено: {count}',
  'Windows firewall rejected the kill-switch policy: {error}':
    'Брандмауэр Windows отклонил политику Kill Switch: {error}',
  'Windows rejected the kill-switch policy and the previous outbound policy could not be restored ({error}). The backup is kept at {path}; re-run Eaglet as administrator to retry.':
    'Windows отклонил политику Kill Switch, и прежнюю исходящую политику не удалось восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени администратора, чтобы повторить попытку.',
  'pf rejected the kill-switch rules (run Eaglet as root): {error}':
    'pf отклонил правила Kill Switch (запустите Eaglet от имени root): {error}',
  'pf rejected the kill-switch rules and the previous state could not be restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.':
    'pf отклонил правила Kill Switch, и прежнее состояние не удалось восстановить ({error}). Резервная копия сохранена в {path}; запустите Eaglet от имени root, чтобы повторить попытку.',
  '{count} kill-switch rules are still present':
    'Правил Kill Switch всё ещё установлено: {count}',
  'Disconnect before switching to another profile': 'Отключитесь, прежде чем переключаться на другой профиль',
  'Selected {name} · {protocol} · {engine}': 'Выбран {name} · {protocol} · {engine}',
  'Disconnect before switching to another node': 'Отключитесь, прежде чем переключаться на другой узел',
  'No profile selected. Import a subscription or a share link first.':
    'Профиль не выбран. Сначала импортируйте подписку или ссылку.',
  '{name} cannot carry this profile · using {other}':
    '{name} не поддерживает этот профиль · используется {other}',
  'Connecting · {name} · {protocol}': 'Подключение · {name} · {protocol}',
  'Preparing profile': 'Подготовка профиля',
  'Loading {name} core': 'Загрузка ядра {name}',
  'Core: {name}{version}': 'Ядро: {name}{version}',
  'Building core configuration': 'Сборка конфигурации ядра',
  '{name} configuration validated': 'Конфигурация {name} проверена',
  'Starting encrypted tunnel': 'Запуск зашифрованного туннеля',
  'Verifying exit route': 'Проверка выхода',
  'The tunnel did not respond. Check the profile and try again.':
    'Туннель не отвечает. Проверьте профиль и повторите попытку.',
  'Exit IP changed · {from} → {to}': 'Выходной IP изменился · {from} → {to}',
  'Tunnel live · exit IP {ip}': 'Туннель работает · выходной IP {ip}',
  'Applying system routing': 'Применение системной маршрутизации',
  'System proxy routed through Eaglet ({platform})':
    'Системный прокси направлен через Eaglet ({platform})',
  'System proxy not applied: {error}': 'Системный прокси не применён: {error}',
  'TUN mode active · traffic captured at the adapter level':
    'Режим TUN активен · трафик захватывается на уровне адаптера',
  'Tunnel established · {name} · {engine}': 'Туннель установлен · {name} · {engine}',
  'Unknown connection error': 'Неизвестная ошибка подключения',
  'Kill switch stays armed · direct traffic is still blocked':
    'Kill Switch остаётся включённым · прямой трафик по-прежнему блокируется',
  'Falling back to {name}': 'Используется резервный движок {name}',
  'Kill switch armed · whitelisted {targets}':
    'Kill Switch включён · разрешено: {targets}',
  'loopback and Eaglet only': 'только loopback и Eaglet',
  'DNS protection active · DoH relay {endpoint}':
    'Защита DNS активна · DoH-ретранслятор {endpoint}',
  configured: 'настроен',
  '{name} cannot carry {protocol} · Eaglet will fall back to a compatible core':
    '{name} не поддерживает {protocol} · Eaglet перейдёт на совместимое ядро',
  '{name} pinned to {engine}': '{name} закреплён за {engine}',
  '{name} follows the global engine': '{name} использует глобальный движок',
  'Closing tunnel': 'Закрытие туннеля',
  'Closing the encrypted tunnel': 'Закрытие зашифрованного туннеля',
  'Tunnel closed · protection stays armed until the switch completes':
    'Туннель закрыт · защита остаётся включённой до завершения переключения',
  'Disconnected · direct connection restored':
    'Отключено · прямое соединение восстановлено',
  'Could not restore the system proxy: {error}':
    'Не удалось восстановить системный прокси: {error}',
  'Kill switch active · system proxy kept to block traffic':
    'Kill Switch активен · системный прокси сохранён для блокировки трафика',
  'Kill switch stays armed until the tunnel is restored':
    'Kill Switch остаётся включённым, пока туннель не будет восстановлен',
  'DNS protection stays active while reconnecting':
    'Защита DNS остаётся активной во время переподключения',
  'Core stopped unexpectedly (exit {code})':
    'Ядро неожиданно остановилось (код выхода {code})',
  'Unknown node': 'Неизвестный узел',
  'Auto-reconnect gave up after 3 attempts':
    'Автопереподключение прекращено после 3 попыток',
  'Protection stays armed after the failed reconnects · disconnect to restore direct access':
    'Защита остаётся включённой после неудачных переподключений · отключитесь, чтобы вернуть прямой доступ',
  'Auto-reconnect {attempt}/3 in {seconds}s':
    'Автопереподключение {attempt}/3 через {seconds} с',
  'Auto-reconnect restored the tunnel': 'Автопереподключение восстановило туннель',
  'IP check · direct {direct} · exit {exit}':
    'Проверка IP · прямой {direct} · выходной {exit}',
  'IP check failed: {error}': 'Проверка IP не удалась: {error}',
  'Latency tests are unavailable while the kill switch is armed — disconnect to measure nodes':
    'Проверка задержки недоступна, пока включён Kill Switch — отключитесь, чтобы измерить узлы',
  'Latency test finished · {count} profiles · {located} located':
    'Проверка задержки завершена · профилей: {count} · определено на карте: {located}',
  'Latency test finished · {count} profiles':
    'Проверка задержки завершена · профилей: {count}',
  'Session healthy · {ping} ms · {connections} connections · {loss}% loss':
    'Сессия стабильна · {ping} мс · соединений: {connections} · потери {loss}%',
  'Connect to a tunnel before running a speed test':
    'Подключитесь к туннелю перед запуском теста скорости',
  'Speed test · downloading 10 MB through the tunnel':
    'Тест скорости · скачивание 10 МБ через туннель',
  'Speed test · {mbps} Mbps · {size} MB in {seconds}s':
    'Тест скорости · {mbps} Мбит/с · {size} МБ за {seconds} с',
  'System proxy {state} for the next session':
    'Системный прокси {state} для следующей сессии',
  enabled: 'включён',
  disabled: 'выключен',
  'System proxy enabled': 'Системный прокси включён',
  'System proxy disabled · apps go direct':
    'Системный прокси выключен · приложения идут напрямую',
  'System proxy change failed: {error}':
    'Не удалось изменить системный прокси: {error}',
  'Scenario not found': 'Сценарий не найден',
  'Scenario applied: {name}': 'Сценарий применён: {name}',
  'Scenario server selection: {error}': 'Выбор сервера для сценария: {error}',
  'Scenario «{name}» applied · {engine} · {mode} routing · reconnect to use it':
    'Сценарий «{name}» применён · {engine} · маршрутизация: {mode} · переподключитесь, чтобы использовать его',
  'Scenario «{name}» applied · {engine} · {mode} routing':
    'Сценарий «{name}» применён · {engine} · маршрутизация: {mode}',
  'Settings changed; the live tunnel still uses the previous configuration':
    'Настройки изменены; активный туннель всё ещё использует прежнюю конфигурацию',
  'Scenario saved · {name}': 'Сценарий сохранён · {name}',
  'Select a profile before exporting a configuration':
    'Выберите профиль перед экспортом конфигурации',
  'Select a profile before validating an engine configuration':
    'Выберите профиль перед проверкой конфигурации движка',
  'configuration accepted by the core': 'конфигурация принята ядром',
  'TUN preparation is only implemented on Windows':
    'Подготовка TUN реализована только в Windows',
  'Select a profile before preparing TUN mode':
    'Выберите профиль перед подготовкой режима TUN',
  '{name} does not support TUN': '{name} не поддерживает TUN',
  '{name} binary': 'Исполняемый файл {name}',
  'Not installed — connect once to download it':
    'Не установлен — подключитесь один раз, чтобы скачать',
  'Engine version': 'Версия движка',
  'Version could not be read': 'Не удалось определить версию',
  'Validated configuration': 'Проверенная конфигурация',
  'No configuration generated yet': 'Конфигурация ещё не создана',
  'Applications are pointed at 127.0.0.1':
    'Приложения направлены на 127.0.0.1',
  'Enabled in settings but not applied to the OS':
    'Включено в настройках, но не применено в системе',
  'Applied on the next connection': 'Применится при следующем подключении',
  'Supported by {name}; needs an administrator session':
    'Поддерживается {name}; нужна сессия администратора',
  '{name} has no TUN implementation': 'У {name} нет реализации TUN',
  'OS firewall policy is armed': 'Политика брандмауэра ОС включена',
  'Not armed (disconnected or elevation denied)':
    'Не включён (нет подключения или отказано в повышении прав)',
  'No implementation for this platform': 'Для этой платформы реализации нет',
  'Local DoH relay active · {queries} queries · {failures} failures':
    'Локальный DoH-ретранслятор активен · запросов: {queries} · ошибок: {failures}',
  'Relay not running; system DNS is unchanged':
    'Ретранслятор не работает; системный DNS не изменён',
  'DNS resolution': 'Разрешение DNS',
  'example.com resolved': 'example.com разрешён',
  'Exit address': 'Выходной адрес',
  'Tunnel did not return an address': 'Туннель не вернул адрес',
  '{ping} ms · jitter {jitter} ms': '{ping} мс · джиттер {jitter} мс',
  'No successful probe yet': 'Успешных замеров пока нет',
  'Packet loss': 'Потери пакетов',
  '{loss}% over the last {count} probes':
    '{loss}% за последние замеры ({count})',
  'Subscription freshness': 'Актуальность подписок',
  'No stale HTTP subscriptions': 'Устаревших HTTP-подписок нет',
  '{count} subscription(s) older than {hours}h':
    'Подписок старше {hours} ч: {count}',
  'Engine updates': 'Обновления движков',
  'Platform support': 'Поддержка платформы',
  '{platform} · supported and tested path':
    '{platform} · поддерживаемый и проверенный путь',
  '{platform} · experimental, not part of the verified matrix':
    '{platform} · экспериментально, вне проверенной матрицы',
  '{failed} problem(s), {warned} warning(s)':
    'Проблем: {failed}, предупреждений: {warned}',
  'Healthy with {count} warning(s)': 'Работает, предупреждений: {count}',
  'All checks passed': 'Все проверки пройдены',
  'Backups can contain connection secrets': 'Резервные копии могут содержать секреты подключений',
  Cancel: 'Отмена',
  'Configuration restored from a backup': 'Конфигурация восстановлена из резервной копии',
  'Export Eaglet backup': 'Экспорт резервной копии Eaglet',
  'Export configuration': 'Экспортировать конфигурацию',
  'Export core configuration': 'Экспорт конфигурации ядра',
  'Export with secrets': 'Экспортировать с секретами',
  'Export without secrets': 'Экспортировать без секретов',
  'Export without secrets keeps your settings and server list, but the profiles must be re-imported before they can connect.':
    'Экспорт без секретов сохранит настройки и список серверов, но профили придётся импортировать заново, прежде чем они смогут подключаться.',
  'Export {engine} configuration': 'Экспорт конфигурации {engine}',
  Images: 'Изображения',
  'Import Eaglet backup': 'Импорт резервной копии Eaglet',
  'Import a QR code from an image': 'Импорт QR-кода из изображения',
  'No image selected': 'Изображение не выбрано',
  'Routing changes apply on the next connection':
    'Изменения маршрутизации применяются при следующем подключении',
  'Share links and subscription URLs may contain passwords and access tokens. Exporting them writes those secrets to the chosen file in readable form.':
    'Ссылки и URL подписок могут содержать пароли и токены доступа. При экспорте эти секреты записываются в выбранный файл в читаемом виде.',
  'That file is not an Eaglet backup': 'Этот файл не является резервной копией Eaglet',
  'The native core configuration includes the node UUID/password and any TLS secrets needed to connect. Anyone who can read the exported file can use those credentials. Store it securely and delete it when it is no longer needed.':
    'Конфигурация ядра содержит UUID/пароль узла и все TLS-секреты, необходимые для подключения. Любой, кто прочитает экспортированный файл, сможет использовать эти данные. Храните файл в защищённом месте и удалите его, когда он больше не нужен.',
  'This configuration contains credentials in plaintext':
    'Эта конфигурация содержит учётные данные в открытом виде',
  'Warning: the OS keyring is not protecting secrets in this profile; they are already stored in config.json without encryption.':
    'Внимание: системное хранилище ключей не защищает секреты в этом профиле; они уже хранятся в config.json без шифрования.',
  'Backup imported · {count} profiles':
    'Резервная копия импортирована · профилей: {count}',
  'Backup contained plaintext secrets; they were moved into the encrypted vault':
    'Резервная копия содержала секреты в открытом виде; они перенесены в зашифрованное хранилище',
  'Backup contained plaintext secrets and the OS keyring is unavailable; they remain in config.json without encryption':
    'Резервная копия содержала секреты в открытом виде, а системное хранилище ключей недоступно; они остались в config.json без шифрования',
  'Backup exported with plaintext secrets · {count} profiles':
    'Резервная копия экспортирована с секретами в открытом виде · профилей: {count}',
  'Backup exported without secrets · {count} profiles':
    'Резервная копия экспортирована без секретов · профилей: {count}',
  'Could not verify the Authenticode signature of {label}: {error}':
    'Не удалось проверить подпись Authenticode для {label}: {error}',
  '{label} failed Authenticode verification ({status})':
    'Проверка Authenticode для {label} не пройдена ({status})',
  '{name} rejected the config': '{name} отклонил конфигурацию',
  'GitHub release lookup failed ({status})':
    'Не удалось получить релиз с GitHub ({status})',
  'Downloading {name}…': 'Скачивание {name}…',
  'No {name} build found for {platform}/{arch}':
    'Не найдена сборка {name} для {platform}/{arch}',
  '{name} download failed ({status})': 'Не удалось скачать {name} ({status})',
  'No SHA-256 checksum was published for {name}; refusing to install an unverified core':
    'Для {name} не опубликована контрольная сумма SHA-256; установка непроверенного ядра отменена',
  '{name} failed SHA-256 verification (expected {expected}, got {actual})':
    'Проверка SHA-256 для {name} не пройдена (ожидалось {expected}, получено {actual})',
  '{name} archive verified · SHA-256 {hash}…':
    'Архив {name} проверен · SHA-256 {hash}…',
  '{name} archive did not contain an executable':
    'В архиве {name} не найден исполняемый файл',
  '{name} archive did not contain {file}': 'В архиве {name} не найден {file}',
  '{name} installed · {version}': '{name} установлен · {version}',
  'Downloading wintun.dll for TUN mode…':
    'Скачивание wintun.dll для режима TUN…',
  'wintun.dll download failed ({status})': 'Не удалось скачать wintun.dll ({status})',
  'wintun.dll archive failed integrity verification (SHA-256 {hash})':
    'Архив wintun.dll не прошёл проверку целостности (SHA-256 {hash})',
  'The wintun archive did not contain wintun.dll':
    'В архиве wintun не найден wintun.dll',
  'wintun.dll ready · TUN capture available':
    'wintun.dll готов · захват TUN доступен',
  '{name} staged next to wintun.dll': '{name} размещён рядом с wintun.dll',
  '{name} is bundled with Eaglet and cannot be removed from the app folder':
    '{name} входит в комплект Eaglet и не может быть удалён из папки приложения',
  'Kill switch is not implemented on this platform':
    'Kill Switch не реализован на этой платформе',
  'A kill switch cannot protect a direct connection':
    'Kill Switch не может защитить прямое соединение',
  'The node address could not be resolved; the kill switch was not armed':
    'Не удалось определить адрес узла; Kill Switch не включён',
  'DNS protection requires an https:// DoH endpoint':
    'Для защиты DNS нужен DoH-эндпоинт https://',
  'The DoH endpoint has no hostname': 'У DoH-эндпоинта нет имени хоста',
  'The DoH endpoint has an invalid port': 'У DoH-эндпоинта неверный порт',
  'The DoH endpoint {host} could not be resolved':
    'Не удалось определить адрес DoH-эндпоинта {host}',
  'PowerShell returned no adapter information':
    'PowerShell не вернул сведения об адаптерах',
  'No active network adapter was found': 'Активный сетевой адаптер не найден',
  'No network services were found': 'Сетевые службы не найдены',
  'Could not determine the default network interface':
    'Не удалось определить сетевой интерфейс по умолчанию',
  'DNS protection is not implemented on this platform':
    'Защита DNS не реализована на этой платформе',
  'System proxy is not implemented on {platform}':
    'Системный прокси не реализован на платформе {platform}',
  'The clipboard is empty. Copy a subscription URL or a share link first.':
    'Буфер обмена пуст. Сначала скопируйте URL подписки или ссылку.',
  'Profile not found': 'Профиль не найден',
  'The share link for this profile is unavailable — re-import it or unlock the OS keyring':
    'Ссылка для этого профиля недоступна — импортируйте его заново или разблокируйте системное хранилище ключей',
  'No working public nodes found': 'Рабочие публичные узлы не найдены',
  'Could not create a direct profile': 'Не удалось создать прямой профиль',
  'Direct profile missing': 'Прямой профиль отсутствует',
  'The secret vault is not valid JSON: {error}':
    'Хранилище секретов содержит некорректный JSON: {error}',
  'The OS keyring is unavailable, so the encrypted vault cannot be opened':
    'Системное хранилище ключей недоступно, поэтому зашифрованное хранилище нельзя открыть',
  'The secret vault uses the legacy base64 format and is not encrypted':
    'Хранилище секретов использует устаревший формат base64 и не зашифровано',
  'The secret vault could not be decrypted: {error}':
    'Не удалось расшифровать хранилище секретов: {error}',
  'The legacy vault could not be re-encrypted: {error}':
    'Не удалось повторно зашифровать старое хранилище: {error}',
  'The encrypted secret vault could not be opened this launch; refusing to overwrite it':
    'Зашифрованное хранилище секретов не удалось открыть при этом запуске; перезапись отменена',
  'The encrypted secret vault could not be read; refusing to overwrite it':
    'Зашифрованное хранилище секретов не удалось прочитать; перезапись отменена',
  'No OS keyring is available; refusing to store secrets without encryption':
    'Системное хранилище ключей недоступно; хранение секретов без шифрования отменено',
  'The OS keyring rejected the encryption request: {error}':
    'Системное хранилище ключей отклонило запрос на шифрование: {error}',
  'DNS protection needs UDP/TCP port 53 on the loopback interface: {error}':
    'Для защиты DNS нужен UDP/TCP-порт 53 на loopback-интерфейсе: {error}',
  '{name}: still points at the local relay':
    '{name}: по-прежнему указывает на локальный ретранслятор',
  '{name}: IPv4 resolvers differ': '{name}: IPv4-резолверы отличаются',
  '{name}: IPv6 resolvers differ': '{name}: IPv6-резолверы отличаются',
  'Session history cleared': 'История сессий очищена',
  'Subscription removed': 'Подписка удалена',
  'Subscription {name} removed': 'Подписка {name} удалена',
  'Node removed': 'Узел удалён',
  'Node {name} removed': 'Узел {name} удалён',
  'Speed test failed: {error}': 'Тест скорости не удался: {error}',
  'Engine update check failed: {error}':
    'Не удалось проверить обновления движков: {error}',
  'Engine install failed: {error}': 'Не удалось установить движок: {error}',
  'Engine removal failed: {error}': 'Не удалось удалить движок: {error}',
  'Scenario failed: {error}': 'Сценарий не выполнен: {error}',
  'Scenario save failed: {error}': 'Не удалось сохранить сценарий: {error}',
  disconnected: 'отключено',
  connecting: 'подключение',
  disconnecting: 'отключение',
  error: 'ошибка',
  '{engine} configuration exported': 'Конфигурация {engine} экспортирована',
  'Firewall profile state could not be read from PowerShell':
    'Не удалось прочитать состояние профилей брандмауэра из PowerShell',
  'kill-switch-backup.json is malformed': 'Файл kill-switch-backup.json повреждён',
  'default outbound action is still Allow for {profiles}':
    'исходящее действие по умолчанию всё ещё Allow для {profiles}',
  'the kill-switch rules are missing after the script completed':
    'правила Kill Switch отсутствуют после завершения скрипта',
  'The speed test did not receive enough data — try again':
    'Тест скорости получил недостаточно данных — повторите попытку',
  'Public nodes are run by unknown people. Don\'t sign in to banking, work or other sensitive accounts while using them — treat this as a quick way to test the tunnel, not as a trustworthy provider.':
    'Публичные узлы принадлежат неизвестным людям. Не входите в банковские, рабочие и другие чувствительные аккаунты, пока пользуетесь ими — считайте это быстрым способом проверить туннель, а не надёжным провайдером.',
  'Save scenario': 'Сохранить сценарий',
  'Saving…': 'Сохранение…',
  'The OS keyring is unavailable. Connection links are kept in config.json without encryption until a keyring is available.':
    'Системное хранилище ключей недоступно. Ссылки подключений хранятся в config.json без шифрования, пока хранилище не станет доступно.',
  'The encrypted secret vault could not be decrypted. Profiles are preserved, but their share links must be re-imported. The vault file was not modified.':
    'Зашифрованное хранилище секретов не удалось расшифровать. Профили сохранены, но их ссылки нужно импортировать заново. Файл хранилища не изменён.',
  '{count} connection secret(s) are written to config.json in plaintext.':
    'Секретов подключений записано в config.json в открытом виде: {count}.',
  'TUN and system proxy are mutually exclusive — Eaglet uses TUN when both are enabled.':
    'TUN и системный прокси взаимоисключающие — при включении обоих Eaglet использует TUN.',
  Eaglet: 'Eaglet'
}

const DICTIONARIES: Record<Language, Record<string, string>> = { en: {}, ru }

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

/** Translate `key` for `language`, falling back to the key itself. */
export function translate(language: Language, key: string, vars?: Vars): string {
  const dictionary = DICTIONARIES[language] ?? DICTIONARIES[DEFAULT_LANGUAGE]
  return interpolate(dictionary[key] ?? key, vars)
}

/** Whether the dictionary currently has a Russian entry for this key. */
export function hasTranslation(language: Language, key: string): boolean {
  return Boolean(DICTIONARIES[language]?.[key])
}
