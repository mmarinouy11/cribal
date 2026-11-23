import Anthropic from '@anthropic-ai/sdk'
import { AiServiceError, isFatalAiError, logAiError } from './errors'

// Robust batch classification shared by the onboarding sample and the daily
// pipeline. Key properties:
//  - Structured output via tool_use (`input_schema` + `strict` + forced
//    tool_choice) instead of free-text JSON, so the model returns schema-valid
//    data the SDK parses for us.
//  - Small batches run with bounded parallelism.
//  - `stop_reason` is always checked: `max_tokens` means the output was cut off,
//    so the batch is retried split in half; a single item that still truncates
//    is left unclassified rather than lost.
//  - Tolerant: a partial response still yields its complete items; only the
//    missing ids are retried or reported as unclassified.
// Items that cannot be classified are returned as `unclassifiedIds` (never
// silently dropped). A fatal infra error (billing / rate limit / outage) is
// rethrown as AiServiceError so the caller can fail/park the run.

/** One per-item result extracted from the tool input, tagged with its id. */
export interface IdentifiedResult<TResult> {
  id: string
  result: TResult
}

export interface BatchClassifyConfig<TItem, TResult> {
  context: string // label for [CRIBAL][AI] logs
  model: string
  system: string
  items: TItem[]
  idOf: (item: TItem) => string
  buildUserMessage: (batch: TItem[]) => string
  tool: {
    name: string
    description: string
    inputSchema: Anthropic.Tool.InputSchema
  }
  /** Pull per-item results out of the tool input; must tolerate partial input. */
  extractResults: (toolInput: unknown) => IdentifiedResult<TResult>[]
  batchSize?: number // default 8
  maxParallel?: number // default 3
  maxTokensFor?: (batchLen: number) => number
}

export interface BatchClassifyOutcome<TResult> {
  byId: Map<string, TResult>
  unclassifiedIds: string[]
}

const DEFAULT_BATCH_SIZE = 8
const DEFAULT_MAX_PARALLEL = 3

/** Room for one result per item plus the tool wrapper; capped for safety. */
function defaultMaxTokens(batchLen: number): number {
  return Math.min(4096, 400 + batchLen * 200)
}

let cachedClient: Anthropic | null = null
function getClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return cachedClient
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/** Thrown internally when a response cannot be parsed; never leaves the module. */
class ParseError extends Error {}

export async function batchClassify<TItem, TResult>(
  config: BatchClassifyConfig<TItem, TResult>
): Promise<BatchClassifyOutcome<TResult>> {
  const {
    context,
    model,
    system,
    items,
    idOf,
    buildUserMessage,
    tool,
    extractResults,
    batchSize = DEFAULT_BATCH_SIZE,
    maxParallel = DEFAULT_MAX_PARALLEL,
    maxTokensFor = defaultMaxTokens,
  } = config

  if (items.length === 0) return { byId: new Map(), unclassifiedIds: [] }

  const client = getClient()

  // One model call for a batch. Returns the parsed results (possibly partial)
  // and whether the output was truncated. Throws AiServiceError (fatal) or
  // ParseError (unusable, non-truncated response).
  async function callModel(
    batch: TItem[]
  ): Promise<{ map: Map<string, TResult>; truncated: boolean }> {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokensFor(batch.length),
        system,
        tools: [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
            strict: true,
          },
        ],
        tool_choice: { type: 'tool', name: tool.name, disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: buildUserMessage(batch) }],
      })
    } catch (apiError) {
      const classified = logAiError(context, apiError)
      if (isFatalAiError(classified.type)) throw new AiServiceError(classified)
      throw apiError
    }

    const truncated = response.stop_reason === 'max_tokens'
    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    const map = new Map<string, TResult>()
    if (toolBlock) {
      let extracted: IdentifiedResult<TResult>[] = []
      try {
        extracted = extractResults(toolBlock.input)
      } catch {
        extracted = []
      }
      for (const { id, result } of extracted) {
        if (id) map.set(id, result)
      }
    }

    if (truncated) {
      console.warn(
        `[CRIBAL][AI] ${context} — tipo=truncated lote=${batch.length} stop_reason=max_tokens rescatados=${map.size}`
      )
    } else if (map.size === 0) {
      console.error(
        `[CRIBAL][AI] ${context} — tipo=parse_error lote=${batch.length} stop_reason=${response.stop_reason ?? 'n/a'}`
      )
      throw new ParseError()
    }

    return { map, truncated }
  }

  // Resolve one batch to results + unclassified ids, retrying once on a parse
  // failure and splitting in half on truncation / missing items.
  async function resolve(batch: TItem[], attempt = 0): Promise<BatchClassifyOutcome<TResult>> {
    let outcome: { map: Map<string, TResult>; truncated: boolean }
    try {
      outcome = await callModel(batch)
    } catch (error) {
      if (error instanceof AiServiceError) throw error
      if (attempt === 0) return resolve(batch, 1)
      if (batch.length > 1) return splitAndResolve(batch)
      return { byId: new Map(), unclassifiedIds: batch.map(idOf) }
    }

    const { map, truncated } = outcome
    const missing = batch.filter((item) => !map.has(idOf(item)))
    if (missing.length === 0) return { byId: map, unclassifiedIds: [] }

    // Some items are missing (truncated, or the model skipped them). If the batch
    // can still be split, re-run just the missing items in smaller batches and
    // keep the ones we already classified.
    if (batch.length > 1) {
      const sub = await splitAndResolve(missing)
      for (const [id, result] of map) sub.byId.set(id, result)
      return sub
    }

    // A single item we could not classify: leave it for the next attempt/run.
    void truncated
    return { byId: map, unclassifiedIds: missing.map(idOf) }
  }

  async function splitAndResolve(batch: TItem[]): Promise<BatchClassifyOutcome<TResult>> {
    const mid = Math.ceil(batch.length / 2)
    const [left, right] = [batch.slice(0, mid), batch.slice(mid)]
    const [a, b] = [await resolve(left), await resolve(right)]
    const byId = new Map<string, TResult>([...a.byId, ...b.byId])
    return { byId, unclassifiedIds: [...a.unclassifiedIds, ...b.unclassifiedIds] }
  }

  // Run the top-level batches with bounded parallelism. A fatal AiServiceError
  // from any batch aborts the whole run.
  const batches = chunk(items, batchSize)
  const outcomes: BatchClassifyOutcome<TResult>[] = new Array(batches.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      if (index >= batches.length) return
      outcomes[index] = await resolve(batches[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxParallel, batches.length) }, () => worker()))

  const byId = new Map<string, TResult>()
  const unclassifiedIds: string[] = []
  for (const outcome of outcomes) {
    for (const [id, result] of outcome.byId) byId.set(id, result)
    unclassifiedIds.push(...outcome.unclassifiedIds)
  }

  console.log(
    `[CRIBAL][AI] ${context} — clasificadas=${byId.size} sin_clasificar=${unclassifiedIds.length} (lotes de ${batchSize})`
  )
  return { byId, unclassifiedIds }
}
