import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import {
  signIn,
  signInSchema,
  signUp,
  signUpSchema,
  verifyToken,
} from "./auth/auth.js";
import documentsRouter from "./documents/documents.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await signUp(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_ALREADY_EXISTS") {
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Unable to create account" });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  const parsed = signInSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await signIn(parsed.data);
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Unable to sign in" });
  }
});

app.get(
  "/api/auth/me",
  async (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!token) {
      res.status(401).json({ error: "Authorization token is required" });
      return;
    }

    try {
      const user = await verifyToken(token);

      if (!user) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }

      res.json({ user });
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  },
);

app.use("/api/documents", documentsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

export default app;
