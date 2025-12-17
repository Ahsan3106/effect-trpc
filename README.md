# effect-trpc

A type-safe integration between [tRPC](https://trpc.io/) and [Effect](https://effect.website/), enabling Effect-native procedures with full service injection and OpenTelemetry tracing support.

## Features

- **Effect-native procedures** - Write tRPC procedures using Effect generators with `yield*` syntax
- **Type-safe service injection** - Use `ManagedRuntime<R>` to provide services to procedures with compile-time safety
- **Automatic OpenTelemetry tracing** - Every procedure is wrapped in a span using the procedure path (e.g., `users.getById`)
- **Full tRPC compatibility** - Mix Effect procedures with standard tRPC procedures in the same router
- **Nested router support** - Nested routers work seamlessly with proper span naming
- **Error handling with stack traces** - Failed effects produce spans with proper error status and stack traces

## Installation

```bash
bun add effect-trpc effect @trpc/server @trpc/client
```

## Quick Start

```typescript
import { initTRPC } from "@trpc/server"
import { Effect, Layer, ManagedRuntime } from "effect"
import { makeEffectTRPC } from "effect-trpc"
import * as z from "zod"

// Define your services
class UserService extends Effect.Tag("UserService")<
  UserService,
  {
    findById: (id: string) => Effect.Effect<User | undefined>
    findAll: () => Effect.Effect<User[]>
    create: (name: string) => Effect.Effect<User>
  }
>() {}

// Create service implementation
const UserServiceLive = Layer.succeed(UserService, {
  findById: (id) => Effect.succeed(users.find(u => u.id === id)),
  findAll: () => Effect.succeed(users),
  create: (name) => Effect.succeed({ id: String(nextId++), name })
})

// Create runtime with your services
const runtime = ManagedRuntime.make(UserServiceLive)

// Create Effect-aware tRPC instance
const t = makeEffectTRPC(initTRPC.create(), runtime)

// Define your router
export const appRouter = t.router({
  // Standard tRPC procedure
  health: t.procedure.query(() => "ok"),

  // Effect procedure with service injection
  users: {
    getById: t.effect
      .input(z.object({ id: z.string() }))
      .query(function*({ input }) {
        const userService = yield* UserService
        return yield* userService.findById(input.id)
      }),

    list: t.effect.query(function*() {
      const userService = yield* UserService
      return yield* userService.findAll()
    }),

    create: t.effect
      .input(z.object({ name: z.string() }))
      .mutation(function*({ input }) {
        const userService = yield* UserService
        return yield* userService.create(input.name)
      })
  }
})

export type AppRouter = typeof appRouter
```

## Type Safety

The wrapper enforces that Effect procedures only use services provided by the `ManagedRuntime`. If you try to use a service that isn't in the runtime, you'll get a compile-time error:

```typescript
class ProvidedService extends Effect.Tag("ProvidedService")<...>() {}
class MissingService extends Effect.Tag("MissingService")<...>() {}

const runtime = ManagedRuntime.make(Layer.succeed(ProvidedService, impl))
const t = makeEffectTRPC(initTRPC.create(), runtime)

t.router({
  // This compiles - ProvidedService is in the runtime
  works: t.effect.query(function*() {
    const svc = yield* ProvidedService
    return yield* svc.doSomething()
  }),

  // This fails to compile - MissingService is not in the runtime
  fails: t.effect.query(function*() {
    const svc = yield* MissingService // Type error!
    return yield* svc.doSomething()
  })
})
```

## OpenTelemetry Tracing

Every Effect procedure automatically creates an OpenTelemetry span with:

- **Span name** matching the procedure path (e.g., `users.getById`, `users.posts.list`)
- **Parent-child relationships** for nested `Effect.withSpan` calls
- **Error status** and exception recording for failed effects
- **Stack traces** in the standard OpenTelemetry format

To enable tracing, include the OpenTelemetry layer in your runtime:

```typescript
import { NodeSdk } from "@effect/opentelemetry"

const TracingLive = NodeSdk.layer(Effect.sync(() => ({
  resource: { serviceName: "my-service" },
  spanProcessor: [new SimpleSpanProcessor(new OTLPTraceExporter())]
})))

const AppLive = Layer.mergeAll(
  UserServiceLive,
  TracingLive
)

const runtime = ManagedRuntime.make(AppLive)
const t = makeEffectTRPC(initTRPC.create(), runtime)
```

### Error Stack Traces

When an Effect procedure fails, the span includes a properly formatted stack trace:

```
MyCustomError: Something went wrong
    at <anonymous> (/app/src/procedures.ts:42:28)
    at users.getById (/app/src/procedures.ts:41:35)
```

## API Reference

### `makeEffectTRPC(trpc, runtime)`

Creates an Effect-aware tRPC instance.

- `trpc` - The result of `initTRPC.create()`
- `runtime` - A `ManagedRuntime<R, never>` providing services for Effect procedures

Returns an object with:

- `procedure` - Standard tRPC procedure builder
- `effect` - Effect procedure builder with `.input()`, `.output()`, `.query()`, `.mutation()`
- `router` - Router builder accepting both standard and Effect procedures

### Effect Procedure Builder

```typescript
t.effect
  .input(schema)    // Add input validation (Zod, etc.)
  .output(schema)   // Add output validation
  .query(resolver)  // Define a query procedure
  .mutation(resolver) // Define a mutation procedure
```

The resolver is a generator function receiving `{ ctx, input, signal }`:

```typescript
t.effect
  .input(z.object({ id: z.string() }))
  .query(function*({ ctx, input, signal }) {
    // ctx - tRPC context
    // input - validated input
    // signal - AbortSignal for cancellation
    const service = yield* MyService
    return yield* service.doSomething(input.id)
  })
```

## License

MIT
