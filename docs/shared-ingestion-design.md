# Lectura diaria compartida entre empresas

Documento de diseño e implementación de la **ingesta global**: bajar de ARCE
cada licitación (feeds y detalle) **una sola vez por día** y reutilizar en la
base lo que es independiente de la empresa, en lugar de golpear ARCE una vez por
empresa.

Todo el cambio es **aditivo** y con *fallback* directo: si las tablas nuevas
están vacías (por ejemplo, una corrida manual de una sola empresa sin ingesta
previa), el pipeline por empresa funciona igual que antes.

---

## 3.1 Qué datos se pueden compartir y dónde viven hoy

Analizando el pipeline (`src/lib/pipeline.ts`, `src/lib/pipeline/*`,
`src/lib/scraper/*`):

| Dato | ¿Depende de la empresa? | Dónde vivía | Dónde vive ahora (compartido) |
|---|---|---|---|
| Descarga del feed RSS (XML/items) | **No** (mismo feed, mismos items) | `pipeline/fetcher.ts` `fetchRssFeeds`, por empresa | `FeedCache` (una fila por URL) |
| Feeds de fallos (desierta / ofertas rechazadas) | **No** (2 URLs globales) | `pipeline/failed-tenders.ts` `FAILURE_FEEDS`, por empresa | `FeedCache` |
| Detalle de un fallo (objeto, ítems, códigos) | **No** (misma licitación) | `failed-tenders.ts` `enrichFailure`, por empresa | `GlobalTender` (por `tenderId`) |
| HTML de la página de detalle de una oportunidad | **No** (misma página) | `scraper/enricher.ts` `fetchArceHtml`, por oportunidad/empresa | `GlobalTender.detailHtml` |
| Clasificación de encaje (fit) de la oportunidad | **Sí** (depende de capacidades) | `pipeline/classifier.ts` | — (no se comparte) |
| Clasificación de nicho (nucleo/adyacente/fuera) | **Sí** (depende de la empresa) | `pipeline/niche-classifier.ts` | — (no se comparte) |
| Normalización/extracción común del objeto con IA | **No** | (no existía) | `AiAnalysisCache` (por hash de contenido) |
| Oportunidades guardadas, nichos, marcas de onboarding | **Sí** | `opportunities`, `niches`, `failed_tenders` | — (siguen por empresa) |

Conclusión: lo caro y repetido —descargar feeds y páginas de detalle, y la
extracción de texto que no depende de la empresa— es **independiente de la
empresa** y se puede bajar una vez y reutilizar. Lo específico (fit,
oportunidades, nichos) sigue por empresa.

---

## 3.2 Diseño

### Tablas globales (sin `companyId`) — `prisma/schema.prisma`

- **`FeedCache`** (`feed_cache`): una fila por URL de feed. Guarda los
  validadores de petición condicional (`etag`, `lastModified`), `lastFetchedAt`,
  `lastStatus`, y los `itemsJson` (los `RssItem[]` ya parseados de la última
  descarga exitosa) con su `itemCount`. Permite: (a) responder a varias empresas
  de la misma corrida desde la caché, y (b) en la próxima corrida mandar
  `If-None-Match` / `If-Modified-Since` y reutilizar el cuerpo ante un `304`.

- **`GlobalTender`** (`global_tenders`): una fila por `tenderId` (id único de
  ARCE). Guarda lo que no depende de la empresa: `familia`, `title`,
  `rssContent`, `publicationDate`, `objectDescription`, `tenderItems`,
  `articleCodes`, `pliegoRefs`, el `detailHtml` crudo y las marcas de frescura
  `detailFetchedAt` (datos parseados) y `htmlFetchedAt` (HTML crudo).

- **`AiAnalysisCache`** (`ai_analysis_cache`): caché *read-through* para trabajo
  de IA común (p. ej. normalizar el objeto), con clave = `sha256(kind + input)`.
  El mismo texto se manda al modelo una sola vez.

- **`GlobalIngestionRun`** (`global_ingestion_runs`): estado global de la
  pasada de ingesta (uno por corrida). Permite marcar `FAILED`/`PARTIAL` cuando
  ARCE está caído, de forma independiente de cada empresa.

### Paso de ingesta global — `src/lib/pipeline/global-ingestion.ts`

`runGlobalIngestion(feedUrls, now)`:

1. **Lock.** Toma un *advisory lock* de Postgres (`pg_try_advisory_lock`). Si
   otra pasada lo tiene, devuelve `SKIPPED` (no corre dos veces en paralelo).
2. **Descarga condicional, secuencial y con rate limit.** Recorre las URLs
   **únicas** de a una (**concurrencia 1**), esperando `INTER_REQUEST_DELAY_MS =
   1500 ms` **entre** requests (~1 req / 1.5 s). Cada feed pasa por
   `fetchFeedConditional`, que:
   - si la caché está **fresca** (`FEED_FRESH_TTL_MS = 6 h`), ni toca la red;
   - si no, manda `If-None-Match`/`If-Modified-Since` vía `arceFetch`;
   - ante `304`, reutiliza `itemsJson` y sólo actualiza `lastFetchedAt`;
   - ante `200`, parsea, guarda items + nuevos `etag`/`lastModified`;
   - ante error HTTP/red, cae a los últimos items cacheados (si hay).
3. **Estado global.** Calcula `COMPLETED` / `PARTIAL` / `FAILED` (todos los
   feeds caídos) y lo persiste en `GlobalIngestionRun`. Libera el lock siempre
   (`finally`).

### La corrida por empresa lee de la base — `src/lib/pipeline.ts`

- `runPipelineAllCompanies` primero decide **qué empresas corren** (activas, con
  usuarios y *due* por su cadencia), junta sus feeds + los feeds de fallos
  (`FAILURE_FEED_URLS`) y llama a `runGlobalIngestion` **una vez**, antes del
  loop. Aunque la ingesta falle (ARCE caído), **igual continúa**: cada empresa
  procesa lo que haya en la base.
- Cada empresa usa `fetchCompanyFeeds`, que sirve cada feed desde la caché
  **fresca** y sólo baja directamente (con los reintentos/backoff normales de
  `fetchRssFeeds`) los feeds que la caché no tenga. Por eso, varias empresas en
  la misma pasada comparten **una sola descarga por feed**, y una corrida manual
  de una empresa sin ingesta previa sigue funcionando.
- Los fallos usan `enrichFailure`, que ahora delega en `getOrFetchTenderDetail`:
  el detalle de un `tenderId` se guarda en `GlobalTender` y se reutiliza entre
  empresas y entre corridas del día (`DETAIL_FRESH_TTL_MS = 24 h`).
- El enriquecimiento de oportunidades (`scraper/enricher.ts`) baja el HTML de
  detalle vía `getOrFetchDetailHtml` (caché por `tenderId`), así la página se
  descarga una vez por día; el parseo queda en el sitio (es barato).

### IA compartida y cacheada

`cachedAiAnalysis(kind, input, compute)` cachea por hash el trabajo de IA que es
**común** (no el fit por empresa). Queda disponible para la extracción/normalización
del objeto o del pliego; el fit de oportunidad y la clasificación de nicho
siguen por empresa a propósito.

### Resiliencia

- Lock evita pasadas solapadas.
- Descarga condicional: no se re-baja lo que no cambió.
- Ante error, se reutiliza lo cacheado (los feeds y los detalles ya guardados).
- `GlobalIngestionRun` marca `FAILED`/`PARTIAL`; el pipeline por empresa **no
  avanza `lastSuccessfulRunAt`** cuando sus feeds están todos caídos (lógica ya
  existente en `pipeline.ts`), así que la ventana de búsqueda se sigue ampliando
  y la próxima corrida se pone al día.
- Empresa nueva: al no tener `lastSuccessfulRunAt`, corre en la próxima pasada y
  lee primero de la base global (feeds y detalles ya cacheados por otras
  empresas), sin volver a bajar lo mismo.

---

## 3.3 Migración

`prisma/migrations/22_shared_daily_ingestion/migration.sql` — **aditiva**: sólo
`CREATE TABLE` de `feed_cache`, `global_tenders`, `ai_analysis_cache` y
`global_ingestion_runs`. **No** borra ni altera ninguna tabla existente, así que
el pipeline por empresa sigue intacto mientras las tablas nuevas se llenan.

**Limpieza futura (no se hace ahora):**
- Una vez validada la ingesta global, el detalle por empresa en `failed_tenders`
  (objeto/ítems/códigos) podría leerse siempre de `GlobalTender` y dejar de
  duplicarse por empresa (mantener sólo el vínculo + la clasificación de nicho,
  que sí es por empresa).
- TTL/retención de `FeedCache.itemsJson` y `GlobalTender.detailHtml` (son los
  campos más pesados): purgar HTML viejo que ya no se relee.
- Unificar el fetch de feeds de fallos y el de feeds por empresa en un único
  camino cacheado (hoy comparten `FeedCache` pero por dos funciones distintas).

---

## Criterios de aceptación y cómo verificarlos

Estos criterios requieren una base Postgres y acceso a ARCE (no disponibles en
el entorno de desarrollo donde se escribió esto), así que se dejan como
procedimiento manual. La lógica pura (frescura, headers condicionales, hash de
caché) está cubierta por tests aislados (ver el commit).

1. **El feed y el detalle se bajan una sola vez aunque haya 3 empresas.**
   Con 3 empresas *due* que compartan feed, correr `runPipelineAllCompanies`.
   Esperado: un solo `GlobalIngestionRun`; `feed_cache` con una fila por URL y
   `lastStatus=200`; en los logs, las empresas 2 y 3 reportan feeds servidos de
   caché (`attempts: 0`). El detalle de un fallo compartido aparece una sola vez
   en `global_tenders` (un único `detailFetchedAt`).

2. **Una re-ejecución no vuelve a descargar lo que no cambió.**
   Correr de nuevo dentro del día. Esperado: dentro de `FEED_FRESH_TTL_MS` no hay
   request (se sirve de caché); pasado ese TTL, la request es condicional y ARCE
   responde `304` → `feedsFromCache` aumenta y no se re-parsea el cuerpo.

3. **El análisis de pliego/detalle de una licitación ocurre una sola vez.**
   Dos empresas con la misma oportunidad relevante: `global_tenders.detailHtml`
   se llena una vez (`htmlFetchedAt` único); la segunda empresa lo lee de la
   base.

4. **Si ARCE se cae, igual se procesa lo que haya guardado.**
   Simular ARCE caído (p. ej. `ARCE_PROXY_URL` a un host muerto). Esperado:
   `GlobalIngestionRun.status = FAILED`, pero cada empresa corre con los items y
   detalles ya cacheados; las que no tienen nada guardado marcan su `Run` como
   `FAILED` sin avanzar `lastSuccessfulRunAt`.
