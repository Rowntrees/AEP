import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import express, { Request, Response } from "express";

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-opus-4-6";
const MAX_ITERATIONS = 10;
const WORKSPACE = "/workspace";

const bashTool: Anthropic.Tool = {
  name: "bash",
  description:
    "Execute a bash command in the agent workspace (/workspace). Use for file operations, running scripts, installing packages, etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default 30000)",
      },
    },
    required: ["command"],
  },
};

async function runBash(
  command: string,
  timeout = 30_000
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE,
      timeout,
      shell: "/bin/bash",
    });
    return { stdout, stderr, exit_code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message || "Unknown error",
      exit_code: err.code ?? 1,
    };
  }
}

function sseEvent(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// POST /run — main entry point from the API
app.post("/run", async (req: Request, res: Response) => {
  const { messages } = req.body as {
    messages: { role: string; content: string }[];
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const conversationMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const stream = await client.messages.stream({
        model: MODEL,
        max_tokens: 8096,
        tools: [bashTool],
        messages: conversationMessages,
        system: `You are a persistent AI employee working in /workspace. You have access to a bash tool to execute commands. Complete tasks thoroughly and efficiently. Today's date: ${new Date().toISOString().split("T")[0]}.`,
      });

      let currentText = "";
      const toolUses: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      let currentToolUse: {
        id: string;
        name: string;
        inputJson: string;
      } | null = null;

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            currentText = "";
          } else if (event.content_block.type === "tool_use") {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            };
          }
        } else if (event.type === "content_block_delta") {
          if (
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            currentText += event.delta.text;
            sseEvent(res, { type: "text", content: event.delta.text });
          } else if (
            event.delta.type === "input_json_delta" &&
            currentToolUse
          ) {
            currentToolUse.inputJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolUse) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(currentToolUse.inputJson);
            } catch (_) {}
            sseEvent(res, {
              type: "tool_call",
              name: currentToolUse.name,
              input,
            });
            toolUses.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input,
            });
            currentToolUse = null;
          }
        } else if (event.type === "message_stop") {
          // handled below
        }
      }

      const finalMessage = await stream.finalMessage();

      // Add assistant message to conversation
      conversationMessages.push({
        role: "assistant",
        content: finalMessage.content,
      });

      // If no tool uses, we're done
      if (
        finalMessage.stop_reason === "end_turn" ||
        toolUses.length === 0
      ) {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.name === "bash") {
          const command = toolUse.input.command as string;
          const timeout = (toolUse.input.timeout as number) || 30_000;
          const result = await runBash(command, timeout);
          const output = [
            result.stdout,
            result.stderr ? `STDERR: ${result.stderr}` : "",
            result.exit_code !== 0 ? `Exit code: ${result.exit_code}` : "",
          ]
            .filter(Boolean)
            .join("\n")
            .trim();

          sseEvent(res, {
            type: "tool_result",
            name: "bash",
            output: output || "(no output)",
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: output || "(no output)",
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Unknown tool: ${toolUse.name}`,
            is_error: true,
          });
        }
      }

      // Add tool results to conversation
      conversationMessages.push({
        role: "user",
        content: toolResults,
      });
    }

    sseEvent(res, { type: "done", iterations });
  } catch (err: any) {
    sseEvent(res, { type: "error", message: err.message });
  }

  res.end();
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Agent runtime listening on port ${PORT}`);
});
