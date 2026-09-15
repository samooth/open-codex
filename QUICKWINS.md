# UI Quick Wins — open-codex

Mejoras de UI/UX de bajo riesgo y alta visibilidad, derivadas del estudio comparativo
con Kilo Code (webview VS Code). Cada quick win es autónomo, probable por separado y
no rompe el contrato existente. Este archivo se actualiza con cada paso.

Convención de estados: `[ ]` pendiente · `[~]` en curso · `[x]` hecho (con commit/archivos tocados)

---

## Lista priorizada

### QW1 — Barra de contexto de 3 segmentos (usado / reservado output / libre) `[x]`
**Prioridad: alta · Área: status bar · Hecho: 2026-09-13**
- Inspiración Kilo: `ContextProgress.tsx` — muestra tokens usados vs. *reservados para output* vs. disponibles.
- Ahora: solo `%` + sparkline en `terminal-status-bar.tsx`. El usuario no sabe que parte del
  contexto está reservado para la respuesta del modelo.
- **Cambio**: segmento adicional en el sparkline/porcentaje: `USED 62% · OUT ~8% · FREE 30%`,
  derivando el reservado de `config.maxTokens` (o default por modelo).
- Archivos: `codex-cli/src/components/chat/terminal-status-bar.tsx`,
  `codex-cli/src/components/chat/terminal-chat.tsx` (pasar `maxTokens`).
- Aceptación: el status bar muestra los 3 segmentos; no rompe en terminales estrechas.
- **Implementado**:
  - `terminal-chat-utils.ts`: `outputReservationForModel()` + `calculateContextSegments()`
    (used/reserved/free en %). Reserva por familia de modelo (o1/o3/o4: 32k, claude/gemini: 8k, resto 16k).
  - `terminal-status-bar.tsx`: barra `█` (usado, color dinámico) + `▒` (reservado output, dim),
    con `(out ~N%)` al lado del %.
  - `terminal-chat.tsx`: memo `contextSegments` pasado al status bar. Sparkline original
    conservado como fallback si no llegan segmentos.

### QW2 — Coste/tokens "por modelo" en el breakdown de ctrl+b `[x]`
**Prioridad: alta · Área: status bar · Hecho: 2026-09-13**
- Inspiración Kilo: `TaskUsage.tsx` — desglose plegable por modelo/proveedor con in/out, steps y $.
- Ahora: `ctrl+b` muestra SYS/HIST/TOOL/TOTAL/$ — sin distinción de qué parte es input vs output.
- **Cambio**: añadir al breakdown `IN:` (sys+hist+tool) y `OUT:` (assistant), con coste separado
  input/output usando `getModelPricing` (ya disponible en `approximate-tokens-used.ts`).
- Archivos: `codex-cli/src/utils/approximate-tokens-used.ts` (exponer in/out + costes),
  `codex-cli/src/components/chat/terminal-status-bar.tsx`.
- Aceptación: ctrl+b muestra IN/OUT y coste de cada; total sigue idéntico.
- **Implementado**:
  - `approximate-tokens-used.ts`: `TokenBreakdown` extendido con `input`, `output`,
    `inputCost`, `outputCost` (los 4 ya calculados internamente, solo se exponen).
  - `terminal-status-bar.tsx`: breakdown ctrl+b ahora muestra `IN:·OUT:` y
    `(in $X / out $Y)` junto al coste total. Ultra-narrow solo muestra el total.

### QW3 — Pantalla de bienvenida con sesiones recientes `[x]`
**Prioridad: alta · Área: empty state · Hecho: 2026-09-13**
- **Implementado**:
  - Nuevo `codex-cli/src/components/chat/welcome-view.tsx`: banner de bienvenida
    (versión + modelo), hasta 3 sesiones recientes de `loadRollouts()` con fecha
    relativa ("2h ago"), y 3 starters. Navegable ↑↓, Enter restaura (abre overlay
    `history-select` existente) o envía el starter. `h` abre el historial completo.
  - `terminal-message-history.tsx`: prop opcional `welcomeProps`; se renderiza solo
    cuando no hay items, ni streaming ni confirmación pendiente (sin romper el flujo).
  - `terminal-chat.tsx`: cablea `welcomeProps` (Enter en starter → `agent.run()`).
  - Sin sesiones guardadas muestra solo starters (comportamiento previo conservado).

### QW4 — Reglas "always allow" persistentes entre sesiones `[x]`
**Prioridad: alta · Área: aprobaciones · Hecho: 2026-09-13**
- **Implementado**:
  - `handle-exec-command.ts`: nuevo set `persistedApprovedCommands` + `loadPersistedApprovedCommands()`
    separado del set en memoria (tests con `authorizeCommand()` siguen session-scoped).
    La verificación de auto-aprobación consulta ambos sets. Al elegir "always" además
    persiste el `deriveCommandKey` en `config.json` (best-effort, import dinámico).
  - `config.ts`: `alwaysApprovedCommands: string[]` en schema, AppConfig, loadConfig y saveConfig.
  - `terminal-chat.tsx`: al crear el AgentLoop, siembra las reglas persistidas.
  - Efecto: "Yes, always approve this command" ahora sobrevive reinicios del CLI.

### QW5 — Sugerencias post-tarea (SuggestBar) `[x]`
**Prioridad: media · Área: feedback loop · Hecho: 2026-09-13**
- **Implementado**:
  - Nuevo `codex-cli/src/components/chat/suggest-bar.tsx`: fila "✦ next" con 3
    sugerencias ("run the tests", "review the changes you made", "commit these
    changes"). Tab/← → cicla, Enter envía, Esc o cualquier tecla descarta.
  - `terminal-chat.tsx`: detección de fin de turno (loading true→false con
    respuesta assistant no vacía); se oculta si hay confirmación/overlay
    pendiente o el usuario ya escribió. Enter → `agent.run()`.
  - Solo visible en estado idle; no interfiere con cola de prompts.
**Prioridad: media · Área: feedback loop**
- Inspiración Kilo: `SuggestBar.tsx` — al terminar una tarea, 2-3 siguientes pasos sugeridos.
- Ahora: al terminar, nada — el usuario debe inventar el siguiente paso.
- **Cambio**: al pasar de `loading=true → false` con respuesta completada, mostrar bajo el
  input 3 sugerencias contextuales estáticas inteligentes ("run the tests", "review the diff",
  "commit these changes"), navegables con Tab y enviables con Enter. Se descartan al escribir.
- Archivos: nuevo `suggest-bar.tsx` en `components/chat/`, hook de transición en
  `terminal-chat.tsx`, render en `terminal-chat.tsx` (entre historial e input).
- Aceptación: aparecen tras completar una respuesta, Tab cicla, Enter envía, cualquier
  escritura las oculta.

### QW6 — Arreglar onboarding con handler muerto `[x]`
**Prioridad: media · Área: onboarding · Hecho: 2026-09-13**
- **Implementado**:
  - `onboarding-approval-mode.tsx` reescrito: `onChange` ahora aplica el modo
    al AppConfig (runtime) + `saveConfig()` persistente (best-effort), con
    callback `onSelect` opcional para el flujo que lo hospede. Recibe `theme`
    y usa el estilo de acento izquierdo del resto de la UI (badge SETUP).
  - Nota: componente huérfano (no referenciado por cli.tsx) — queda listo
    para cablear en el first-run wizard futuro.

### QW7 — Reloj de duración por tool call (per-call, no solo global) `[x]`
**Prioridad: media · Área: feedback · Hecho: 2026-09-13**
- **Implementado**:
  - `terminal-chat-response-item.tsx`: `TerminalChatResponseToolCall` acepta
    `durationSeconds`; el switch de assistant extrae `duration_seconds` del item
    `tool` emparejado vía `toolCallMap` (ya llega en metadata de
    `handle-exec-command`) y lo pinta en el header: `(2.3s)` / `(45s)`.
  - Solo aparece en tool calls completados (no en running); el STDOUT box ya
    mostraba `duration: Ns` al expandir — ahora también visible colapsado.

### QW8 — Densidad: truncado de paths largos + iconos de rol unificados `[x]`
**Prioridad: baja · Área: pulido visual · Hecho: 2026-09-13**
- **Implementado**:
  - `utils/short-path.ts`: nuevos helpers `truncateMiddle()` (paths: conserva
    raíz y nombre de archivo) y `truncateEnd()` (modelos).
  - `terminal-header.tsx`: modelo truncado a `max(16, cols/4)`; breadcrumb a
    48 chars con truncado medio. El header ya no envuelve en 80 cols con
    modelos tipo `claude-3-5-sonnet-20241022` o paths profundos.

---

## Verificación

Tras cada QW: `npm run build` en `codex-cli/` + tests existentes (`npx vitest run` de los
tests tocados). Sin breaking changes de props salvo adiciones opcionales.

**Estado final (2026-09-14):**
- `npm run build` — OK (dist/cli.js 4.3 MB regenerado)
- `npx tsc --noEmit` — sin errores nuevos (los de `agent-loop.ts`, `mcp-manager.ts` y
  4 unused en `terminal-message-history.tsx` son preexistentes)
- `npx vitest run` — 20 failed / 213 passed, **idéntico al baseline sin cambios**
  (verificado con git stash antes/después; los fallos son tests preexistentes de
  multiline-editor, thought-rendering y agent-loop, con timing flaky)
- ESLint limpio en todos los archivos nuevos y tocados por las QW (los errores
  restantes del repo son preexistentes)

## Registro de progreso

| QW | Estado | Fecha | Archivos |
|----|--------|-------|----------|
| QW1 Contexto 3 segmentos | ✅ | 2026-09-13 | terminal-chat-utils, terminal-status-bar, terminal-chat |
| QW2 IN/OUT + costes ctrl+b | ✅ | 2026-09-13 | approximate-tokens-used, terminal-status-bar |
| QW3 Welcome + sesiones recientes | ✅ | 2026-09-13 | welcome-view (nuevo), terminal-message-history, terminal-chat |
| QW4 Always-allow persistente | ✅ | 2026-09-13 | handle-exec-command, config, terminal-chat |
| QW5 SuggestBar post-tarea | ✅ | 2026-09-13 | suggest-bar (nuevo), terminal-chat |
| QW6 Onboarding cableado | ✅ | 2026-09-13 | onboarding-approval-mode |
| QW7 Duración por tool call | ✅ | 2026-09-13 | terminal-chat-response-item |
| QW8 Truncado paths/modelos | ✅ | 2026-09-13 | short-path, terminal-header |

**8/8 quick wins completados.** No se han commit-eado (pendiente decisión del usuario).

---

## Fase 2 — Restyle visual tipo Kilo (2026-09-14)

Problema: la UI era funcional pero "fea" comparada con Kilo Code. Análisis del sistema
de diseño de Kilo (`packages/ui/src/styles/theme.css` + `basic-tool.css`):

- **Base monocroma + 1 acento**: jerarquía por *luminosidad* (strong 95% / base 60% /
  weak 40%), azul solo para interactivo. open-codex usaba 6 colores chillones a la vez.
- **lowercase, weight 500**: nada de UPPERCASE. Kilo: `text-transform: capitalize` como
  máximo, y solo en tool labels.
- **Bordes finos** (1px, 8-16% alpha), nunca `bold` boxes. Badges sin background
  invertido — color del texto + glyph (✓/✗), no "caja negra con texto blanco".
- **Separador `·`** en metadata (no `│`), ayuda en dim sin cursiva.

### Cambios aplicados

| Elemento | Antes | Ahora |
|----------|-------|-------|
| Tema default | "Default (Codex)" arcoíris (greenBright+cyanBright+magenta) | **"Kilo (Default)"**: monocromo + `blueBright` acento; el viejo queda como `classic` |
| Role headers | `[ ASSISTANT ]` caja invertida | `◆ codex` / `◇ you` texto coloreado |
| Tool labels | `TOOL.toUpperCase()` | lowercase bold (`shell`, `apply patch`) |
| Status icons | ✅/❌ emojis | `✓`/`✗` glyphs coloreados |
| Risk badge | `(⚡ EXECUTES COMMAND)` | `· exec` en color semántico |
| Duración | `(2.3s)` italic | `· 2.3s` dim |
| Badges PROMPT/FEEDBACK/RESTORE/EMPTY/SETUP (bg negro) | cajas invertidas | texto coloreado bold o eliminados |
| DIFF PREVIEW | rojo bold | `diff preview` dim |
| STDOUT / WEB.FETCH | uppercase | `output` / `web fetch` |
| Header | `OpenCodex v1 📁 /path 🤖 model 🛡️ mode` bold | `open-codex v1 · path · model · mode` dim con acentos puntuales |
| Status bar | `ID: MODE: QUEUED: CONTEXT TOTAL:$` uppercase+bold | `id · mode · queued · ctx 45%` lowercase, `·` separadores |
| Bordes | `borderStyle="bold"` en todos los acentos izquierdos | `single` en todo `components/chat/` |
| Overlays hints | `↑↓ navigate │ enter` italic | `↑↓ navigate · enter` sin italic |
| Suggest/welcome | ✻ Welcome to… / STARTERS | `open-codex v1 · starters` minimal |
| Input placeholder suggestions | highlight con `blackBright` bg | color highlight sin bg |
| Truncados | `...` | `…` |

Tests actualizados a los nuevos labels (`tests/terminal-chat-response-item.test.tsx`).
**Verificación: 20 failed / 213 passed = baseline exacto. Build OK. tsc sin errores nuevos.**

Nota: los 3 tests de thought/plan que fallan esperan contenido expandido pero el componente
lo colapsa por defecto (`[+] thought (press r to expand)`) — bug preexistente de
`reasoningExpanded`, no del restyle; con código viejo fallaban los mismos 3 + 2 de labels.

### Fase 2b — Interacción tipo Kilo (2026-09-14)

Tres feedbacks del usuario: (1) los collapsibles tipo `+` de Kilo son clicables,
(2) distribución del prompt input, (3) presentación de diffs.

**1. Chevrons clicables/activables** (patrón `Collapsible.tsx` de Kilo — chevron rota
`-90deg→0deg`, hint al hover):
- Todos los colapsables ahora usan `▸` (cerrado) / `▾` (abierto) + la tecla al lado
  en dim: `▸ thought r expand` · `▾ thought r collapse` · `▸ c expand 12 more lines`
  · `▾ batch · 8 ops c collapse`. Antes: `[+] thought (press r to expand)`.
- También en truncados de output (`▾ 34 more lines · c expand`) y en el colapso de
  mensajes assistant.
- La tecla es el equivalente TUI del click de Kilo — siempre visible, nunca "press 'x' to".

**2. Diffs con DiffChanges** (patrón `DiffChanges.tsx` de Kilo — `+N -M` coloreados
y variante "bars" de 5 bloques proporcionales):
- Nuevo componente `components/chat/diff-changes.tsx`: contador `+12 -3` en
  verde/rojo + mini-barra `▮▮▮▮▮` proporcional (máx 5 bloques, min 1 por lado no vacío).
- Aplicado en: header de cada archivo del patch review, totals del `apply patch`
  (suma de ops: update hunks + create lines + deletes), y en el `diff preview`
  del command review (antes: texto plano dim `(+12 -3)`).

**3. Prompt input tipo dock de Kilo** (patrón `prompt-input.css`: textarea sin caja
inversa, meta-controles en fila dim, hints compactos con `·`):
- Glyph `❯` → `›` fino, highlight constante al focus (eliminado el pulso binario
  parpadeante que hacía "noise").
- `SHELL FOCUS ACTIVE` (caja amarilla invertida) → `· shell focus` texto dim.
- Help text: `ctrl+c exit | "/help" help | ↑↓ history | ctrl+x edit | ctrl+j \n | ...`
  → `↑↓ history · ctrl+j newline · ctrl+x editor · ctrl+f shell · enter send · /help`.

**Verificación**: build OK · tsc sin errores · diff de tests failing vs baseline:
**idéntico (21/21, misma lista exacta)** — cero regresiones.

### Fase 2c — Providers /connect + overlays centrados (2026-09-14)

**1. `/connect` — gestión de providers** (patrón `ProviderSelectDialog`/`ProviderConnectDialog` de Kilo):
- Nuevo `components/connect-overlay.tsx`: catálogo de 8 providers (OpenAI, Anthropic,
  Google, OpenRouter, xAI, DeepSeek, HF, Ollama) con estado `●`/`○` (configurado
  vía config.providers o env var) → sub-form key/baseURL → activa `config.provider`,
  persiste en `config.json` y confirma. Esc navega atrás entre stages.
- Registrado como `/connect` (slash commands + suggestions + palette), modo `"connect"`
  en overlay-manager y cableado en terminal-chat/overlays.

**2. Overlays centrados** (patrón `dialog.css` de Kilo — `align-items: center`,
`width: min(100vw-16px, 640px)`, título 16-medium, footer con hairline):
- Nuevo `components/centered-overlay.tsx`: wrapper dialog centrado con título,
  descripción opcional, borde completo fino y footer de hints. Esc cierra.
- Migrados a él: `typeahead-overlay`, `command-palette-overlay` (antes borde
  izquierdo bold + badge invertido "COMMAND PALETTE") y `history-select-overlay`
  (antes badge "RESTORE"/"EMPTY" invertidos).

### Fase 2d — Contraste: grises legibles + acento gold (2026-09-14)

Problema reportado: `gray` ANSI (bright-black, `ESC[90m`) invisible sobre fondos
oscuros, y el azul de highlight se perdía.

- `ThemeColor = ForegroundColorName | "#hex"` — los temas ahora aceptan hex;
  nuevo helper `chalkFor(color)` resuelve `chalk.hex()` vs `chalk[name]`
  (migrados los 15 usos de `chalk[theme.x]` y `chalk.gray` hardcodeados).
- Tema default actualizado:
  - `dim`: `gray` → **`#8a8a98`** (gris medio, legible sobre negro)
  - `divider`: `gray` → **`#5c5c68`** (separa sin competir)
  - `highlight`/`accent`: `blueBright` → **`#ffd76a` (gold)**
  - `user`: → `yellowBright` (distinguible del gold interactivo)
  - `thought`/`toolIcon`/`statusBarSession`: → `#8a8a98`
- Verificado que chalk emite truecolor RGB (`ESC[38;2;255;215;106m`) para hex y
  que Ink/chalk lo aplican igual en `<Text color>`.
- Los demás temas temáticos (dracula, matrix…) se conservan con sus `gray` porque
  su estética lo asume; el default es el que usa todo el mundo.

**Verificación**: build OK · tsc limpio (solo preexistentes) · tests failing vs
baseline: **idéntico (diff vacío)** — cero regresiones.

### Fase 3 — Plugin system + Skills (2026-09-15)

### QW9 — WelcomeView compacta + bugfix input hijacking
- **Bug**: `WelcomeView` registraba `useInput({isActive})` y capturaba teclas
  incluso cuando el usuario escribía en el prompt (ej: "h" abría history-select).
- **Cambio**: WelcomeView es ahora puramente presentacional (sin useInput).
  La navegación (Tab/↑↓/Enter) se maneja en `TerminalChatInput` solo cuando el
  buffer está vacío y `isNew`. Enter ejecuta restore (sesiones) o run (starters).
- Props nuevos en `TerminalChatInput`: `welcomeItemCount`, `welcomeSelected`,
  `setWelcomeSelected`, `onWelcomeActivate`.
- `terminal-chat.tsx`: lift del estado de selección + `handleWelcomeActivate`
  (restauración directa de sesión sin overlay hop).
- WelcomeView compacta: 2 líneas (resume + try), sin duplicar versión/modelo
  (ya en header), sin bordes que llenan la pantalla.
- Archivos: `welcome-view.tsx`, `terminal-chat-input.tsx`, `terminal-chat.tsx`,
  `terminal-message-history.tsx`.

### QW10 — Plugin system mejorado (formato opencode)
- **Formato legacy** (`{definition, handler}`) mantenido como fallback.
- **Nuevo formato function-shape** (compatible opencode/Kilo):
  ```ts
  export default async (input, options) => ({
    tool: { my_tool: { definition, handler } },
    "experimental.chat.system.transform": (input, output) => {...},
    dispose: async () => {...},
  })
  ```
- Multi-tool: un archivo → N herramientas (map `tool:`).
- System-prompt hook: `applySystemTransforms` llamado en `agent-loop.ts`
  entre `stableInstructions` y `--- CURRENT PROJECT CONTEXT ---`.
- Lifecycle: `disposeAll()` llamado en shutdown (SIGINT/SIGTERM).
- `.ts` soportado además de `.js`.
- Options channel: `loadPlugins(options)` recibe `Record<string, Record<string, unknown>>`
  desde `config.json` (`plugins.{name}`) y lo pasa como segundo arg al plugin fn.
- Archivos: `plugin-manager.ts`, `agent-loop.ts`, `cli.tsx`.

### QW11 — SkillManager + comando `/skills`
- Directorio: `~/.open-codex/skills/` (además de `plugins/`).
- Skills cargadas automáticamente al startup, registradas en `PluginManager`.
- Skill format (opencode-style): export default async fn con `tool:`, `dispose:`,
  opcionalmente `manifest` inline.
- Comando `/skills`: lista skills instaladas con nombre + descripción.
- `SkillManager` separado de `PluginManager` pero registra tools en él.
- Dispose en shutdown.
- Archivos: `skill-manager.ts`, `terminal-chat-input.tsx`, `terminal-chat.tsx`, `cli.tsx`.
