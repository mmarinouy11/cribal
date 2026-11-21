import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { LogoMark } from '@/components/ui/logo'

// Public marketing home. Identity (navy #0c1e3c, cyan #06b6d4, light bg #f0f9ff,
// Geist font, the LogoMark) is taken from the app's own tokens — globals.css,
// tailwind.config.ts and components/ui/logo.tsx — since the repo has no separate
// brand guide. Nothing here is invented: pricing and testimonials are left as
// visible TODOs because they are not defined yet.

export const metadata: Metadata = {
  title: 'Cribal — Oportunidades de compras estatales con IA',
  description:
    'Cribal monitorea ARCE todos los días hábiles, clasifica cada licitación con IA según tu empresa y te avisa por email solo lo que te conviene.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_UY',
    title: 'Cribal — Oportunidades de compras estatales con IA',
    description:
      'Monitoreo diario de ARCE, clasificación con IA y alertas solo de lo relevante para tu empresa.',
    siteName: 'Cribal',
  },
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Contanos de tu empresa',
    body: 'Describís a qué se dedica tu empresa y qué productos o servicios ofrece. Cribal arma tu configuración inicial.',
  },
  {
    n: '2',
    title: 'Cribal revisa ARCE por vos',
    body: 'Todos los días hábiles descargamos las publicaciones de compras estatales y las clasificamos con IA según tu perfil.',
  },
  {
    n: '3',
    title: 'Recibís solo lo que importa',
    body: 'Te avisamos por email cuando hay una oportunidad relevante o un cierre próximo. El resto queda en tu tablero, priorizado.',
  },
]

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: 'ti-radar',
    title: 'Monitoreo diario de ARCE',
    body: 'Revisamos las compras estatales cada día hábil, sin que tengas que entrar a buscar.',
  },
  {
    icon: 'ti-brain',
    title: 'Clasificación con IA',
    body: 'Cada licitación se evalúa según lo que hace tu empresa y recibe un puntaje de relevancia.',
  },
  {
    icon: 'ti-mail',
    title: 'Avisos solo de lo relevante',
    body: 'Email cuando aparece algo que te conviene o cuando se acerca un cierre que estás trabajando.',
  },
  {
    icon: 'ti-bulb',
    title: 'Nichos de oportunidad',
    body: 'Detectamos licitaciones que quedaron desiertas o con ofertas rechazadas: demanda estatal insatisfecha.',
  },
  {
    icon: 'ti-clock-hour-4',
    title: 'Recordatorios de cierre',
    body: 'Te recordamos los cierres de las oportunidades que estás trabajando, a 3 y a 1 día.',
  },
  {
    icon: 'ti-layout-dashboard',
    title: 'Tablero priorizado',
    body: 'Todas tus oportunidades en un panel, ordenadas por lo que más conviene atender primero.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: '¿Qué es ARCE?',
    a: 'Es el sistema de compras y contrataciones del Estado uruguayo (comprasestatales.gub.uy), donde los organismos públicos publican sus licitaciones.',
  },
  {
    q: '¿De dónde salen las oportunidades?',
    a: 'De las publicaciones oficiales de ARCE. Cribal las descarga, las normaliza y las analiza; no inventamos oportunidades ni usamos fuentes privadas.',
  },
  {
    q: '¿Cómo se decide qué es relevante?',
    a: 'Una IA compara cada licitación con la descripción y las capacidades de tu empresa, le da un puntaje y marca como relevante lo que supera tu umbral.',
  },
  {
    q: '¿Qué pasa con mis datos?',
    a: 'Usamos los datos de tu empresa solo para clasificar oportunidades para vos. No los compartimos con terceros.',
  },
  {
    q: '¿Cuánto tarda en empezar a funcionar?',
    a: 'Apenas te registrás ya podés correr la primera criba; después corre sola todos los días hábiles según la cadencia que elijas.',
  },
]

export default async function LandingPage() {
  const session = await auth()
  const isLoggedIn = Boolean(session)

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-[#475569]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#e0f2fe] bg-[#f0f9ff]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Cribal — inicio">
            <LogoMark size={28} />
            <span
              className="text-xl font-semibold text-[#0c1e3c]"
              style={{ letterSpacing: '-0.5px' }}
            >
              cribal
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            {isLoggedIn ? (
              <Link
                href="/tablero"
                className="rounded-lg bg-[#06b6d4] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0891b2]"
              >
                Ir al tablero
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[#0c1e3c] transition-colors hover:bg-white"
                >
                  Iniciar sesión
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-[#06b6d4] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0891b2]"
                >
                  Crear cuenta
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="bg-[#0c1e3c] px-4 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#1e3a5f] bg-[#162d52] px-3 py-1 text-xs font-medium text-[#cffafe]">
              <i className="ti ti-radar text-[#06b6d4]" aria-hidden /> Compras estatales de Uruguay
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-[-0.5px] sm:text-5xl">
              Cribal monitorea ARCE, clasifica con IA y te avisa solo lo que conviene
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-[#cbd5e1]">
              Dejá de revisar licitaciones a mano. Cribal lee las compras estatales todos los días
              hábiles, las evalúa según tu empresa y te manda solo las que valen la pena.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {isLoggedIn ? (
                <Link
                  href="/tablero"
                  className="w-full rounded-lg bg-[#06b6d4] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0891b2] sm:w-auto"
                >
                  Ir al tablero
                </Link>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="w-full rounded-lg bg-[#06b6d4] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0891b2] sm:w-auto"
                  >
                    Crear cuenta
                  </Link>
                  <Link
                    href="/login"
                    className="w-full rounded-lg border border-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#162d52] sm:w-auto"
                  >
                    Iniciar sesión
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="px-4 py-16 sm:py-20" aria-labelledby="como-funciona">
          <div className="mx-auto max-w-5xl">
            <h2
              id="como-funciona"
              className="text-center text-2xl font-semibold tracking-[-0.3px] text-[#0c1e3c] sm:text-3xl"
            >
              Cómo funciona
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div
                  key={step.n}
                  className="rounded-xl border border-[#e0f2fe] bg-white p-6 shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#cffafe] text-lg font-semibold text-[#0e7490]">
                    {step.n}
                  </div>
                  <h3 className="mt-4 font-semibold text-[#0c1e3c]">{step.title}</h3>
                  <p className="mt-2 text-sm text-[#475569]">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Qué incluye */}
        <section className="bg-white px-4 py-16 sm:py-20" aria-labelledby="que-incluye">
          <div className="mx-auto max-w-5xl">
            <h2
              id="que-incluye"
              className="text-center text-2xl font-semibold tracking-[-0.3px] text-[#0c1e3c] sm:text-3xl"
            >
              Qué incluye
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-[#e0f2fe] bg-[#f8fafc] p-6"
                >
                  <i className={`ti ${feature.icon} text-2xl text-[#06b6d4]`} aria-hidden />
                  <h3 className="mt-3 font-semibold text-[#0c1e3c]">{feature.title}</h3>
                  <p className="mt-2 text-sm text-[#475569]">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Para quién */}
        <section className="px-4 py-16 sm:py-20" aria-labelledby="para-quien">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="para-quien"
              className="text-2xl font-semibold tracking-[-0.3px] text-[#0c1e3c] sm:text-3xl"
            >
              ¿Para quién es?
            </h2>
            <p className="mt-4 text-balance text-lg text-[#475569]">
              Para cualquier empresa que le venda al Estado, de cualquier rubro. Da igual si ofrecés
              productos o servicios: Cribal aprende qué hacés y busca las oportunidades que encajan.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <span className="rounded-full border border-[#e0f2fe] bg-white px-4 py-1.5 text-sm text-[#0c1e3c]">
                Empresas de productos
              </span>
              <span className="rounded-full border border-[#e0f2fe] bg-white px-4 py-1.5 text-sm text-[#0c1e3c]">
                Empresas de servicios
              </span>
              <span className="rounded-full border border-[#e0f2fe] bg-white px-4 py-1.5 text-sm text-[#0c1e3c]">
                Cualquier rubro
              </span>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="bg-white px-4 py-16 sm:py-20" aria-labelledby="faq">
          <div className="mx-auto max-w-3xl">
            <h2
              id="faq"
              className="text-center text-2xl font-semibold tracking-[-0.3px] text-[#0c1e3c] sm:text-3xl"
            >
              Preguntas frecuentes
            </h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-xl border border-[#e0f2fe] bg-[#f8fafc] p-5 [&_summary]:cursor-pointer"
                >
                  <summary className="flex items-center justify-between font-medium text-[#0c1e3c] marker:content-none">
                    {item.q}
                    <i
                      className="ti ti-chevron-down text-[#06b6d4] transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <p className="mt-3 text-sm text-[#475569]">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* TODO: content not defined yet — clearly marked so the team can fill or
            remove it. Listed in the Part 5 summary / docs. */}
        <section className="px-4 py-10" aria-label="Contenido pendiente de definir">
          <div className="mx-auto max-w-3xl space-y-3">
            <div className="rounded-xl border-2 border-dashed border-[#f59e0b] bg-[#fffbeb] p-5 text-sm text-[#92400e]">
              <strong>TODO:</strong> Planes y precios — no están definidos todavía. No se muestran
              cifras inventadas.
            </div>
            <div className="rounded-xl border-2 border-dashed border-[#f59e0b] bg-[#fffbeb] p-5 text-sm text-[#92400e]">
              <strong>TODO:</strong> Testimonios y logos de clientes — pendientes de aportar. No se
              inventan.
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="bg-[#0c1e3c] px-4 py-16 text-center text-white sm:py-20">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.4px]">
              Empezá a recibir solo las oportunidades que te convienen
            </h2>
            <p className="mt-4 text-[#cbd5e1]">
              Registrá tu empresa y dejá que Cribal revise ARCE por vos.
            </p>
            <div className="mt-8">
              <Link
                href={isLoggedIn ? '/tablero' : '/register'}
                className="inline-block rounded-lg bg-[#06b6d4] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0891b2]"
              >
                {isLoggedIn ? 'Ir al tablero' : 'Crear cuenta'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e0f2fe] bg-[#f0f9ff] px-4 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm text-[#94a3b8] sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark size={22} />
            <span className="font-semibold text-[#0c1e3c]" style={{ letterSpacing: '-0.3px' }}>
              cribal
            </span>
            <span>— Inteligencia de oportunidades</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/login" className="hover:text-[#0c1e3c]">
              Iniciar sesión
            </Link>
            <Link href="/register" className="hover:text-[#0c1e3c]">
              Crear cuenta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
