import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { add, divide } from "../src/index.js"

describe("index", () => {
  it("add", async () => {
    const result = await Effect.runPromise(add(1, 2))
    expect(result).toBe(3)
  })

  it("divide", async () => {
    const result = await Effect.runPromise(divide(10, 2))
    expect(result).toBe(5)
  })

  it("divide by zero fails", async () => {
    const result = await Effect.runPromise(Effect.flip(divide(10, 0)))
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe("Division by zero")
  })
})
