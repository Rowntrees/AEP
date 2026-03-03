import express from "express";
import { initDb } from "./db";
import { agentsRouter } from "./routes/agents";
import { chatRouter } from "./routes/chat";
import { logsRouter } from "./routes/logs";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

app.use(express.json());

// CORS for frontend
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Management-Token"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use("/api/agents", agentsRouter);
app.use("/api/agents", chatRouter);
app.use("/api/agents", logsRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`AEP API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
