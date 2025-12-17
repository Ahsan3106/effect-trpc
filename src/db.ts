import { EventEmitter } from "events"

export type User = { id: string; name: string }

// Event emitter for subscriptions
export const ee = new EventEmitter()

// Imaginary database
const users: Array<User> = []

export const db = {
  user: {
    findMany: async () => users,
    findById: async (id: string) => users.find((user) => user.id === id),
    create: async (data: { name: string }) => {
      const user = { id: String(users.length + 1), ...data }
      users.push(user)
      // Emit event when user is created
      ee.emit("userCreated", user)
      return user
    }
  }
}
