# Nichos descartados que enseñan — diseño propuesto

> **Estado: SOLO DISEÑO. No implementar hasta confirmación de Marcelo.**
> Este documento propone el mecanismo; no cambia código.

## Problema

Hoy, cuando el usuario descarta un nicho (lo pasa a `DESCARTADO`), esa decisión
**no vuelve** como señal a la IA. El clasificador de fallos
(`src/lib/pipeline/niche-classifier.ts`) sólo recibe `companyName`,
`description` y `capabilities`; no ve qué nichos aceptó o descartó la empresa.
Resultado: la IA repite el mismo criterio corrida tras corrida, incluso sobre
rubros/organismos que el usuario ya dijo que no le interesan. (Ver análisis en
`docs/niches-logic.md`, secciones 2 y 4.)

## Objetivo

Que **aceptar/descartar** nichos refine las futuras clasificaciones, con un
mecanismo chico, explicable y reversible, sin reescribir el pipeline.

## Señal de aprendizaje (qué cuenta como "enseñar")

Reutilizar el estado que ya existe (`NicheStatus`), sin schema nuevo para la
primera versión:

- **Descartado** = señal negativa: `status = DESCARTADO`.
- **Aceptado** = señal positiva: `status = EXPLORANDO` (o, más fuerte, un nicho
  con `notes`/`aiAnalysis`, que indica trabajo real del usuario).
- `NUEVO`/`ARCHIVADO` no aportan señal.

Cada señal se resume por su contenido estable: `organismo`, `articleCode`,
`objectDescription` (objeto) y `category` previa.

## Mecanismo propuesto (en pasos pequeños)

**Paso A — Pasar ejemplos al prompt (como ya hace el flujo principal).**
`src/lib/pipeline/classifier.ts` ya inyecta `UserExample[]` al prompt. Replicar
eso en `niche-classifier.ts`: antes de clasificar, cargar unos pocos (p. ej. 5)
nichos **descartados** y 5 **aceptados** recientes de la empresa, y agregarlos al
`buildUserMessage()` como calibración: "esta empresa descartó estos; aceptó
estos; ajustá tu criterio en consecuencia". Esto solo cambia el prompt, no la
estructura de datos.

**Paso B — Ajuste determinista por regla antes/después de la IA.**
Para un fallo cuyo `organismo + articleCode` (o cuyo objeto, por similitud de
texto) coincide con un nicho **descartado** por la empresa, bajar su `fitScore`
o degradar su `category` a `FUERA` salvo que la IA lo marque con alta confianza.
Es barato, explicable y no depende de que la IA "recuerde".

**Paso C — Umbral y transparencia.**
Exponer en la UI por qué un fallo fue degradado ("coincide con un nicho que
descartaste") y permitir deshacerlo. Cada corrección es, a su vez, nueva señal.

## Persistencia (si hace falta ir más allá del estado actual)

Si con el estado del nicho no alcanza (p. ej. se quiere recordar descartes de
fallos que nunca llegaron a ser nicho), agregar una tabla chica y **aditiva**:

```
NicheFeedback {
  id, companyId,
  signalKey   // organismo||articleCode (o hash del objeto)
  decision    // ACCEPTED | DISCARDED
  createdAt
}
```

Se escribe cuando el usuario cambia el estado del nicho; se lee en el Paso A/B.
No borra ni cambia nada de lo existente.

## Riesgos y mitigaciones

- **Sobre-filtrar:** un descarte puntual no debería esconder todo un organismo.
  Mitigar exigiendo coincidencia por `articleCode`/objeto, no sólo por organismo,
  y permitiendo deshacer (Paso C).
- **Pocos datos al principio:** con 0–1 señales, el Paso A es inocuo (no cambia
  casi nada) y el Paso B no dispara. El sistema mejora a medida que hay feedback.
- **Coste de IA:** sumar ejemplos al prompt es barato frente a re-clasificar;
  el Paso B incluso evita llamadas para fallos claramente descartados.

## Alcance de la primera entrega (cuando se apruebe)

Paso A + Paso B con el estado del nicho ya existente (sin tabla nueva), más la
explicación en UI del Paso C. La tabla `NicheFeedback` queda para una segunda
iteración si se necesita memoria más allá del estado del nicho.
