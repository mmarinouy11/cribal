# Cribal

Plataforma multi-tenant que monitorea las publicaciones de compras estatales de
Uruguay (ARCE — comprasestatales.gub.uy), clasifica oportunidades de negocio con
IA y envía un resumen diario por email a cada empresa configurada.

Este repositorio contiene:

- **Fase 1**: setup del proyecto, esquema de base de datos, pipeline de
  procesamiento y digest por email.
- **Fase 2**: autenticación (NextAuth v5), dashboard, listado y detalle de
  oportunidades, e historial de ejecuciones. Multi-tenant: cada usuario solo ve
  los datos de su empresa.
- **Fase 3**: configuración self-service del pipeline, perfil de empresa, y
  generador de propuestas comerciales con IA (edición inline y exportación a Word).
- **Fase 4**: cron de Railway (endpoint protegido por token), registro público
  de empresas, panel de administración y aislamiento multi-tenant reforzado.
- **Fase 5**: enriquecimiento automático desde ARCE (fechas de cierre, ítems,
  contacto, pliego), timeline de vencimientos y alertas de urgencia, e
  inteligencia de mercado on-demand (adjudicaciones históricas, competidores y
  rangos de precio) con resumen de IA.

> Convención de idioma: todo el código, comentarios y nombres de variables en
> inglés. Todo el texto de cara al usuario (logs, contenido de emails, valores de
> strings en la base de datos) en español.

## Stack

- Next.js 14 (App Router) + TypeScript strict
- PostgreSQL + Prisma
- NextAuth v5 (autenticación por credenciales) + bcryptjs
- Anthropic SDK (`claude-sonnet-4-6`) — clasificación y generación de propuestas
- Resend (email)
- rss-parser (feeds RSS)
- docx + file-saver (exportación de propuestas a Word)
- node-cron (scheduling local para desarrollo)
- Tailwind CSS (UI)

## Setup local

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Crear el archivo `.env` (basado en `.env.example`):

   ```env
   DATABASE_URL=postgresql://...
   ANTHROPIC_API_KEY=sk-ant-...
   RESEND_API_KEY=re_...
   EMAIL_FROM=onboarding@resend.dev
   NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
   NEXTAUTH_URL=http://localhost:3000
   SEED_USER_PASSWORD=cribal2024
   ```

3. Aplicar el esquema a la base de datos y generar el cliente Prisma:

   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. Cargar la empresa inicial (Tenarai LATAM), el usuario inicial y correr el
   pipeline:

   ```bash
   npm run seed        # empresa Tenarai LATAM
   npm run seed:user   # usuario marcelo.marino@infogain.com
   npm run pipeline    # ejecuta el pipeline
   ```

5. Levantar el dashboard e iniciar sesión en `/login`:

   ```bash
   npm run dev
   ```

## Scripts

| Script              | Descripción                                                   |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo Next.js                                |
| `npm run build`     | Build de producción                                           |
| `npm run start`     | Servidor de producción                                        |
| `npm run lint`      | ESLint                                                        |
| `npm run seed`      | Carga la configuración inicial de la empresa (Tenarai LATAM)  |
| `npm run seed:user` | Crea el usuario inicial (requiere `npm run seed` antes)       |
| `npm run pipeline`  | Ejecuta el pipeline para todas las empresas activas           |
| `npm run scheduler` | Scheduler local (L-V 20:00 Montevideo) para desarrollo        |

## Pipeline

El pipeline (`src/lib/pipeline.ts`) ejecuta, por empresa:

1. Carga la configuración de la empresa.
2. Crea un registro `Run` con estado `RUNNING`.
3. Descarga los feeds RSS en paralelo.
4. Normaliza cada item a `NormalizedTender`.
5. Filtra por ventana de fechas (`lookbackDays`).
6. Deduplica dentro del run por `tenderId`.
7. Aplica filtros en secuencia (keywords → exclusiones → stage gate → duplicados
   en DB). Cada item se guarda como `RawPublication` con su resultado y razón.
8. Actualiza los contadores del run.
9. Clasifica los llamados que pasaron todos los filtros con Claude (en lotes de 20).
10. Guarda las oportunidades relevantes (`isRelevant && score >= minimumScore`).
11. Actualiza el contador de oportunidades guardadas.
12. Envía el digest por email.
13. Marca el run como `COMPLETED`.

## Dashboard (Fase 2)

Rutas protegidas por sesión (redirigen a `/login` si no hay sesión). Cada
consulta filtra por `companyId` — un usuario nunca ve datos de otra empresa.

| Ruta                    | Descripción                                              |
| ----------------------- | -------------------------------------------------------- |
| `/login`                | Login por credenciales                                   |
| `/register`             | Registro público de empresa (3 pasos)                    |
| `/`                     | Dashboard con métricas y oportunidades recientes         |
| `/oportunidades`        | Listado con filtros (estado, score, categoría, búsqueda) |
| `/oportunidades/[id]`   | Detalle de la oportunidad + panel de revisión            |
| `/ejecuciones`          | Historial de ejecuciones con todos los contadores        |
| `/ejecuciones/[id]`     | Embudo del pipeline + publicaciones crudas               |
| `/perfil`               | Perfil de empresa (usado para generar propuestas)        |
| `/configuracion`        | Edición self-service de todos los parámetros del pipeline |
| `/admin`                | Panel de administración (solo rol `ADMIN`)               |

La autenticación usa NextAuth v5 con estrategia JWT. El middleware usa una
configuración *edge-safe* (`src/lib/auth.config.ts`) que no importa Prisma ni
bcrypt; el proveedor de credenciales completo vive en `src/lib/auth.ts`.

## API

- `POST /api/runs` — dispara un run. Dos llamadores válidos:
  - **Cron de Railway**: header `Authorization: Bearer $CRON_SECRET` → corre
    todas las empresas activas.
  - **Usuario autenticado**: corre su propia empresa (los admins, cualquiera).

  Responde inmediatamente y ejecuta el pipeline en segundo plano.
- `GET /api/runs?companyId=xxx&limit=10` — historial de runs. Los usuarios
  regulares solo ven su empresa; los admins pueden filtrar por cualquiera.

## Enriquecimiento e inteligencia de mercado (Fase 5)

- **Enriquecimiento** (`src/lib/scraper/`): al guardarse una oportunidad, se
  descarga su página de detalle en ARCE (con `User-Agent: Mozilla/5.0
  (compatible; Cribal/1.0)`) y se extraen fechas de cierre/apertura, ítems con
  código de artículo, contacto y pliego. Es *fire-and-forget* — nunca bloquea el
  pipeline. También hay un botón "Actualizar datos ARCE" para re-enriquecer.
- **Urgencia** (`src/lib/pipeline/urgency.ts`, `src/lib/urgency-utils.ts`): días
  hábiles hasta el cierre, timeline de 14 días en el dashboard, sección
  "Atención requerida" y email de alerta cuando una oportunidad RELEVANTE cierra
  en ≤ 3 días hábiles.
- **Mercado** (`src/lib/scraper/market-intelligence.ts`): análisis on-demand
  (solo estados Relevante/Revisando). Busca adjudicaciones históricas por código
  de artículo o keyword, arma el mapa de competidores, estima rangos de precio
  (percentiles 25–75) y genera un resumen con Claude. Se ejecuta solo por acción
  explícita del usuario (tiene costo de API).

## Multi-tenant

Cada consulta a `Opportunity`, `Run`, `RawPublication` y `Proposal` se filtra por
`companyId`. `opportunityId` es único **por empresa** (`@@unique([companyId,
opportunityId])`), así que dos empresas pueden seguir el mismo llamado sin
colisionar. Los admins pueden ver datos de cualquier empresa vía el parámetro
`?companyId=` (`getEffectiveCompanyId` en `src/lib/tenant.ts`); los usuarios
regulares quedan siempre acotados a su empresa.

## Despliegue en Railway

1. **Servicio Next.js** — conectado al repo de GitHub, auto-deploy en cada push.
2. **PostgreSQL** — `DATABASE_URL` se inyecta automáticamente por Railway.
3. **Cron job** — se configura como un **servicio de cron separado en Railway**
   (Settings → Cron Schedule), NO en `railway.json` (Railway no soporta cron en
   ese archivo; cualquier bloque `cronJobs` ahí se ignora en silencio). El
   servicio corre con schedule `0 11 * * 1-5` (UTC; 08:00 Montevideo) y como
   comando un curl que dispara el endpoint:

   ```
   curl -s -X POST "$APP_URL/api/runs" \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json"
   ```

   El endpoint valida el token y corre el pipeline de todas las empresas activas.
   No depende de ninguna máquina local.

Variables de entorno a configurar en el dashboard de Railway:

```
ANTHROPIC_API_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
NEXTAUTH_SECRET=...   # generar con `openssl rand -base64 32`
NEXTAUTH_URL=https://cribal-production.up.railway.app
CRON_SECRET=...       # generar con `openssl rand -base64 32`
```

> El cliente de Prisma se genera automáticamente en `postinstall`. Recordá correr
> `npx prisma migrate deploy` contra la base de producción para aplicar las
> migraciones.
