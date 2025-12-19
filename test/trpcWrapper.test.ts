import { NodeSdk } from "@effect/opentelemetry"
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { createTRPCClient, createWSClient, httpBatchLink, wsLink } from "@trpc/client"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as z from "zod"

import type { AppRouter } from "../src/server.js"
import { startServer } from "../src/server.js"
import type { AnyEffectMutationProcedure, EffectQueryProcedure } from "../src/trpcWrapper.js"
import { initEffectTRPC } from "../src/trpcWrapper.js"

// ----------------------------------------------------------------------------
// Unit Tests - Effect Procedure Types and Router
// ----------------------------------------------------------------------------

// Create a minimal runtime for tests that don't need services
const testRuntime = ManagedRuntime.make(Layer.empty)
const t = initEffectTRPC.create({ runtime: testRuntime })

describe("makeEffectTRPC", () => {
  describe("t.effect types", () => {
    it("query returns EffectQueryProcedure with correct types", () => {
      const proc = t.effect
        .input(z.object({ id: z.string() }))
        .query(function*({ input }) {
          return { id: input.id, name: "Alice" }
        })

      const _typed: EffectQueryProcedure<
        { id: string },
        { id: string; name: string },
        never,
        object,
        never
      > = proc

      expect(proc._tag).toBe("query")
    })

    it("mutation returns EffectMutationProcedure", () => {
      const proc = t.effect
        .input(z.object({ name: z.string() }))
        .mutation(function*({ input }) {
          return { created: input.name }
        })

      const _query: AnyEffectMutationProcedure = proc
      expect(proc._tag).toBe("mutation")
    })

    it("query without input has undefined input type", () => {
      const proc = t.effect.query(function*() {
        return "hello"
      })

      const _typed: EffectQueryProcedure<undefined, string, never, object, never> = proc
      expect(proc._tag).toBe("query")
    })

    it("preserves error type from yield* Effect.fail", () => {
      class MyError {
        readonly _tag = "MyError"
      }

      const proc = t.effect.query(function*() {
        yield* Effect.fail(new MyError())
        return "hello"
      })

      const _typed: EffectQueryProcedure<undefined, string, MyError, object, never> = proc
      expect(proc._tag).toBe("query")
    })
  })

  describe("t.router with t.effect", () => {
    it("executes query with simple return", async () => {
      const router = t.router({
        hello: t.effect.query(function*() {
          return "Hello, World!"
        })
      })

      const caller = router.createCaller({})
      expect(await caller.hello()).toBe("Hello, World!")
    })

    it("executes query with input", async () => {
      const router = t.router({
        greet: t.effect
          .input(z.object({ name: z.string() }))
          .query(function*({ input }) {
            return `Hello, ${input.name}!`
          })
      })

      const caller = router.createCaller({})
      expect(await caller.greet({ name: "Alice" })).toBe("Hello, Alice!")
    })

    it("executes query with yield* Effect.promise", async () => {
      const router = t.router({
        fetchData: t.effect.query(function*() {
          return yield* Effect.promise(async () => ({ data: "async" }))
        })
      })

      const caller = router.createCaller({})
      expect(await caller.fetchData()).toEqual({ data: "async" })
    })

    it("executes query with multiple yields", async () => {
      const router = t.router({
        calc: t.effect
          .input(z.object({ a: z.number(), b: z.number() }))
          .query(function*({ input }) {
            const sum = yield* Effect.succeed(input.a + input.b)
            const doubled = yield* Effect.succeed(sum * 2)
            return { result: doubled }
          })
      })

      const caller = router.createCaller({})
      expect(await caller.calc({ a: 5, b: 3 })).toEqual({ result: 16 })
    })

    it("propagates errors from yield* Effect.fail", async () => {
      const router = t.router({
        failing: t.effect.query(function*() {
          yield* Effect.fail(new Error("boom"))
          return "never"
        })
      })

      const caller = router.createCaller({})
      await expect(caller.failing()).rejects.toThrow("boom")
    })

    it("executes mutation with side effects", async () => {
      const items: Array<string> = []

      const router = t.router({
        add: t.effect
          .input(z.object({ item: z.string() }))
          .mutation(function*({ input }) {
            yield* Effect.sync(() => items.push(input.item))
            return { count: items.length }
          })
      })

      const caller = router.createCaller({})
      expect(await caller.add({ item: "test" })).toEqual({ count: 1 })
      expect(items).toEqual(["test"])
    })

    it("mixes t.procedure and t.effect in same router", async () => {
      const router = t.router({
        regular: t.procedure.query(() => "regular"),
        effect: t.effect.query(function*() {
          return "effect"
        })
      })

      const caller = router.createCaller({})
      expect(await caller.regular()).toBe("regular")
      expect(await caller.effect()).toBe("effect")
    })

    it("supports nested router records", async () => {
      const router = t.router({
        users: {
          get: t.effect.input(z.string()).query(function*({ input }) {
            return { id: input }
          }),
          create: t.effect.input(z.object({ name: z.string() })).mutation(function*({ input }) {
            return { name: input.name }
          })
        },
        health: t.procedure.query(() => "ok")
      })

      const caller = router.createCaller({})
      expect(await caller.users.get("123")).toEqual({ id: "123" })
      expect(await caller.users.create({ name: "Bob" })).toEqual({ name: "Bob" })
      expect(await caller.health()).toBe("ok")
    })

    it("supports ManagedRuntime with services", async () => {
      // Create a simple service
      class Counter extends Effect.Tag("Counter")<Counter, { value: number }>() {}

      const CounterLive = Layer.succeed(Counter, { value: 42 })
      const customRuntime = ManagedRuntime.make(CounterLive)

      const custom = initEffectTRPC.create({ runtime: customRuntime })

      const router = custom.router({
        getCounter: custom.effect.query(function*() {
          const counter = yield* Counter
          return counter.value
        })
      })

      const caller = router.createCaller({})
      expect(await caller.getCounter()).toBe(42)

      await customRuntime.dispose()
    })

    it("enforces type safety for service requirements", async () => {
      // This test verifies that using a service not provided by the runtime
      // results in a compile-time error

      class ProvidedService extends Effect.Tag("ProvidedService")<
        ProvidedService,
        { getValue: () => Effect.Effect<number> }
      >() {}

      const ServiceLive = Layer.succeed(ProvidedService, {
        getValue: () => Effect.succeed(100)
      })
      const customRuntime = ManagedRuntime.make(ServiceLive)
      const custom = initEffectTRPC.create({ runtime: customRuntime })

      // This compiles - ProvidedService is in the runtime
      const validRouter = custom.router({
        getValue: custom.effect.query(function*() {
          const svc = yield* ProvidedService
          return yield* svc.getValue()
        })
      })

      const caller = validRouter.createCaller({})
      expect(await caller.getValue()).toBe(100)

      // Type safety is enforced at compile time:
      // If you try to use a service not in the runtime, TypeScript will error.
      // For example, using a "MissingService" that isn't in ServiceLive would fail.

      await customRuntime.dispose()
    })

    it("supports service with effectful methods", async () => {
      // Define a user service interface
      interface User {
        id: string
        name: string
        email: string
      }

      class UserService extends Effect.Tag("UserService")<
        UserService,
        {
          readonly findById: (id: string) => Effect.Effect<User | undefined>
          readonly findAll: () => Effect.Effect<Array<User>>
          readonly create: (data: { name: string; email: string }) => Effect.Effect<User>
        }
      >() {}

      // In-memory implementation
      const users: Array<User> = [
        { id: "1", name: "Alice", email: "alice@example.com" },
        { id: "2", name: "Bob", email: "bob@example.com" }
      ]

      const UserServiceLive = Layer.succeed(UserService, {
        findById: (id) => Effect.succeed(users.find((u) => u.id === id)),
        findAll: () => Effect.succeed(users),
        create: (data) => {
          const newUser = { id: String(users.length + 1), ...data }
          users.push(newUser)
          return Effect.succeed(newUser)
        }
      })

      const customRuntime = ManagedRuntime.make(UserServiceLive)
      const custom = initEffectTRPC.create({ runtime: customRuntime })

      const router = custom.router({
        users: {
          byId: custom.effect
            .input(z.object({ id: z.string() }))
            .query(function*({ input }) {
              const userService = yield* UserService
              return yield* userService.findById(input.id)
            }),
          list: custom.effect.query(function*() {
            const userService = yield* UserService
            return yield* userService.findAll()
          }),
          create: custom.effect
            .input(z.object({ name: z.string(), email: z.string() }))
            .mutation(function*({ input }) {
              const userService = yield* UserService
              return yield* userService.create(input)
            })
        }
      })

      const caller = router.createCaller({})

      // Test queries
      expect(await caller.users.byId({ id: "1" })).toEqual({
        id: "1",
        name: "Alice",
        email: "alice@example.com"
      })
      expect(await caller.users.byId({ id: "999" })).toBeUndefined()

      const allUsers = await caller.users.list()
      expect(allUsers).toHaveLength(2)

      // Test mutation
      const newUser = await caller.users.create({
        name: "Charlie",
        email: "charlie@example.com"
      })
      expect(newUser).toEqual({
        id: "3",
        name: "Charlie",
        email: "charlie@example.com"
      })

      // Verify the user was added
      expect(await caller.users.list()).toHaveLength(3)

      await customRuntime.dispose()
    })
  })
})

// ----------------------------------------------------------------------------
// Tracing Tests - OpenTelemetry Integration
// ----------------------------------------------------------------------------

describe("Tracing", () => {
  it("creates span with procedure path as name", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    const router = traced.router({
      hello: traced.effect.query(function*() {
        return "Hello, World!"
      })
    })

    const caller = router.createCaller({})
    await caller.hello()

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThanOrEqual(1)
    expect(spans.map((s) => s.name)).toContain("hello")

    await tracingRuntime.dispose()
  })

  it("creates nested spans for nested router paths", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    const router = traced.router({
      users: {
        getById: traced.effect
          .input(z.object({ id: z.string() }))
          .query(function*({ input }) {
            return { id: input.id, name: "Test User" }
          }),
        posts: {
          list: traced.effect.query(function*() {
            return [{ id: "1", title: "Post 1" }]
          })
        }
      }
    })

    const caller = router.createCaller({})
    await caller.users.getById({ id: "123" })
    await caller.users.posts.list()

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    const spanNames = spans.map((s) => s.name)

    expect(spanNames).toContain("users.getById")
    expect(spanNames).toContain("users.posts.list")

    await tracingRuntime.dispose()
  })

  it("captures span inside Effect procedure via Effect.currentSpan", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    let capturedSpanName: string | null = null

    const router = traced.router({
      myProcedure: traced.effect.query(function*() {
        const span = yield* Effect.currentSpan
        capturedSpanName = span.name
        return "done"
      })
    })

    const caller = router.createCaller({})
    await caller.myProcedure()

    expect(capturedSpanName).toBe("myProcedure")

    await tracingRuntime.dispose()
  })

  it("creates child spans for nested Effect operations", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    const router = traced.router({
      withChildSpan: traced.effect.query(function*() {
        // Create a child span inside the procedure
        const result = yield* Effect.withSpan("child-operation")(
          Effect.succeed("child result")
        )
        return result
      })
    })

    const caller = router.createCaller({})
    await caller.withChildSpan()

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    const spanNames = spans.map((s) => s.name)

    expect(spanNames).toContain("withChildSpan")
    expect(spanNames).toContain("child-operation")

    // Verify parent-child relationship
    const parentSpan = spans.find((s) => s.name === "withChildSpan")
    const childSpan = spans.find((s) => s.name === "child-operation")

    expect(parentSpan).toBeDefined()
    expect(childSpan).toBeDefined()
    // Child span should reference the parent span via parentSpanContext
    const childParentContext = childSpan!.parentSpanContext
    expect(childParentContext).toBeDefined()
    expect(childParentContext?.spanId).toBe(parentSpan!.spanContext().spanId)

    await tracingRuntime.dispose()
  })

  it("traces mutations with correct span name", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    const router = traced.router({
      createItem: traced.effect
        .input(z.object({ name: z.string() }))
        .mutation(function*({ input }) {
          return { id: "1", name: input.name }
        })
    })

    const caller = router.createCaller({})
    await caller.createItem({ name: "Test Item" })

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    expect(spans.map((s) => s.name)).toContain("createItem")

    await tracingRuntime.dispose()
  })

  it("records error with stack trace when procedure fails", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    class MyCustomError extends Error {
      readonly _tag = "MyCustomError"
      constructor(message: string) {
        super(message)
        this.name = "MyCustomError"
      }
    }

    const router = traced.router({
      failingProcedure: traced.effect.query(function*() {
        yield* Effect.fail(new MyCustomError("Something went wrong"))
        return "never"
      })
    })

    const caller = router.createCaller({})

    // The procedure should throw
    await expect(caller.failingProcedure()).rejects.toThrow("Something went wrong")

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    const failingSpan = spans.find((s) => s.name === "failingProcedure")

    expect(failingSpan).toBeDefined()

    // Check span status is ERROR
    expect(failingSpan!.status.code).toBe(2) // SpanStatusCode.ERROR = 2
    expect(failingSpan!.status.message).toBe("Something went wrong")

    // Check that an exception event was recorded
    const events = failingSpan!.events
    expect(events.length).toBeGreaterThanOrEqual(1)

    const exceptionEvent = events.find((e) => e.name === "exception")
    expect(exceptionEvent).toBeDefined()

    // Check exception attributes
    const exceptionAttrs = exceptionEvent!.attributes
    expect(exceptionAttrs).toBeDefined()
    expect(exceptionAttrs!["exception.message"]).toBe("Something went wrong")

    // Check that stack trace is present and properly formatted
    const stackTrace = exceptionAttrs!["exception.stacktrace"] as string
    expect(stackTrace).toBeDefined()
    expect(stackTrace.length).toBeGreaterThan(0)

    // Stack trace should start with error name and message
    expect(stackTrace).toMatch(/^MyCustomError: Something went wrong/)

    // Stack trace should contain file path and line numbers
    expect(stackTrace).toMatch(/at .+trpcWrapper\.test\.ts:\d+:\d+/)

    // Stack trace should reference the procedure name
    expect(stackTrace).toContain("failingProcedure")

    await tracingRuntime.dispose()
  })

  it("records stack trace with cause chain for nested errors", async () => {
    const spanExporter = new InMemorySpanExporter()
    const TracingLive = NodeSdk.layer(Effect.sync(() => ({
      resource: { serviceName: "trpc-effect-test" },
      spanProcessor: [new SimpleSpanProcessor(spanExporter)]
    })))

    const tracingRuntime = ManagedRuntime.make(TracingLive)
    const traced = initEffectTRPC.create({ runtime: tracingRuntime })

    const router = traced.router({
      nestedError: traced.effect.query(function*() {
        // Create a nested error using Effect.mapError
        yield* Effect.fail(new Error("Root cause")).pipe(
          Effect.mapError((e) => new Error(`Wrapper error: ${e.message}`))
        )
        return "never"
      })
    })

    const caller = router.createCaller({})

    await expect(caller.nestedError()).rejects.toThrow("Wrapper error")

    // Allow time for span export
    await new Promise((r) => setTimeout(r, 10))

    const spans = spanExporter.getFinishedSpans()
    const errorSpan = spans.find((s) => s.name === "nestedError")

    expect(errorSpan).toBeDefined()
    expect(errorSpan!.status.code).toBe(2) // ERROR

    const exceptionEvent = errorSpan!.events.find((e) => e.name === "exception")
    expect(exceptionEvent).toBeDefined()

    const stackTrace = exceptionEvent!.attributes!["exception.stacktrace"] as string
    expect(stackTrace).toBeDefined()
    expect(stackTrace).toContain("Wrapper error")

    await tracingRuntime.dispose()
  })
})

// ----------------------------------------------------------------------------
// Integration Tests - HTTP/WebSocket Server
// ----------------------------------------------------------------------------

const TEST_PORT = 3002
let server: ReturnType<typeof startServer>

const httpClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `http://localhost:${TEST_PORT}` })]
})

const wsClient = createWSClient({
  url: `ws://localhost:${TEST_PORT}`,
  WebSocket: globalThis.WebSocket
})

const wsClientTrpc = createTRPCClient<AppRouter>({
  links: [wsLink({ client: wsClient })]
})

beforeAll(() => {
  server = startServer(TEST_PORT)
})

afterAll(() => {
  wsClient.close()
  server.close()
})

describe("HTTP/WebSocket Server", () => {
  describe("queries and mutations", () => {
    it("creates users via mutation", async () => {
      expect(await httpClient.userCreate.mutate({ name: "Alice" })).toEqual({ id: "1", name: "Alice" })
      expect(await httpClient.userCreate.mutate({ name: "Bob" })).toEqual({ id: "2", name: "Bob" })
    })

    it("lists all users", async () => {
      const users = await httpClient.userList.query()
      expect(users).toEqual([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" }
      ])
    })

    it("gets user by ID (Effect procedure)", async () => {
      expect(await httpClient.userById.query("1")).toEqual({ id: "1", name: "Alice" })
      expect(await httpClient.userById.query("999")).toBeUndefined()
    })
  })

  describe("subscriptions", () => {
    it("receives real-time user creation events", async () => {
      const received: Array<{ id: string; name: string }> = []
      let resolve: () => void
      const done = new Promise<void>((r) => (resolve = r))

      const sub = wsClientTrpc.onUserCreate.subscribe(undefined, {
        onData: (user: { id: string; name: string }) => {
          received.push(user)
          if (received.length === 2) resolve()
        }
      })

      await new Promise((r) => setTimeout(r, 100))

      await httpClient.userCreate.mutate({ name: "Charlie" })
      await httpClient.userCreate.mutate({ name: "Diana" })

      await Promise.race([
        done,
        new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), 5000))
      ])

      sub.unsubscribe()

      expect(received).toEqual([
        { id: "3", name: "Charlie" },
        { id: "4", name: "Diana" }
      ])
    })
  })
})
