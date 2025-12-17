import { Effect } from "effect"

export const add = (a: number, b: number): Effect.Effect<number> => Effect.succeed(a + b)

export const divide = (a: number, b: number): Effect.Effect<number, Error> =>
  b === 0 ? Effect.fail(new Error("Division by zero")) : Effect.succeed(a / b)
