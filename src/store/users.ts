import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

function toUser(user: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function findUserByEmail(
  email: string,
): Promise<User | undefined> {
  const user = await prisma.user.findUnique({ where: { email } });
  return user ? toUser(user) : undefined;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toUser(user) : undefined;
}

export async function createUser(user: User): Promise<User> {
  try {
    const createdUser = await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: new Date(user.createdAt),
      },
    });
    return toUser(createdUser);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = error.meta?.target;
      const emailConflict = Array.isArray(target)
        ? target.includes("email")
        : target === "email" ||
          (typeof target === "string" && target.includes("email"));

      if (emailConflict) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }
    }

    throw error;
  }
}