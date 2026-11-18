import { promises as fs } from "node:fs";
import path from "node:path";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

const dataDirectory = path.resolve(process.cwd(), "data");
const usersFile = path.join(dataDirectory, "users.json");

async function readUsers(): Promise<User[]> {
  await fs.mkdir(dataDirectory, { recursive: true });

  try {
    const content = await fs.readFile(usersFile, "utf8");
    return JSON.parse(content) as User[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(usersFile, "[]", "utf8");
      return [];
    }
    throw error;
  }
}

async function writeUsers(users: User[]): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2), "utf8");
}

export async function findUserByEmail(
  email: string,
): Promise<User | undefined> {
  const users = await readUsers();
  return users.find((user) => user.email === email);
}

export async function findUserById(id: string): Promise<User | undefined> {
  const users = await readUsers();
  return users.find((user) => user.id === id);
}

export async function createUser(user: User): Promise<User> {
  const users = await readUsers();

  if (users.some((existingUser) => existingUser.email === user.email)) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  users.push(user);
  await writeUsers(users);
  return user;
}
