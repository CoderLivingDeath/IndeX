import { something } from "./utils";
import fs from "fs";

interface User {
  name: string;
  age: number;
}

class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUsers(): User[] {
    return this.users;
  }
}

function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

export default UserService;
