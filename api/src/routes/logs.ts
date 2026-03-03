import { Router, Request, Response } from "express";
import { pool } from "../db";
import { hashToken } from "../crypto";
import { streamContainerLogs } from "../docker";

export const logsRouter = Router();

// GET /api/agents/:id/logs — container log streaming (SSE), requires mgmt token
logsRouter.get("/:id/logs", async (req: Request, res: Response) => {
  const token = req.headers["x-management-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "X-Management-Token header required" });
    return;
  }
  const { id } = req.params;
  const hash = hashToken(token);
  const tokenResult = await pool.query(
    "SELECT 1 FROM management_tokens WHERE agent_id = $1 AND token_hash = $2",
    [id, hash]
  );
  if (tokenResult.rowCount === 0) {
    res.status(403).json({ error: "Invalid management token" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    await streamContainerLogs(
      id,
      (chunk: string) => {
        res.write(
          `data: ${JSON.stringify({ type: "log", content: chunk })}\n\n`
        );
      },
      controller.signal
    );
  } catch (err: any) {
    res.write(
      `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
    );
  }

  res.end();
});
