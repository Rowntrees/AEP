import Dockerode from "dockerode";
import * as http from "http";
import { IncomingMessage } from "http";

export const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

const AGENT_IMAGE = process.env.AGENT_IMAGE || "aep-agent-runtime:latest";
const AEP_NETWORK = process.env.AEP_NETWORK || "aep-network";
const DATA_HOST_PATH = process.env.DATA_HOST_PATH || "/opt/aep/data";

function containerName(agentId: string): string {
  return `aep-agent-${agentId}`;
}

export async function startAgentContainer(
  agentId: string,
  apiKey: string
): Promise<void> {
  const name = containerName(agentId);
  const workspacePath = `${DATA_HOST_PATH}/workspaces/${agentId}`;

  // Remove existing stopped container if present
  try {
    const existing = docker.getContainer(name);
    const info = await existing.inspect();
    if (info.State.Running) {
      await existing.stop();
    }
    await existing.remove();
  } catch (_) {
    // Container doesn't exist — that's fine
  }

  const container = await docker.createContainer({
    name,
    Image: AGENT_IMAGE,
    Env: [`ANTHROPIC_API_KEY=${apiKey}`, `AGENT_ID=${agentId}`],
    HostConfig: {
      NetworkMode: AEP_NETWORK,
      Binds: [`${workspacePath}:/workspace`],
      NanoCpus: 500_000_000, // 0.5 CPU
      Memory: 512 * 1024 * 1024, // 512MB
      CapDrop: ["ALL"],
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [AEP_NETWORK]: {},
      },
    },
  });

  await container.start();
}

export async function stopAgentContainer(agentId: string): Promise<void> {
  const name = containerName(agentId);
  try {
    const container = docker.getContainer(name);
    await container.stop({ t: 10 });
  } catch (e: any) {
    if (!e.statusCode || e.statusCode !== 304) throw e;
  }
}

export async function restartAgentContainer(agentId: string): Promise<void> {
  const name = containerName(agentId);
  const container = docker.getContainer(name);
  await container.restart({ t: 10 });
}

export async function removeAgentContainer(agentId: string): Promise<void> {
  const name = containerName(agentId);
  try {
    const container = docker.getContainer(name);
    try {
      await container.stop({ t: 5 });
    } catch (_) {}
    await container.remove({ v: true });
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
  }
}

export async function getContainerStatus(agentId: string): Promise<string> {
  const name = containerName(agentId);
  try {
    const container = docker.getContainer(name);
    const info = await container.inspect();
    return info.State.Running ? "running" : "stopped";
  } catch (_) {
    return "stopped";
  }
}

export async function streamContainerLogs(
  agentId: string,
  onChunk: (data: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const name = containerName(agentId);
  const container = docker.getContainer(name);
  const logStream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 100,
  });

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      (logStream as any).destroy?.();
      return resolve();
    }

    signal?.addEventListener("abort", () => {
      (logStream as any).destroy?.();
      resolve();
    });

    container.modem.demuxStream(
      logStream as any,
      {
        write: (chunk: Buffer) => onChunk(chunk.toString("utf8")),
      },
      {
        write: (chunk: Buffer) => onChunk(chunk.toString("utf8")),
      }
    );

    (logStream as any).on("end", resolve);
    (logStream as any).on("error", reject);
  });
}

export async function postToAgent(
  agentId: string,
  messages: { role: string; content: string }[],
  onEvent: (event: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const hostname = containerName(agentId);
  const body = JSON.stringify({ messages });

  await new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port: 8080,
        path: "/run",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res: IncomingMessage) => {
        res.setEncoding("utf8");
        let buffer = "";

        res.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              onEvent(line.slice(6));
            }
          }
        });

        res.on("end", () => {
          if (buffer.startsWith("data: ")) {
            onEvent(buffer.slice(6));
          }
          resolve();
        });

        res.on("error", reject);
      }
    );

    req.on("error", reject);

    if (signal) {
      signal.addEventListener("abort", () => {
        req.destroy();
        resolve();
      });
    }

    req.write(body);
    req.end();
  });
}
