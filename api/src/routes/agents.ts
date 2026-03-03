import { Router, Request, Response } from "express";
import { pool } from "../db";
import {
  encryptApiKey,
  decryptApiKey,
  generateManagementToken,
  hashToken,
  generateAgentId,
} from "../crypto";
import {
  startAgentContainer,
  stopAgentContainer,
  restartAgentContainer,
  removeAgentContainer,
  getContainerStatus,
} from "../docker";

export const agentsRouter = Router();

// Middleware: validate management token for protected routes
async function requireToken(req: Request, res: Response, next: Function) {
  const token = req.headers["x-management-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "X-Management-Token header required" });
    return;
  }
  const agentId = req.params.id;
  const hash = hashToken(token);
  const result = await pool.query(
    "SELECT 1 FROM management_tokens WHERE agent_id = $1 AND token_hash = $2",
    [agentId, hash]
  );
  if (result.rowCount === 0) {
    res.status(403).json({ error: "Invalid management token" });
    return;
  }
  next();
}

// POST /api/agents — create agent
agentsRouter.post("/", async (req: Request, res: Response) => {
  const { name, purpose, api_key } = req.body;
  if (!name || !purpose || !api_key) {
    res.status(400).json({ error: "name, purpose, api_key are required" });
    return;
  }

  const agentId = generateAgentId();
  const encryptedBlob = encryptApiKey(api_key);
  const { plaintext: managementToken, hash: tokenHash } =
    generateManagementToken();

  await pool.query(
    "INSERT INTO agents (id, name, purpose, encrypted_key_blob) VALUES ($1, $2, $3, $4)",
    [agentId, name, purpose, encryptedBlob]
  );
  await pool.query(
    "INSERT INTO management_tokens (agent_id, token_hash) VALUES ($1, $2)",
    [agentId, tokenHash]
  );

  res.status(201).json({
    agent_id: agentId,
    management_token: managementToken,
    warning:
      "Save your management token now — it will not be shown again.",
  });
});

// GET /api/agents/:id — get agent info
agentsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query(
    "SELECT id, name, purpose, created_at, status FROM agents WHERE id = $1",
    [id]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const agent = result.rows[0];
  const liveStatus = await getContainerStatus(id);

  // Sync status if it differs
  if (agent.status !== liveStatus) {
    await pool.query("UPDATE agents SET status = $1 WHERE id = $2", [
      liveStatus,
      id,
    ]);
    agent.status = liveStatus;
  }

  res.json(agent);
});

// POST /api/agents/:id/start — start container
agentsRouter.post(
  "/:id/start",
  requireToken as any,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const agentResult = await pool.query(
      "SELECT encrypted_key_blob FROM agents WHERE id = $1",
      [id]
    );
    if (agentResult.rowCount === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const apiKey = decryptApiKey(agentResult.rows[0].encrypted_key_blob);
    await startAgentContainer(id, apiKey);
    await pool.query("UPDATE agents SET status = 'running' WHERE id = $1", [
      id,
    ]);
    res.json({ status: "running" });
  }
);

// POST /api/agents/:id/stop — stop container
agentsRouter.post(
  "/:id/stop",
  requireToken as any,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await stopAgentContainer(id);
    await pool.query("UPDATE agents SET status = 'stopped' WHERE id = $1", [id]);
    res.json({ status: "stopped" });
  }
);

// POST /api/agents/:id/restart — restart container
agentsRouter.post(
  "/:id/restart",
  requireToken as any,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const agentResult = await pool.query(
      "SELECT encrypted_key_blob, status FROM agents WHERE id = $1",
      [id]
    );
    if (agentResult.rowCount === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const { status } = agentResult.rows[0];

    if (status === "running") {
      await restartAgentContainer(id);
    } else {
      // Not running — start fresh
      const apiKey = decryptApiKey(agentResult.rows[0].encrypted_key_blob);
      await startAgentContainer(id, apiKey);
    }
    await pool.query("UPDATE agents SET status = 'running' WHERE id = $1", [id]);
    res.json({ status: "running" });
  }
);

// POST /api/agents/:id/rotate-key — replace API key
agentsRouter.post(
  "/:id/rotate-key",
  requireToken as any,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { api_key } = req.body;
    if (!api_key) {
      res.status(400).json({ error: "api_key is required" });
      return;
    }

    const encryptedBlob = encryptApiKey(api_key);
    await pool.query(
      "UPDATE agents SET encrypted_key_blob = $1 WHERE id = $2",
      [encryptedBlob, id]
    );

    // Restart container with new key if running
    const statusResult = await pool.query(
      "SELECT status FROM agents WHERE id = $1",
      [id]
    );
    if (statusResult.rows[0]?.status === "running") {
      await startAgentContainer(id, api_key);
    }

    res.json({ message: "API key rotated" });
  }
);

// DELETE /api/agents/:id — destroy agent
agentsRouter.delete(
  "/:id",
  requireToken as any,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await removeAgentContainer(id);
    await pool.query("DELETE FROM agents WHERE id = $1", [id]);
    res.json({ message: "Agent deleted" });
  }
);
