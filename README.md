# Cribal

Plataforma multi-tenant que monitorea las publicaciones de compras estatales de
Uruguay (ARCE — comprasestatales.gub.uy), clasifica oportunidades de negocio con
IA y envía un resumen diario por email a cada empresa configurada.

Este repositorio contiene la **Fase 1**: setup del proyecto, esquema de base de
datos, pipeline de procesamiento y digest por email. Todavía sin UI — el objetivo
es un pipeline end-to-end funcionando, desplegable en Railway.

> Convención de idioma: todo el código, comentarios y nombres de variables en
> inglés. Todo el texto de cara al usuario (logs, contenido de emails, valores de
> strings en la base de datos) en español.

## Stack

- Next.js 14 (App Router) + TypeScript strict
- PostgreSQL + Prisma
- Anthropic SDK (`claude-sonnet-4-6`)
- Resend (email)
- rss-parser (feeds RSS)
- node-cron (scheduling local para desarrollo)

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
   ```

3. Aplicar el esquema a la base de datos y generar el cliente Prisma:

   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. Cargar la empresa inicial (Tenarai LATAM) y correr el pipeline:

   ```bash
   npm run seed
   npm run pipeline
   ```

## Scripts

| Script              | Descripción                                                   |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo Next.js                                |
| `npm run build`     | Build de producción                                           |
| `npm run start`     | Servidor de producción                                        |
| `npm run lint`      | ESLint                                                        |
| `npm run seed`      | Carga la configuración inicial de la empresa (Tenarai LATAM)  |
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

## API

- `POST /api/runs` — dispara un run. Body opcional `{ companyId }`; sin él corre
  para todas las empresas activas. Responde inmediatamente y ejecuta el pipeline
  en segundo plano.
- `GET /api/runs?companyId=xxx&limit=10` — historial de runs con todos los
  contadores, ordenado por `startedAt` descendente.

## Despliegue en Railway

1. **Servicio Next.js** — conectado al repo de GitHub, auto-deploy en cada push.
2. **PostgreSQL** — `DATABASE_URL` se inyecta automáticamente por Railway.
3. **Cron job** — `curl -X POST https://cribal.up.railway.app/api/runs` con
   schedule `0 20 * * 1-5`.

Variables de entorno a configurar en el dashboard de Railway:

```
ANTHROPIC_API_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
```

> El cliente de Prisma se genera automáticamente en `postinstall`. Recordá correr
> `npx prisma migrate deploy` contra la base de producción para aplicar las
> migraciones.
