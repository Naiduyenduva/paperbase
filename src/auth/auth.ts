import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { createUser, findUserByEmail, findUserById } from "../store/users.js";

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.email("Invalid email address").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signInSchema = z.object({
  email: z.email("Invalid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return secret;
}

export function createToken(userId: string): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ sub: userId }, getJwtSecret(), {
    expiresIn,
  } as SignOptions);
}

export async function signUp(input: z.infer<typeof signUpSchema>) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await createUser({
    id: randomUUID(),
    name: input.name,
    email: input.email,
    passwordHash,
    createdAt: new Date().toISOString(),
  });

  return {
    token: createToken(user.id),
    user: publicUser(user),
  };
}

export async function signIn(input: z.infer<typeof signInSchema>) {
  const user = await findUserByEmail(input.email);

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new Error("INVALID_CREDENTIALS");
  }

  return {
    token: createToken(user.id),
    user: publicUser(user),
  };
}

export async function verifyToken(token: string) {
  const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;

  if (!payload.sub) {
    return null;
  }

  const user = await findUserById(payload.sub);
  return user ? publicUser(user) : null;
}

function publicUser(user: Awaited<ReturnType<typeof findUserById>> & object) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}
