# Segunda pasada para licitaciones con texto genérico — diseño propuesto

> **Estado: SOLO DISEÑO. No implementar hasta confirmación de Marcelo.**
> Este documento propone el mecanismo; no cambia código ni toca el pipeline.

## Problema

Algunas licitaciones traen en el RSS un texto **genérico** que no describe lo que
se compra: "Ver pliego adjunto", "Según anexo", "Adquisición de materiales varios",
etc. El detalle real (lo que permitiría al filtro de keywords o a la IA decidir
relevancia) está en los **ítems** del llamado — su nombre y su código de artículo —,
no en el título ni en la descripción del feed.

Hoy el filtro de keywords (`src/lib/pipeline/keywordFilter.ts`) sólo mira
`title + description` del tender normalizado. Cuando ese texto es genérico, una
licitación relevante se descarta antes de llegar a la IA. Caso testigo: **1787/2026**
pasa a ser relevante para Ruta Rental sólo si el filtro mira los **nombres de los
ítems**, que hoy no se consultan en ese punto.

El detalle de ítems ya se descarga y se parsea en otro momento
(`enrichOpportunity` → `getOrFetchDetailHtml` → `extractTenderItems`), pero eso
ocurre **después** de la selección, sólo para oportunidades ya guardadas, y por
empresa. No ayuda a decidir qué entra al pipeline.

## Objetivo

Que, **antes** del filtro de keywords, las licitaciones de texto genérico tengan
sus ítems disponibles en el store compartido (`global_tenders`), descargados **una
sola vez para todas las empresas**, para que el filtro (y más adelante la IA)
puedan mirar los nombres de los ítems. Todo con un volumen de requests a ARCE
acotado, compartido y amable, sin ráfagas.

**Alcance de esta parte:** este documento es sólo diseño. No se toca el pipeline
(`src/lib/pipeline.ts`) ni el filtro de keywords en esta entrega.

## Dónde encaja: la ingesta compartida

La segunda pasada vive en la **ingesta global compartida**
(`src/lib/pipeline/global-ingestion.ts`, `runGlobalIngestion`), descrita en
`docs/shared-ingestion-design.md`. Esa pasada ya corre una vez por corrida del cron,
bajo advisory lock, secuencial y con ritmo `INTER_REQUEST_DELAY_MS` (1,5 s). Es el
único lugar donde el costo se comparte entre empresas: lo que se descargue ahí sirve
para todas las que compartan esa familia.

Secuencia propuesta (dentro de `runGlobalIngestion`, después de persistir las filas
RSS y de `completeNullTitleTenders`):

1. **Seleccionar candidatas** entre las filas RSS de esta pasada: las que tienen
   **texto genérico** (criterio abajo) y todavía **no** tienen ítems en
   `global_tenders` (`tenderItems IS NULL`).
2. **Acotar** la lista al tope por ingesta (ver *Volumen*). Orden sugerido: más
   recientes primero (por `publicationDate`), para cubrir lo nuevo antes.
3. Para cada candidata, **descargar el detalle una vez** con el helper que ya
   cachea por `tenderId` y comparte entre empresas
   (`getOrFetchDetailHtml` / `getOrFetchTenderDetail`), parsear con
   `parseTenderDetail` / `extractTenderItems` / `extractBuyObject`, y **guardar**
   `tenderItems`, `articleCodes` y `objectDescription` en la fila de
   `global_tenders`. Marcar `detailFetchedAt` para no reprocesar.
4. Respetar el ritmo: `delay(INTER_REQUEST_DELAY_MS)` entre requests reales (nunca
   después de una servida desde cache), concurrencia 1.

Con eso, cuando luego cada empresa corra su filtro de keywords, el pipeline podrá
(en una entrega posterior, fuera de este alcance) ampliar el *haystack* con los
nombres de los ítems leídos de `global_tenders`.

## Criterio de "texto genérico"

Una fila RSS es candidata a segunda pasada si **cualquiera** de estas condiciones se
cumple sobre su texto normalizado (`normalizeText(title + " " + rssContent)`):

- **Menciona documentación en vez de describir**: contiene alguna de
  `adjunto`, `anexo`, `pliego`, `ver detalle`, `segun pliego`, `segun anexo`,
  `memoria descriptiva`, `especificaciones tecnicas` (lista de disparadores, no
  exhaustiva, fácil de extender).
- **Descripción demasiado corta**: menos de ~40 caracteres útiles de descripción
  (`rssContent` normalizado), o menos de ~4 palabras de contenido — señal de que el
  feed no trae el objeto real.

Ajustes para no inflar el volumen:

- Si el texto ya es rico (supera el umbral y no menciona documentación), **no** es
  candidata: el filtro de keywords sobre `title + description` ya alcanza.
- El criterio se calcula sobre la fila RSS ya normalizada; no requiere red.

Estos umbrales son parámetros, no magia: conviene arrancar conservador (pocas
candidatas) y abrir si se ven falsos negativos.

## Volumen de requests a ARCE

Cada candidata cuesta **como mucho una** descarga de detalle (el helper cachea por
`tenderId`, así que una licitación en varias familias/empresas se baja una vez).
Las que ya tienen `tenderItems` o `detailHtml` fresco **no** cuestan request.

Parámetros de control:

- **Ritmo**: `INTER_REQUEST_DELAY_MS` = 1,5 s, concurrencia 1 (≈ 1 request / 1,5 s),
  igual que la ingesta actual. 40 requests ≈ 1 min de reloj añadido a la pasada.
- **Tope por ingesta** (nuevo parámetro, p. ej. `SECOND_PASS_MAX_DETAILS = 200`):
  número máximo de detalles que la segunda pasada baja en una sola corrida. Si hay
  más candidatas que el tope, el resto queda para la próxima corrida (son filas que
  persisten en `global_tenders`; no se pierden). Con 200 → ≈ 5 min de reloj extra.

### Corrida en régimen (ventana ~1 día)

La ingesta diaria procesa lo publicado desde la última corrida exitosa
(`effectiveLookbackDays`, típicamente ~1 día). Estimación:

```
candidatas_día ≈ (tenders_nuevos_del_día en las familias vigiladas) × (fracción con texto genérico)
requests ≈ min(candidatas_día, SECOND_PASS_MAX_DETAILS)
tiempo_extra ≈ requests × 1,5 s
```

Orden de magnitud esperado para las familias actuales (p. ej. 2 y 10): decenas de
tenders nuevos por día, de los cuales una fracción (¿20–40 %?) son genéricos ⇒
**decenas de requests/día**, muy por debajo del tope de 200. Tiempo extra: **1–3
min** por corrida. El número exacto depende de datos reales; conviene instrumentar
`candidatas` y `requests` en el log antes de fijar el tope.

### Primera corrida / backfill (ventana 45 días)

La primera corrida de una empresa usa `FIRST_RUN_WINDOW_DAYS = 45`
(`src/lib/pipeline.ts`). Ahí el universo de candidatas es mucho mayor:

```
candidatas_primera ≈ (tenders en 45 días en las familias) × (fracción genérica)
```

Riesgo: cientos–miles de detalles. Mitigaciones (elegir una, documentada aquí para
decidir con Marcelo):

- **Tope + continuación entre corridas**: la segunda pasada baja hasta
  `SECOND_PASS_MAX_DETAILS` por corrida y el resto se completa en pasadas
  siguientes. Como el store es compartido y persistente, en pocos días queda todo
  cacheado sin ráfagas.
- **Script de backfill único** (análogo a `npm run backfill:global-tenders`):
  recorre `global_tenders` con texto genérico y `tenderItems IS NULL`, baja el
  detalle vía `arceFetch` con el mismo ritmo de 1,5 s y un tope total, reutilizando
  `feed_cache`/detalle fresco. Se corre una vez, fuera del horario del cron.
- **Acotar la primera corrida**: aplicar la segunda pasada en la primera corrida
  sólo a las candidatas que **ya pasaron** el resto de filtros (fecha/estado), no a
  las 45 días completas, para no pagar detalle de licitaciones cerradas.

Con tope de 200/corrida a 1,5 s, el techo duro es **≈ 5 min de reloj por corrida**,
independientemente de cuántas candidatas haya.

## Costo compartido entre empresas con las mismas familias

El ahorro clave: la descarga se hace en `runGlobalIngestion`, **una vez por
`tenderId`**, y se guarda en `global_tenders`. Varias empresas que comparten
familia (p. ej. dos empresas de software con familia 10) **no** multiplican los
requests: la primera que dispara la ingesta baja el detalle y las demás lo leen del
store. El helper `getOrFetchDetailHtml` ya implementa ese "una sola vez por tender,
fresco por `DETAIL_FRESH_TTL_MS`". La segunda pasada se apoya en eso; no agrega
tráfico por empresa.

## Manejo de fallas de ARCE en la segunda pasada

La segunda pasada es **best-effort** y nunca debe tumbar la ingesta ni el pipeline:

- Si `getOrFetchDetailHtml` devuelve `null` (ARCE no respondió y no hay cache), se
  **omite** esa candidata: no se escribe `tenderItems`, no se marca
  `detailFetchedAt`, y queda pendiente para la próxima corrida (reintento natural).
- Errores por candidata se capturan individualmente (try/catch) y se cuentan en el
  log (`segunda_pasada: candidatas=N bajadas=M fallidas=K`); una falla no corta el
  bucle.
- Ante muchos fallos seguidos (p. ej. ARCE caído), **cortar temprano** la segunda
  pasada de esa corrida (circuit breaker simple) y dejar todo para la siguiente; el
  store sigue sirviendo lo que ya tenía.
- El `GlobalIngestionRun` sigue reflejando el estado de los **feeds**; la segunda
  pasada no cambia ese status (es un agregado opcional), de modo que una falla de
  detalle no marca la corrida como FAILED.

## Cómo evitar reprocesar

- **Marca de completitud**: una fila se considera ya procesada cuando tiene
  `tenderItems` no nulo (y/o `detailFetchedAt` fresco). La selección de candidatas
  excluye esas filas, así que no se vuelven a bajar.
- **Frescura**: se respeta `DETAIL_FRESH_TTL_MS` (24 h). Pasado ese tiempo podría
  re-bajarse, pero como el objeto de un llamado no suele cambiar, se puede usar un
  TTL más largo para ítems que para fechas de cierre, o simplemente no re-bajar si
  ya hay ítems (los ítems son estables; las fechas se refrescan por otro camino en
  `enrichOpportunity`).
- **Idempotencia**: correr la segunda pasada (o el backfill) dos veces no duplica
  tráfico ni filas: el `upsert` por `tenderId` actualiza en lugar de insertar, y las
  filas ya completas se filtran antes de pedir red.
- **Tope + continuación**: si el tope deja candidatas afuera, se retoman en la
  próxima corrida por su `publicationDate`; no hay estado extra que mantener.

## Lo que NO hace este diseño

- No modifica `src/lib/pipeline.ts` ni `keywordFilter.ts` (eso sería la entrega de
  implementación posterior, donde el *haystack* del filtro se amplía con los nombres
  de ítems de `global_tenders`).
- No cambia el esquema: `global_tenders` ya tiene `tenderItems`, `articleCodes` y
  `objectDescription`.
- No cambia el ritmo ni el advisory lock de la ingesta; se apoya en los existentes.

## Parámetros a fijar con Marcelo antes de implementar

| Parámetro | Propuesta inicial | Comentario |
| --- | --- | --- |
| Disparadores de "texto genérico" | lista `adjunto/anexo/pliego/...` | abrir/cerrar según falsos negativos |
| Umbral de descripción corta | < 40 chars o < 4 palabras | conservador al inicio |
| `SECOND_PASS_MAX_DETAILS` (tope/ingesta) | 200 | techo ≈ 5 min de reloj |
| Estrategia primera corrida/45 días | tope + continuación, o backfill único | decidir según volumen real medido |
| TTL de ítems | no re-bajar si ya hay ítems | los ítems son estables |
