import type { AnyTRPCProcedure, AnyTRPCRouter, TRPCProcedureBuilder, TRPCRouterRecord } from "@trpc/server"
import type { Lazy, Parser, ProcedureType, UnsetMarker } from "@trpc/server/unstable-core-do-not-import"
import { Effect } from "effect"
import type { ManagedRuntime } from "effect"
import type { YieldWrap } from "effect/Utils"
import { _parse } from "zod/v4/core"

// Symbol to mark Effect procedures
const EffectProcedureSymbol: unique symbol = Symbol.for("@trpc-effect/EffectProcedure") as any

/**
 * Options passed to an Effect procedure resolver
 */
export interface EffectProcedureResolverOptions<TContext, TInput> {
  readonly ctx: TContext
  readonly input: TInput
  readonly signal: AbortSignal | undefined
}

/**
 * An Effect query procedure - a native Effect procedure type
 */
export interface EffectQueryProcedure<TInput, TOutput, TError, TContext, TRequirements> {
  readonly [EffectProcedureSymbol]: typeof EffectProcedureSymbol
  readonly _tag: "query"
  readonly _input: TInput
  readonly _output: TOutput
  readonly _error: TError
  readonly _context: TContext
  readonly _requirements: TRequirements
  readonly _captureStackTrace: any
  readonly _resolver: (
    opts: EffectProcedureResolverOptions<TContext, TInput>
  ) => Generator<YieldWrap<Effect.Effect<any, TError, TRequirements>>, TOutput, never>
  readonly _builder: TRPCProcedureBuilder<any, any, any, any, any, any, any, false>
}

/**
 * An Effect mutation procedure - a native Effect procedure type
 */
export interface EffectMutationProcedure<TInput, TOutput, TError, TContext, TRequirements> {
  readonly [EffectProcedureSymbol]: typeof EffectProcedureSymbol
  readonly _tag: "mutation"
  readonly _input: TInput
  readonly _output: TOutput
  readonly _error: TError
  readonly _context: TContext
  readonly _requirements: TRequirements
  readonly _captureStackTrace: any
  readonly _resolver: (
    opts: EffectProcedureResolverOptions<TContext, TInput>
  ) => Generator<YieldWrap<Effect.Effect<any, TError, TRequirements>>, TOutput, never>
  readonly _builder: TRPCProcedureBuilder<any, any, any, any, any, any, any, false>
}

/**
 * Any Effect query procedure
 */
export type AnyEffectQueryProcedure = EffectQueryProcedure<any, any, any, any, any>

/**
 * Any Effect mutation procedure
 */
export type AnyEffectMutationProcedure = EffectMutationProcedure<any, any, any, any, any>

/**
 * Any Effect procedure (query or mutation)
 */
export type AnyEffectProcedure = AnyEffectQueryProcedure | AnyEffectMutationProcedure

/**
 * A procedure definition that matches tRPC's internal Procedure type.
 * This makes our Effect procedures compatible with tRPC's type inference.
 */
interface EffectProcedureDef<TType extends ProcedureType, TInput, TOutput> {
  _def: {
    $types: { input: TInput; output: TOutput }
    procedure: true
    type: TType
    meta: unknown
    experimental_caller: boolean
    inputs: Array<Parser>
  }
  meta: unknown
  (opts: unknown): Promise<TOutput>
}

/**
 * Convert an Effect procedure to a tRPC-compatible procedure type for type inference.
 * This creates a type that satisfies AnyProcedure for tRPC's client type inference.
 */
type EffectProcedureToTRPC<T> = T extends
  { readonly _tag: "query"; readonly _input: infer TInput; readonly _output: infer TOutput }
  ? EffectProcedureDef<"query", TInput, TOutput>
  : T extends { readonly _tag: "mutation"; readonly _input: infer TInput; readonly _output: infer TOutput }
    ? EffectProcedureDef<"mutation", TInput, TOutput>
  : T

/**
 * Check if type has the Effect procedure symbol
 */
type IsEffectProcedure<T> = T extends { readonly _tag: "query" | "mutation"; readonly _resolver: unknown } ? true
  : false

/**
 * Check if type is a tRPC procedure
 */
type IsTRPCProcedure<T> = T extends { _def: { procedure: true } } ? true : false

/**
 * Transform an EffectRouterRecord into a proper RouterRecord type
 */
type TransformEffectRouterRecord<T> = {
  [K in keyof T]: IsEffectProcedure<T[K]> extends true ? EffectProcedureToTRPC<T[K]>
    : IsTRPCProcedure<T[K]> extends true ? T[K]
    : T[K] extends object ? TransformEffectRouterRecord<T[K]>
    : T[K]
}

/**
 * An Effect procedure builder that wraps a tRPC procedure builder
 * and provides Effect-native methods for defining procedures.
 *
 * @typeParam TRequirements - The Effect requirements provided by the ManagedRuntime
 */
export interface EffectProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TRequirements
> {
  /**
   * The underlying tRPC procedure builder
   */
  readonly _procedure: TRPCProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    false
  >

  /**
   * Add an input parser to the procedure
   */
  input<TNewInputIn, TNewInputOut>(
    schema: Parser & { _input: TNewInputIn; _output: TNewInputOut }
  ): EffectProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TNewInputIn,
    TNewInputOut,
    TOutputIn,
    TOutputOut,
    TRequirements
  >

  /**
   * Add an output parser to the procedure
   */
  output<TNewOutputIn, TNewOutputOut>(
    schema: Parser & { _input: TNewOutputIn; _output: TNewOutputOut }
  ): EffectProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TNewOutputIn,
    TNewOutputOut,
    TRequirements
  >

  /**
   * Define a query procedure with an Effect generator resolver.
   * The resolver receives { ctx, input, signal } and should be a generator function.
   * The procedure path is automatically used as the span name for telemetry via Effect.fn.
   * The Effect requirements must be satisfied by the ManagedRuntime.
   *
   * @example
   * ```ts
   * t.effect
   *   .input(z.object({ id: z.string() }))
   *   .query(function*({ input }) {
   *     const userService = yield* UserService
   *     return yield* userService.findById(input.id)
   *   })
   * ```
   */
  query<Eff extends YieldWrap<Effect.Effect<any, any, TRequirements>>, TOutput>(
    resolver: (
      opts: EffectProcedureResolverOptions<
        TContext & TContextOverrides,
        TInputOut extends UnsetMarker ? undefined : TInputOut
      >
    ) => Generator<Eff, TOutput, never>
  ): EffectQueryProcedure<
    TInputOut extends UnsetMarker ? undefined : TInputOut,
    TOutput,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer E, infer _R>>] ? E : never,
    TContext & TContextOverrides,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer _E, infer R>>] ? R : never
  >

  /**
   * Define a mutation procedure with an Effect generator resolver.
   * The resolver receives { ctx, input, signal } and should be a generator function.
   * The procedure path is automatically used as the span name for telemetry via Effect.fn.
   * The Effect requirements must be satisfied by the ManagedRuntime.
   *
   * @example
   * ```ts
   * t.effect
   *   .input(z.object({ name: z.string() }))
   *   .mutation(function*({ input }) {
   *     const userService = yield* UserService
   *     return yield* userService.create(input)
   *   })
   * ```
   */
  mutation<Eff extends YieldWrap<Effect.Effect<any, any, TRequirements>>, TOutput>(
    resolver: (
      opts: EffectProcedureResolverOptions<
        TContext & TContextOverrides,
        TInputOut extends UnsetMarker ? undefined : TInputOut
      >
    ) => Generator<Eff, TOutput, never>
  ): EffectMutationProcedure<
    TInputOut extends UnsetMarker ? undefined : TInputOut,
    TOutput,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer E, infer _R>>] ? E : never,
    TContext & TContextOverrides,
    [Eff] extends [never] ? never : [Eff] extends [YieldWrap<Effect.Effect<infer _A, infer _E, infer R>>] ? R : never
  >
}

/**
 * Create an Effect-native procedure builder from a tRPC procedure builder.
 * @internal
 */
function makeEffectProcedure<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TRequirements
>(
  procedure: TRPCProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TInputIn,
    TInputOut,
    TOutputIn,
    TOutputOut,
    false
  >
): EffectProcedureBuilder<
  TContext,
  TMeta,
  TContextOverrides,
  TInputIn,
  TInputOut,
  TOutputIn,
  TOutputOut,
  TRequirements
> {
  return {
    _procedure: procedure,

    input(schema) {
      return makeEffectProcedure<
        TContext,
        TMeta,
        TContextOverrides,
        any,
        any,
        TOutputIn,
        TOutputOut,
        TRequirements
      >(procedure.input(schema as any)) as any
    },

    output(schema) {
      return makeEffectProcedure<
        TContext,
        TMeta,
        TContextOverrides,
        TInputIn,
        TInputOut,
        any,
        any,
        TRequirements
      >(procedure.output(schema as any)) as any
    },

    query(resolver) {
      const _captureStackTrace = addSpanStackTrace()
      return {
        [EffectProcedureSymbol]: EffectProcedureSymbol,
        _tag: "query",
        _resolver: resolver,
        _builder: procedure,
        _captureStackTrace
      } as any
    },

    mutation(resolver) {
      const _captureStackTrace = addSpanStackTrace()
      return {
        [EffectProcedureSymbol]: EffectProcedureSymbol,
        _tag: "mutation",
        _resolver: resolver,
        _builder: procedure,
        _captureStackTrace
      } as any
    }
  }
}

/**
 * Check if a value is an Effect procedure
 */
function isEffectProcedure(value: unknown): value is AnyEffectProcedure {
  return (
    typeof value === "object" &&
    value !== null &&
    EffectProcedureSymbol in value &&
    (value as any)[EffectProcedureSymbol] === EffectProcedureSymbol
  )
}

/**
 * Router record that can contain Effect procedures
 */
export type EffectRouterRecord = {
  [key: string]:
    | AnyEffectProcedure
    | TRPCRouterRecord[string]
    | EffectRouterRecord
}

export const addSpanStackTrace = () => {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 3
  const traceError = new Error()
  Error.stackTraceLimit = limit
  let cache: false | string = false
  return () => {
    if (cache !== false) {
      return cache
    }
    if (traceError.stack !== undefined) {
      const stack = traceError.stack.split("\n")
      if (stack[3] !== undefined) {
        cache = stack[3].trim()
        return cache
      }
    }
  }
}

/**
 * Wrap Effect procedures in a router record, converting them to standard tRPC procedures.
 */
function wrapProcedures<R>(
  record: EffectRouterRecord,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  parentPath: string
): TRPCRouterRecord {
  const result: TRPCRouterRecord = {}

  for (const [key, value] of Object.entries(record)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key

    if (isEffectProcedure(value)) {
      // Wrap the Effect procedure into a tRPC procedure
      // Use Effect.fn with the procedure path for native telemetry
      const { _builder, _captureStackTrace, _resolver, _tag } = value
      const tracedResolver = Effect.fnUntraced(_resolver)

      if (_tag === "query") {
        result[key] = (_builder.query as any)((opts: any) => {
          const effect = Effect.withSpan(currentPath, { captureStackTrace: _captureStackTrace })(tracedResolver({
            ctx: opts.ctx,
            input: opts.input,
            signal: opts.signal
          })) as Effect.Effect<any, any, R>
          return runtime.runPromise(effect, { signal: opts.signal })
        })
      } else {
        result[key] = (_builder.mutation as any)((opts: any) => {
          const effect = Effect.withSpan(currentPath, { captureStackTrace: _captureStackTrace })(tracedResolver({
            ctx: opts.ctx,
            input: opts.input,
            signal: opts.signal
          })) as Effect.Effect<any, any, R>
          return runtime.runPromise(effect, { signal: opts.signal })
        })
      }
    } else if (typeof value === "function" && "_def" in value) {
      // Regular tRPC procedure, pass through
      result[key] = value as AnyTRPCProcedure
    } else if (typeof value === "object" && value !== null) {
      // This is a nested router record, recurse
      result[key] = wrapProcedures(value as EffectRouterRecord, runtime, currentPath)
    } else {
      // Pass through anything else
      result[key] = value
    }
  }

  return result
}

/**
 * Decorate a procedure for the caller interface - handles both Effect and tRPC procedures
 */
type DecorateProcedure<TProcedure> =
  // Effect procedures (transformed)
  TProcedure extends { _def: { $types: { input: infer TInput; output: infer TOutput }; procedure: true } }
    ? undefined extends TInput ? () => Promise<TOutput>
    : (input: TInput) => Promise<TOutput>
    : never

/**
 * Decorate a router record for the caller interface.
 * This handles both transformed Effect procedures and regular tRPC procedures.
 */
type DecorateRouterRecord<TRecord> = {
  [TKey in keyof TRecord]: TRecord[TKey] extends { _def: { procedure: true } } ? DecorateProcedure<TRecord[TKey]>
    : TRecord[TKey] extends object ? DecorateRouterRecord<TRecord[TKey]>
    : never
}

/**
 * Lazy loader type matching tRPC's internal LazyLoader
 */
interface LazyLoader<TRouter extends AnyTRPCRouter> {
  load: () => Promise<void>
  ref: Lazy<TRouter>
}

/**
 * Router definition that matches tRPC's RouterDef structure.
 * This is needed for tRPC's client type inference to work correctly.
 *
 * @typeParam TRecord - The transformed router record containing AnyProcedure-compatible types
 */
interface EffectRouterDef<TRecord> {
  _config: {
    $types: {
      ctx: any
      meta: any
      errorShape: any
      transformer: false
    }
    transformer: any
    errorFormatter: any
    allowOutsideOfServer: boolean
    isServer: boolean
    isDev: boolean
  }
  router: true
  procedure?: never
  procedures: TRecord
  record: TRecord
  lazy: Record<string, LazyLoader<AnyTRPCRouter>>
}

/**
 * The typed router interface that our makeEffectTRPC returns.
 * This type is compatible with tRPC's AnyRouter for client type inference.
 *
 * @typeParam TRecord - The transformed router record containing AnyProcedure-compatible types
 */
export interface EffectTypedRouter<TRecord> {
  createCaller(ctx: object): DecorateRouterRecord<TRecord>
  _def: EffectRouterDef<TRecord>
}

/**
 * The result of wrapping a tRPC instance with Effect support
 *
 * @typeParam TContext - The tRPC context type
 * @typeParam TMeta - The tRPC meta type
 * @typeParam TRequirements - The Effect requirements type provided by the ManagedRuntime
 */
export interface EffectTRPC<TContext extends object, TMeta extends object, TRequirements> {
  /**
   * The original tRPC procedure builder.
   * Use this for standard tRPC procedures.
   */
  procedure: TRPCProcedureBuilder<
    TContext,
    TMeta,
    object,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    false
  >

  /**
   * Effect-native procedure builder.
   * Use this for procedures that return Effect generators.
   * The procedures can only use services from the ManagedRuntime's requirements.
   *
   * @example
   * ```ts
   * t.effect
   *   .input(z.object({ id: z.string() }))
   *   .query(function*({ input }) {
   *     const userService = yield* UserService
   *     return yield* userService.findById(input.id)
   *   })
   * ```
   */
  effect: EffectProcedureBuilder<
    TContext,
    TMeta,
    object,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    TRequirements
  >

  /**
   * Effect-aware router builder.
   * Accepts both regular tRPC procedures and Effect procedures.
   * Effect procedures are automatically traced using Effect.fn with the procedure path.
   * Effect procedures can use any services provided by the ManagedRuntime.
   *
   * @example
   * ```ts
   * const appRouter = t.router({
   *   // Regular tRPC procedure
   *   hello: t.procedure.query(() => "hello"),
   *
   *   // Effect procedure using services from the runtime
   *   getUser: t.effect
   *     .input(z.object({ id: z.string() }))
   *     .query(function*({ input }) {
   *       const userService = yield* UserService
   *       return yield* userService.findById(input.id)
   *     })
   * })
   * ```
   */
  router: <T extends EffectRouterRecord>(
    procedures: T
  ) => EffectTypedRouter<TransformEffectRouterRecord<T>> & Omit<AnyTRPCRouter, "_def">
}

/**
 * The shape of an initTRPC.create() result that we can wrap
 */
interface TRPCInstance<TContext extends object, TMeta extends object> {
  procedure: TRPCProcedureBuilder<
    TContext,
    TMeta,
    object,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    false
  >
  router: (procedures: TRPCRouterRecord) => AnyTRPCRouter
}

/**
 * Wrap a tRPC instance (from initTRPC.create()) with Effect support.
 * Requires a ManagedRuntime to provide the Effect services.
 *
 * @typeParam TContext - The tRPC context type
 * @typeParam TMeta - The tRPC meta type
 * @typeParam R - The Effect requirements provided by the ManagedRuntime
 *
 * @param trpc - The tRPC instance from initTRPC.create()
 * @param runtime - A ManagedRuntime that provides the services for Effect procedures
 *
 * @example
 * ```ts
 * import { initTRPC } from "@trpc/server"
 * import { Layer, ManagedRuntime } from "effect"
 * import { makeEffectTRPC } from "./trpcWrapper"
 *
 * // Define your services
 * class UserService extends Effect.Tag("UserService")<
 *   UserService,
 *   { findById: (id: string) => Effect.Effect<User | undefined> }
 * >() {}
 *
 * // Create a runtime with your services
 * const AppLayer = Layer.succeed(UserService, {
 *   findById: (id) => Effect.succeed({ id, name: "Alice" })
 * })
 * const runtime = ManagedRuntime.make(AppLayer)
 *
 * // Create Effect-aware tRPC instance
 * const t = makeEffectTRPC(initTRPC.create(), runtime)
 *
 * export const appRouter = t.router({
 *   // Regular tRPC procedure
 *   hello: t.procedure.query(() => "Hello, World!"),
 *
 *   // Effect procedure using services from the runtime
 *   getUser: t.effect
 *     .input(z.object({ id: z.string() }))
 *     .query(function*({ input }) {
 *       const userService = yield* UserService
 *       return yield* userService.findById(input.id)
 *     })
 * })
 * ```
 */
export function makeEffectTRPC<TContext extends object, TMeta extends object, R>(
  trpc: TRPCInstance<TContext, TMeta>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): EffectTRPC<TContext, TMeta, R> {
  return {
    procedure: trpc.procedure,
    effect: makeEffectProcedure<
      TContext,
      TMeta,
      object,
      UnsetMarker,
      UnsetMarker,
      UnsetMarker,
      UnsetMarker,
      R
    >(trpc.procedure),
    router: <T extends EffectRouterRecord>(procedures: T) => {
      const wrappedProcedures = wrapProcedures(procedures, runtime, "")
      const router = trpc.router(wrappedProcedures)
      return router as any
    }
  }
}
