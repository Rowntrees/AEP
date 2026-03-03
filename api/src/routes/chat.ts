import { Router, Request, Response } from "express";
import { pool } from "../db";
import { postToAgent } from "../docker";

export const chatRouter = Router();

// GET /api/agents/:id/messages — conversation history
chatRouter.get("/:id/messages", async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query(
    "SELECT id, role, content, timestamp FROM messages WHERE agent_id = $1 ORDER BY timestamp ASC",
    [id]
  );
  res.json(result.rows);
});

// POST /api/agents/:id/messages — send message, SSE response
chatRouter.post("/:id/messages", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content (string) is required" });
    return;
  }

  // Check agent exists and is running
  const agentResult = await pool.query(
    "SELECT status FROM agents WHERE id = $1",
    [id]
  );
  if (agentResult.rowCount === 0) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (agentResult.rows[0].status !== "running") {
    res.status(409).json({ error: "Agent container is not running" });
    return;
  }

  // Store user message
  await pool.query(
    "INSERT INTO messages (agent_id, role, content) VALUES ($1, $2, $3)",
    [id, "user", content]
  );

  // Fetch full conversation history
  const histResult = await pool.query(
    "SELECT role, content FROM messages WHERE agent_id = $1 ORDER BY timestamp ASC",
    [id]
  );
  const messages = histResult.rows;

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let assistantText = "";
  let runId: number | null = null;

  // Create run record
  const runResult = await pool.query(
    "INSERT INTO runs (agent_id, status) VALUES ($1, 'running') RETURNING id",
    [id]
  );
  runId = runResult.rows[0].id;

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    await postToAgent(
      id,
      messages,
      (eventData: string) => {
        try {
          const event = JSON.parse(eventData);
          if (event.type === "text") {
            assistantText += event.content;
          }
          res.write(`data: ${eventData}\n\n`);
        } catch (_) {
          // non-JSON line, ignore
        }
      },
      controller.signal
    );
  } catch (err: any) {
    const errEvent = JSON.stringify({ type: "error", message: err.message });
    res.write(`data: ${errEvent}\n\n`);
  }

  // Store assistant reply
  if (assistantText) {
    await pool.query(
      "INSERT INTO messages (agent_id, role, content) VALUES ($1, $2, $3)",
      [id, "assistant", assistantText]
    );
  }

  // Close run
  if (runId !== null) {
    await pool.query(
      "UPDATE runs SET status = 'done', ended_at = NOW(), summary = $1 WHERE id = $2",
      [assistantText.slice(0, 500), runId]
    );
  }

  res.end();
});
