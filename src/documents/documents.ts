import { randomUUID } from "node:crypto";
import path from "node:path";
import jwt from "jsonwebtoken";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import express, { type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { verifyToken } from "../auth/auth.js";

const BUCKET_NAME = "documents";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

const allowedTypes: Record<string, { contentType: string }> = {
  ".pdf": { contentType: "application/pdf" },
  ".txt": { contentType: "text/plain" },
  ".docx": {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const documentIdSchema = z.uuid();

let supabase: SupabaseClient | undefined;

function getDocumentsBucket() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !serviceKey) {
      throw new Error("Supabase storage is not configured");
    }

    supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return supabase.storage.from(BUCKET_NAME);
}

const authenticate: RequestHandler = async (req, res, next) => {
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

    res.locals.userId = user.id;
    next();
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.NotBeforeError
    ) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    console.error("Document request authentication failed:", error);
    res.status(500).json({ error: "Unable to authenticate request" });
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const parseUpload: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: error.message });
      return;
    }

    if (error) {
      console.error("Document upload parsing failed:", error);
      res.status(400).json({ error: "Unable to process uploaded file" });
      return;
    }

    next();
  });
};

function sendStorageError(
  res: express.Response,
  operation: string,
  error: unknown,
) {
  console.error(`Document ${operation} failed:`, error);
  res.status(500).json({ error: `Unable to ${operation} document` });
}

async function findDocumentPath(userId: string, id: string) {
  const { data, error } = await getDocumentsBucket().list(userId, {
    limit: 1000,
    search: `${id}_`,
  });

  if (error) {
    throw error;
  }

  const file = data.find((item) => item.name.startsWith(`${id}_`));
  return file ? `${userId}/${file.name}` : undefined;
}

const router = express.Router();

router.use(authenticate);

router.post("/", parseUpload, async (req, res) => {
  const file = req.file;
  console.log("file", file);

  if (!file) {
    res.status(400).json({ error: 'A file is required in the "file" field' });
    return;
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const documentType = allowedTypes[extension];

  if (
    !documentType ||
    (file.mimetype !== documentType.contentType &&
      file.mimetype !== "application/octet-stream")
  ) {
    res.status(415).json({ error: "Only PDF, TXT, and DOCX files are supported" });
    return;
  }

  const id = randomUUID();
  const safeName =
    path
      .basename(file.originalname.replace(/\\/g, "/"))
      .replace(/[^\w.-]/g, "_")
      .slice(0, 120) || `document${extension}`;
  const objectName = `${id}_${safeName}`;
  const objectPath = `${res.locals.userId}/${objectName}`;

  try {
    const { error } = await getDocumentsBucket().upload(objectPath, file.buffer, {
      contentType: documentType.contentType,
      upsert: false,
    });

    if (error) {
      sendStorageError(res, "upload", error);
      return;
    }

    res.status(201).json({
      document: {
        id,
        name: safeName,
        contentType: documentType.contentType,
        size: file.size,
      },
    });
  } catch (error) {
    sendStorageError(res, "upload", error);
  }
});

router.get("/", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid pagination parameters",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const { limit, offset } = parsed.data;
    const { data, error } = await getDocumentsBucket().list(
      res.locals.userId,
      {
        limit,
        offset,
        sortBy: { column: "created_at", order: "desc" },
      },
    );

    if (error) {
      sendStorageError(res, "list", error);
      return;
    }

    const documents = data
      .filter((item) => item.id)
      .map((item) => {
        const separator = item.name.indexOf("_");
        return {
          id: separator < 0 ? item.name : item.name.slice(0, separator),
          name: separator < 0 ? item.name : item.name.slice(separator + 1),
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          metadata: item.metadata,
        };
      });

    res.json({
      documents,
      pagination: { limit, offset, hasMore: data.length === limit },
    });
  } catch (error) {
    sendStorageError(res, "list", error);
  }
});

router.get("/:id/download", async (req, res) => {
  const parsedId = documentIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  try {
    const objectPath = await findDocumentPath(res.locals.userId, parsedId.data);

    if (!objectPath) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const { data, error } = await getDocumentsBucket().createSignedUrl(
      objectPath,
      SIGNED_URL_TTL_SECONDS,
    );

    if (error) {
      sendStorageError(res, "create download link for", error);
      return;
    }

    res.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    sendStorageError(res, "create download link for", error);
  }
});

router.delete("/:id", async (req, res) => {
  const parsedId = documentIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  try {
    const objectPath = await findDocumentPath(res.locals.userId, parsedId.data);

    if (!objectPath) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const { error } = await getDocumentsBucket().remove([objectPath]);

    if (error) {
      sendStorageError(res, "delete", error);
      return;
    }

    res.json({ message: "Document deleted" });
  } catch (error) {
    sendStorageError(res, "delete", error);
  }
});

export default router;
