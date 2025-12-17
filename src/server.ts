import { initTRPC } from "@trpc/server"
import { createHTTPServer } from "@trpc/server/adapters/standalone"
import { applyWSSHandler } from "@trpc/server/adapters/ws"
import { Effect, Layer, ManagedRuntime } from "effect"
import { on } from "events"
import { WebSocketServer } from "ws"
import * as z from "zod"

import { db, ee, type User } from "./db.js"
import { makeEffectTRPC } from "./trpcWrapper.js"

// Create a runtime for the server (empty layer for this demo)
const serverRuntime = ManagedRuntime.make(Layer.empty)

// Create Effect-aware tRPC instance
const t = makeEffectTRPC(initTRPC.create(), serverRuntime)

export const appRouter = t.router({
  // Standard tRPC procedure
  userList: t.procedure.query(async () => {
    const users = await db.user.findMany()
    return users
  }),

  // Effect-native procedure using generator syntax
  userById: t.effect
    .input(z.string())
    .query(function*({ input }) {
      const user = yield* Effect.promise(() => db.user.findById(input))
      return user
    }),

  // Standard tRPC mutation
  userCreate: t.procedure
    .input(z.object({ name: z.string() }))
    .mutation(async (opts) => {
      const { input } = opts
      const user = await db.user.create(input)
      return user
    }),

  // Standard tRPC subscription
  onUserCreate: t.procedure.subscription(async function*(opts) {
    // Listen for new user creation events
    for await (
      const [data] of on(ee, "userCreated", {
        signal: opts.signal
      })
    ) {
      const user = data as User
      yield user
    }
  })
})

export type AppRouter = typeof appRouter

export function startServer(port: number) {
  // HTTP server for queries and mutations
  const httpServer = createHTTPServer({
    router: appRouter
  })

  // Get the underlying Node.js HTTP server
  const server = httpServer.listen(port)

  // WebSocket server attached to the same HTTP server
  const wss = new WebSocketServer({ server })
  const wssHandler = applyWSSHandler({
    wss,
    router: appRouter
  })

  return {
    close: () => {
      wssHandler.broadcastReconnectNotification()
      wss.close()
      httpServer.close()
    }
  }
}

// Run server if this file is executed directly
if (import.meta.main) {
  startServer(3000)
  console.log("Server listening on http://localhost:3000 (HTTP + WebSocket)")
}
