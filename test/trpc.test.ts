import { createTRPCClient, createWSClient, httpBatchLink, wsLink } from "@trpc/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { AppRouter } from "../src/server.js"
import { startServer } from "../src/server.js"

const TEST_PORT = 3002

let server: ReturnType<typeof startServer>

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `http://localhost:${TEST_PORT}`
    })
  ]
})

// WebSocket client for subscriptions (same port)
const wsClient = createWSClient({
  url: `ws://localhost:${TEST_PORT}`,
  WebSocket: globalThis.WebSocket
})

const trpcWs = createTRPCClient<AppRouter>({
  links: [
    wsLink({
      client: wsClient
    })
  ]
})

beforeAll(() => {
  server = startServer(TEST_PORT)
})

afterAll(() => {
  wsClient.close()
  server.close()
})

describe("tRPC", () => {
  describe("queries", () => {
    it("userCreate creates a user", async () => {
      const user = await trpc.userCreate.mutate({ name: "Alice" })
      expect(user).toEqual({ id: "1", name: "Alice" })
    })

    it("userCreate creates another user", async () => {
      const user = await trpc.userCreate.mutate({ name: "Bob" })
      expect(user).toEqual({ id: "2", name: "Bob" })
    })

    it("userList returns all users", async () => {
      const users = await trpc.userList.query()
      expect(users).toEqual([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" }
      ])
    })

    it("userById returns user by ID", async () => {
      const user = await trpc.userById.query("1")
      expect(user).toEqual({ id: "1", name: "Alice" })
    })

    it("userById returns undefined for non-existent user", async () => {
      const user = await trpc.userById.query("999")
      expect(user).toBeUndefined()
    })
  })

  describe("subscriptions", () => {
    it("onUserCreate subscription receives new users", async () => {
      const receivedUsers: Array<{ id: string; name: string }> = []
      let resolve: () => void
      const gotTwoUsers = new Promise<void>((r) => {
        resolve = r
      })

      // Start subscription via WebSocket
      const subscription = trpcWs.onUserCreate.subscribe(undefined, {
        onData: (user) => {
          receivedUsers.push(user)
          if (receivedUsers.length === 2) {
            resolve()
          }
        }
      })

      // Wait a bit for subscription to be established
      await new Promise((r) => setTimeout(r, 100))

      // Create users while subscribed (via HTTP)
      await trpc.userCreate.mutate({ name: "Charlie" })
      await trpc.userCreate.mutate({ name: "Diana" })

      // Wait for both events to be received
      await Promise.race([
        gotTwoUsers,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for subscription events")), 5000))
      ])

      // Unsubscribe
      subscription.unsubscribe()

      expect(receivedUsers).toEqual([
        { id: "3", name: "Charlie" },
        { id: "4", name: "Diana" }
      ])
    })
  })
})
