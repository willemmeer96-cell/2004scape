# lostcity-automation

Lokale Node.js/Bun reverse-proxy/gateway voor een telemetrie-omgeving rond
een **lokaal/privé gehoste** HTML5/Canvas-applicatie (bijv. een lokale
2004scape/LostCity-emulator) die via WebSockets communiceert. Losstaand
project, bewust gescheiden gehouden van andere repositories (poort- en
git-conflicten).

Bedoeld voor gebruik tegen een eigen lokale/private dev- en testomgeving,
niet tegen een live publieke multiplayer-server.

## Status

- **Proxy-infrastructuur**: `official-proxy`-modus die de applicatie
  ongewijzigd doorserveert, met een foutveilige middleware die een lokaal
  telemetrie-script in de HTML injecteert (HTTP) en een raw WebSocket-tunnel
  voor het WS-verkeer.
- **Telemetrie-uitlezing** (`src/inject/telemetry-inject.js`): leest,
  indien beschikbaar, spelercoördinaten en actieve entities uit het
  runtime-geheugen van de client. Zie de belangrijke kanttekening hieronder
  over hoe dit werkt bij een 2004scape/Client2-achtige (webpack-gebundelde)
  client.
- **Nog niet geïmplementeerd**: het daadwerkelijk versturen van de
  snapshot naar een centraal dashboard — de data staat klaar via
  `window.__telemetryPanel.getSnapshot()`, maar de verzendlaag volgt later.

### Belangrijk: hoe de game-state uitlezen werkt

Een client zoals `2004scape/Client2` is een webpack-gebundelde
TypeScript-applicatie. De game-instantie (met `localPlayer`, `players[]`,
`npcs[]`, etc.) leeft in module-scope en wordt **niet** standaard op
`window` gezet — een extern geïnjecteerd script kan daar dus niet zomaar
bij. Voor je eigen lokale build voeg je zelf één regel toe om een hook
bloot te leggen, bijvoorbeeld in de `Game`-klasse:

```ts
(window as any).__gameState = this;
```

`telemetry-inject.js` polled periodiek een lijst met kandidaat-namen
(`__gameState`, `game`, `client`) en gebruikt de eerste die bestaat. Zolang
die hook er niet is, blijft het script geruisloos wachten — dit is exact
hetzelfde patroon als referentietooling zoals `rs-sdk`, dat ook draait
tegen een bewust "enhanced" lokale clientbuild in plaats van een
ongewijzigde bundle.

## Structuur

```
lostcity-automation/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                     # entry point
    ├── server.ts                    # bootstraps Bun.serve, kiest mode
    ├── config.ts                    # env-gebaseerde configuratie
    ├── modes/
    │   └── official-proxy/
    │       ├── index.ts             # combineert http + websocket tot 1 mode
    │       ├── http.ts              # HTTP/HTML-proxy + injectie
    │       └── websocket.ts         # raw bidirectionele WS-tunnel
    ├── middleware/
    │   ├── inject-html.ts           # pure, foutveilige HTML-injectie
    │   ├── telemetry-pipeline.ts    # laadt/cachet het inject-script van disk
    │   └── index.ts                 # barrel export
    └── inject/
        └── telemetry-inject.js      # leest localPlayer/players/npcs, resolver-based
```

De applicatie die gemonitord wordt is een web-based HTML5/Canvas-client die
over WebSockets communiceert. De gateway is dan ook puur gebouwd op Web
Platform APIs (`fetch`, `WebSocket`, `Bun.serve`) en heeft geen enkele
afhankelijkheid van de Java/RuneLite-runtime in de rest van deze repo —
die twee delen delen alleen het bovenliggende git-repository, verder
niets.

### HTTP vs. WebSocket in official-proxy

- **HTTP** (`modes/official-proxy/http.ts`): haalt HTML/JS/CSS/assets op
  bij `TARGET_ORIGIN` en serveert ze door. Alleen `text/html`-responses
  gaan door de injectie-middleware.
- **WebSocket** (`modes/official-proxy/websocket.ts`): upgrade-requests
  worden onderschept vóórdat ze de HTTP-handler bereiken en getunneld naar
  de bijbehorende `ws(s)://`-upstream. Dit is puur transport-laag
  doorgifte — frames worden 1-op-1 gerelayed, niet geparsed of
  gewijzigd. Het uitlezen van WS-payloads voor telemetrie is bewust nog
  niet geïmplementeerd; dat is de volgende fase.

## Configuratie (env vars)

| Variabele           | Default                          | Omschrijving                              |
|----------------------|----------------------------------|--------------------------------------------|
| `GATEWAY_MODE`        | `official-proxy`                 | Actieve gateway-modus                      |
| `GATEWAY_PORT`        | `4310`                           | Lokale luisterpoort                        |
| `TARGET_ORIGIN`       | *(verplicht)*                    | Origin van de legacy applicatie             |
| `INJECT_SCRIPT_PATH`  | `src/inject/telemetry-inject.js` | Pad naar het te injecteren script          |

## Draaien

```bash
bun install
TARGET_ORIGIN=http://localhost:PORT_VAN_JE_LOKALE_EMULATOR bun run dev
```

## Architectuurprincipes

- **Nooit de app breken**: `injectBeforeClosingBody` (in `inject-html.ts`)
  vangt elke fout af en valt altijd terug op de originele, ongewijzigde
  HTML. Alle I/O rond het laden van het inject-script zit in een aparte
  laag (`telemetry-pipeline.ts`) met eigen foutafhandeling.
- **Modulair per modus**: nieuwe gateway-modi (bijv. een lokale mirror-modus)
  worden toegevoegd als los bestand onder `src/modes/`, geregistreerd in
  `server.ts`, zonder de bestaande modi te raken.
- **Non-HTML assets ongemoeid**: alleen `text/html`-responses gaan door de
  injectie-pipeline; JS, CSS, afbeeldingen en WebSocket-upgrades worden
  ongewijzigd doorgestreamd.
- **Geïsoleerde scope client-side**: `telemetry-inject.js` is een IIFE en
  raakt nooit de globale scope van de host-applicatie aan.
