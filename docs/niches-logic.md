# Lógica de nichos en Cribal

Documento de investigación (solo lectura). Describe cómo funciona hoy el
sistema de nichos de oportunidad, qué pasa cuando el usuario descarta un nicho,
en qué se diferencian los tipos de empresa, dónde están las debilidades, y una
hipótesis de mejora para empresas de productos vs. servicios. No cambia código.

Las referencias de código indican `archivo` y `función`/símbolo.

---

## 1. Cómo funcionan los nichos de punta a punta

Un **nicho** es una señal de mercado: un organismo del Estado que intentó
contratar algo y **falló repetidamente** (quedó desierto, o todas las ofertas
fueron rechazadas). Esas necesidades insatisfechas probablemente se vuelvan a
licitar, y por eso son una puerta de entrada — incluso en rubros donde la
empresa todavía no opera.

El flujo completo corre **dentro del pipeline diario**, después de guardar las
oportunidades normales:

1. **Descarga de fallos** — `src/lib/pipeline/failed-tenders.ts`,
   `ingestFailedTenders()`. Se leen dos feeds RSS globales de ARCE
   (`FAILURE_FEEDS`): `resol/3` = desierta, `resol/7` = ofertas rechazadas. El
   tipo de fallo no viene en el título; se deduce del feed de origen y se
   etiqueta cada ítem (`fetchFailureFeed()`).

2. **Deduplicación** — primero dentro de la corrida por `tenderId` (gana el
   primer feed), y luego contra lo ya guardado para esa empresa por `failureId`
   (`arce-fail|{tenderId}`). Solo se procesan los **fallos nuevos**. Nota: los
   fallos se guardan **por empresa** (`FailedTender.companyId`), así que la
   descarga y el enriquecimiento se repiten para cada empresa (ver Parte 3 del
   lote: lectura diaria compartida).

3. **Enriquecimiento desde ARCE** — `enrichFailure()`. Un fallo tiene dos vistas
   y los datos están repartidos: la página de detalle trae el **objeto de
   compra** (`extractBuyObject()`), y la vista de llamado `/mostrar-llamado/1`
   trae los **ítems** y sus **códigos de artículo**
   (`parseTenderDetail().items`). Se respeta un retraso de 500 ms entre
   requests (`ENRICH_DELAY_MS`).

4. **Clasificación con IA** — `src/lib/pipeline/niche-classifier.ts`,
   `classifyFailures()` → `classifyBatch()`. **Sin ningún filtro de keywords ni
   exclusiones**: se evalúa *todo* fallo nuevo para poder descubrir mercados que
   la empresa aún no atiende. El prompt (`SYSTEM_PROMPT`) pide clasificar cada
   fallo como:
   - `nucleo`: dentro de lo que la empresa ya hace.
   - `adyacente`: alcanzable con un estiramiento razonable (contratar un perfil,
     aliarse, incorporar una tecnología cercana) — con una `missingCapability`
     concreta.
   - `fuera`: otro rubro, la distancia es demasiado grande.
   Devuelve además `fitScore` (0–10) y `reason`. Se procesa en lotes de 20
   (`BATCH_SIZE`), con un reintento por error de parseo y, si falla dos veces,
   el lote se descarta.

5. **Persistencia** — se guarda **todo** fallo clasificado, FUERA incluido
   (`CATEGORY_MAP` mapea los códigos de la IA al enum `NicheCategory`). Los FUERA
   nunca llegan a un nicho ni a la UI, pero se guardan para que la deduplicación
   por `failureId` no los vuelva a descargar/clasificar en cada corrida. La
   `missingCapability` solo se guarda para los ADYACENTE.

6. **Agregación en nichos** — `src/lib/pipeline/niches.ts`,
   `recomputeNiches()`. Se reconstruyen los nichos a partir del conjunto
   completo de fallos **no-FUERA** de la empresa. Se agrupan por
   `organismo + primer articleCode` (los fallos sin código colapsan en un único
   nicho por organismo, con `articleCode = null`). Para cada grupo se calcula:
   - `category`: la más favorable del grupo (`mostFavorable()`:
     NUCLEO > ADYACENTE > FUERA).
   - `label`: `buildLabel()` → "{objeto, truncado a 60} · {organismo}", con
     fallback al nombre del ítem y, por último, al título crudo del feed.
   - `fitScore` y `missingCapability` del fallo con mayor `fitScore` del grupo.
   - contadores (`failureCount`, `desiertaCount`, `rechazadaCount`), fechas
     (`firstFailureAt`/`lastFailureAt`) y `signalStrength`
     (`computeSignalStrength()`: ALTA si ≥3 fallos o ≥2 con el último dentro de
     12 meses; MEDIA con 2; BAJA con 1).
   Todo ocurre en **una sola transacción**: se upsertean los nichos por su clave
   única `(companyId, organismo, articleCode)`, se relinkean los fallos
   (`FailedTender.nicheId`), se desvinculan los FUERA, y se **podan los
   huérfanos** (nichos sin fallos): los que el usuario no tocó se borran, los que
   tienen inversión del usuario (status ≠ NUEVO, notas o análisis) se **archivan**
   para no perder nada.

7. **Presentación** — `src/app/(dashboard)/nichos/page.tsx`. Se calcula un único
   **Puntaje 0–10** (`src/lib/niche-score.ts`, `computeNicheScore()`: `fitScore`
   + bonus por recurrencia + bonus por fallo reciente) y se ordena por puntaje ↓,
   luego categoría (ADYACENTE primero, porque es lo que el usuario no encuentra
   por otros canales: `CATEGORY_RANK`), luego `lastFailureAt` ↓. Hay una vista de
   auditoría `category=FUERA` que lista los fallos descartados por la IA. El
   detalle (`/nichos/[id]`) permite generar un **análisis con IA** bajo demanda
   (`src/lib/actions/niches.ts`, `analyzeNiche()`: por qué falló, encaje, cómo
   entrar, probabilidad de re-llamado).

Modelos: `Niche` y `FailedTender` en `prisma/schema.prisma`. Enums
`NicheCategory`, `NicheStatus`, `SignalStrength`, `FailureType`.

---

## 2. Qué ocurre cuando el usuario descarta un nicho

**No existe una acción dedicada de "descartar".** Descartar es simplemente
cambiar el **estado** del nicho a `DESCARTADO`:

- UI: `src/components/niche/niche-status-select.tsx` (el `<select>` de estado en
  la lista y el detalle), con opciones de
  `NICHE_STATUS_OPTIONS` (`src/components/niche/niche-badges.tsx`).
- Acción: `src/lib/actions/niches.ts`, `updateNicheStatus(nicheId, status)`.
  Hace un `prisma.niche.updateMany({ where: { id, companyId }, data: { status } })`
  acotado a la empresa, y revalida `/nichos` y `/nichos/[id]`.

Consecuencias concretas de dejar un nicho en `DESCARTADO`:

- **Deja de mostrarse en el listado por defecto.**
  `src/app/(dashboard)/nichos/page.tsx` filtra
  `status: { notIn: [DESCARTADO, ARCHIVADO] }` salvo que el usuario elija
  explícitamente ese estado en el filtro.

- **El nicho NO se borra y NO se excluye del recálculo.** En la siguiente
  corrida, `recomputeNiches()` (`src/lib/pipeline/niches.ts`) vuelve a tocar ese
  nicho si su grupo sigue existiendo: busca el existente por
  `(companyId, organismo, articleCode)` y hace `tx.niche.update({ data })`. El
  objeto `data` **no incluye `status`**, así que el `DESCARTADO` **sobrevive** al
  recálculo (igual que `notes` y `aiAnalysis`), pero **todos los campos
  calculados se actualizan** (label, fitScore, contadores, fechas). Es decir: un
  nicho descartado se mantiene descartado, pero se sigue recomputando por detrás.

- **Si el nicho se queda sin fallos** (porque sus fallos se re-agruparon a otra
  clave), cae en la poda de huérfanos. Como `DESCARTADO ≠ NUEVO`, cuenta como
  "con inversión del usuario" y se **archiva** (`status = ARCHIVADO`) en lugar de
  borrarse (`niches.ts`, bloque "Prune orphans").

- **Punto clave para el lote (Parte 4): descartar NO le enseña nada a la IA.**
  La decisión del usuario no vuelve como señal al clasificador
  (`niche-classifier.ts` solo recibe `companyName`, `description`,
  `capabilities` vía `buildUserMessage()`), ni al puntaje, ni al prompt. El mismo
  tipo de fallo volverá a clasificarse igual en el futuro. Ese es exactamente el
  hueco que cubre "Nichos descartados que enseñan".

`EXPLORANDO` funciona igual que `DESCARTADO` a nivel de persistencia (sobrevive
al recálculo), pero no se oculta del listado por defecto. `ARCHIVADO` sí se
oculta y normalmente lo pone el sistema al podar, no el usuario.

---

## 3. Diferencias entre tipos de empresa

**Hoy el modelo de datos no tiene un "tipo de empresa".** `CompanyConfig`
(`prisma/schema.prisma`) describe a la empresa con:

- `description` (texto libre),
- `capabilities` (lista de strings),
- `catalogArticleIds` (artículos del catálogo elegidos en el onboarding —
  marcados en el schema como *"not yet used by the pipeline"*),
- y el perfil extendido `CompanyProfile` (longDescription, diferenciadores,
  certificaciones, casos de éxito), que solo se usa en el análisis bajo demanda
  del nicho (`analyzeNiche()`), no en la clasificación masiva.

Por lo tanto, para el **flujo de nichos**, la "diferencia entre empresas" se
reduce a lo que el prompt del clasificador recibe: `companyName`, `description`
y `capabilities` (`niche-classifier.ts`, `buildUserMessage()`). No hay una rama
distinta para una empresa de productos vs. una de servicios: a ambas se las
clasifica con el mismo prompt genérico, apoyado en su texto.

Matiz importante y asimetría con el **flujo principal** de oportunidades:

- El clasificador de nichos (`niche-classifier.ts`) es **agnóstico de rubro**:
  se apoya en las capacidades de cada empresa, así que en teoría sirve para
  cualquier sector.
- En cambio, el clasificador principal de oportunidades
  (`src/lib/pipeline/classifier.ts`, `SYSTEM_PROMPT`) está **cableado al rubro
  tecnológico** ("technology and digital services companies", categorías
  `desarrollo_software | soporte_tecnico | cloud | ...`). Esto es una
  inconsistencia: la promesa de "cualquier rubro" la cumple hoy el flujo de
  nichos, no el principal.

En resumen: **la única diferencia real entre tipos de empresa hoy es el texto**
(descripción + capacidades) que alimenta a la IA. Los códigos de artículo del
catálogo (la vía natural para empresas de **productos**) todavía no participan
del matching.

---

## 4. Debilidades de la lógica actual

1. **No aprende de las decisiones del usuario.** Descartar, marcar EXPLORANDO o
   anotar no retroalimenta al clasificador ni al puntaje (ver sección 2). La IA
   repite sus sesgos corrida tras corrida.

2. **El clasificador de nichos solo ve texto.** `buildUserMessage()` pasa
   `description` + `capabilities`. No usa `CompanyProfile` (certificaciones,
   casos de éxito, diferenciadores) ni los `catalogArticleIds`. Para una empresa
   de productos, los **códigos de artículo** del fallo son una señal fortísima y
   hoy se ignoran en la decisión de encaje (solo se usan para *agrupar* nichos).

3. **Agrupación frágil por `organismo + primer articleCode`.** Se toma solo el
   **primer** código de artículo del llamado (`niches.ts`:
   `failure.articleCodes[0]`). Un llamado multi-ítem queda representado por un
   único código, y los fallos sin código colapsan en un cajón de sastre por
   organismo (`articleCode = null`) que mezcla rubros distintos del mismo
   comprador.

4. **Dependencia de la calidad del scraping de ARCE.** Si `/mostrar-llamado/1`
   no parsea, el fallo queda sin `articleCodes` ni ítems y pierde su mejor señal;
   si el objeto no se extrae, el `label` cae al título crudo del feed. No hay
   reintento específico de enriquecimiento ni marca de "enriquecimiento parcial".

5. **Costo y repetición entre empresas.** Los fallos se descargan, enriquecen y
   clasifican **por empresa**. Con N empresas, se golpea ARCE y la IA N veces
   para los mismos llamados (lo que ataca la Parte 3 del lote). La parte
   independiente de la empresa (objeto, ítems, códigos) es idéntica para todas.

6. **Clasificación binaria de categoría sin umbral configurable.** El límite
   entre `adyacente` y `fuera` lo decide el prompt; no hay un umbral de
   `fitScore` ni un control por empresa para ser más/menos conservador. Un FUERA
   mal puesto desaparece de la UI (salvo la vista de auditoría) y nunca se
   revisa.

7. **El puntaje y la señal se solapan.** `signalStrength` quedó como concepto
   interno y el `Puntaje` lo reemplazó en la UI (`niche-score.ts`), pero ambos
   se calculan con reglas parecidas (recurrencia + recencia) en dos lugares
   distintos — fácil de desincronizar.

---

## 5. Hipótesis: empresas de productos vs. empresas de servicios

**Hipótesis.** El mejor matching depende del tipo de empresa:

- **Productos** → el **catálogo** de ARCE (familias/subfamilias y, sobre todo,
  los **códigos de artículo**) es la vía natural. Un distribuidor de, por
  ejemplo, insumos médicos "es" un conjunto de artículos del catálogo. Hoy el
  sistema ya captura `articleCodes` por fallo (`FailedTender.articleCodes`) y los
  usa para *agrupar* nichos, pero **no** para decidir el encaje. El dato ya está;
  falta conectarlo.
- **Servicios** → el **texto del objeto** de compra (`objectDescription`) y las
  capacidades describen mejor a una consultora o a una empresa de software, donde
  el "qué se contrata" vive en la redacción del llamado y no en un código de
  artículo.

Soporte en el código/datos actuales:

- `CatalogArticle` (`prisma/schema.prisma`) ya modela
  `code` + `familyText` + `subfamilyText`, y hay búsqueda por catálogo
  (`src/app/api/catalog/search/route.ts`) usada en el onboarding.
- `catalogArticleIds` se eligen en el alta pero están marcados como *no usados
  por el pipeline*.
- Los fallos ya traen `articleCodes` y los nichos ya tienen `articleCode`.

### Evaluación

| Enfoque | Ventajas | Riesgos | Esfuerzo |
|---|---|---|---|
| **Productos por catálogo** (match por `articleCode`/familia contra `catalogArticleIds` de la empresa) | Señal objetiva y barata (no requiere IA para el primer filtro); determinista y explicable; aprovecha datos ya capturados; abarata costos | Cobertura dispar del catálogo; un llamado multi-ítem tiene varios códigos y hoy solo guardamos el "primer" code en el nicho; empresas que no completaron bien su catálogo quedan ciegas | **Bajo–medio**: los datos existen; falta cruzarlos y guardar *todos* los códigos del fallo |
| **Servicios por texto** (lo que ya hace la IA con objeto + capacidades) | Flexible; capta matices que no están en un código; ya funciona | Caro (una llamada de IA por lote); sensible a la redacción; sin feedback del usuario repite sesgos | **Nulo–bajo**: ya está; mejora marginal al sumar `CompanyProfile` al prompt |

### Recomendación

Adoptar un **enfoque híbrido guiado por un "tipo de empresa"**, implementado en
pasos pequeños y **sin romper el flujo actual**:

1. Agregar un campo opcional de **tipo de empresa**
   (`productos` | `servicios` | `mixto`) en `CompanyConfig`, elegido en el
   onboarding/perfil. Por defecto `mixto` (= comportamiento actual).
2. Para `productos`/`mixto`: usar los **códigos de artículo del fallo** como
   **prefiltro/boost** antes (o además) de la IA — si el `articleCode` del fallo
   coincide con el catálogo de la empresa, es señal fuerte de NUCLEO/ADYACENTE.
   Esto abarata y objetiva el matching de productos.
3. Para `servicios`/`mixto`: mantener la clasificación por texto, pero
   **enriquecer el prompt** con `CompanyProfile` (certificaciones, casos de
   éxito, diferenciadores), que hoy se ignora en la clasificación masiva.
4. Guardar **todos** los `articleCodes` del fallo (no solo el primero) para que
   el cruce por catálogo no pierda ítems.

La recomendación es empezar por **productos-por-catálogo** como prefiltro
barato: reutiliza datos existentes, es explicable y no rompe nada, dejando la IA
para desempatar y para el caso servicios.

---

## 6. Propuesta de mejora en pasos pequeños (con aprendizaje por aceptados/descartados)

Cada paso es chico, reversible y aditivo. El objetivo transversal es que **las
decisiones del usuario (aceptar/descartar) refinen** las futuras
clasificaciones.

**Paso 1 — Registrar la señal del usuario (dato, sin cambiar comportamiento).**
Hoy el estado del nicho ya existe (`NicheStatus`). Empezar a *interpretarlo* como
feedback: un nicho `EXPLORANDO`/en seguimiento = "aceptado"; `DESCARTADO` =
"rechazado". No requiere schema nuevo; solo leerlo.

**Paso 2 — Mostrar los aceptados/descartados como ejemplos al clasificador.**
Igual que el flujo principal ya pasa `UserExample[]` al prompt
(`classifier.ts`), pasar al `niche-classifier.ts` unos pocos ejemplos recientes
de nichos aceptados y descartados de esa empresa (organismo + objeto + códigos).
Así la IA calibra el límite adyacente/fuera con casos reales de la empresa.

**Paso 3 — Prefiltro por catálogo para productos (sección 5).** Cruzar
`articleCodes` del fallo contra `catalogArticleIds` de la empresa antes de la IA;
usarlo como boost de `fitScore` o como override suave de categoría. Determinista,
barato y explicable.

**Paso 4 — Enriquecer el prompt de servicios con `CompanyProfile`.** Sumar
certificaciones, casos de éxito y diferenciadores al `buildUserMessage()` del
clasificador de nichos, para empresas de servicios/mixtas.

**Paso 5 — Umbral configurable y revisión de FUERA.** Exponer un control por
empresa (más/menos conservador) que ajuste el corte adyacente/fuera, y hacer más
visible la vista de auditoría de FUERA para corregir falsos negativos; cada
corrección es, a su vez, feedback para el Paso 2.

**Paso 6 — Consolidar el aprendizaje.** Con los pasos anteriores midiendo
aceptados/descartados, ajustar pesos del puntaje (`niche-score.ts`) y, si hace
falta, persistir un pequeño historial de feedback por empresa para que el
refinamiento sea estable entre corridas.

> Nota de alcance: la implementación de "nichos descartados que enseñan" (Parte 4
> del lote) está **pendiente de confirmación de Marcelo**; este documento solo
> propone el diseño, no lo implementa.
