"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface ActivityEvent {
  id: number;
  type: "tool_call" | "tool_result" | "error";
  name?: string;
  input?: { command?: string };
  output?: string;
  message?: string;
}

interface Agent {
  id: string;
  name: string;
  purpose: string;
  status: "running" | "stopped";
  created_at: string;
}

export default function AgentDashboard() {
  const params = useParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [mgmtToken, setMgmtToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [showRotateKey, setShowRotateKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<number>(0);

  useEffect(() => {
    const stored = localStorage.getItem(`mgmt_token_${agentId}`);
    if (stored) setMgmtToken(stored);
  }, [agentId]);

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/agents/${agentId}`);
      if (res.ok) setAgent(await res.json());
    } catch (_) {}
  }, [agentId]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/messages`);
      if (res.ok) setMessages(await res.json());
    } catch (_) {}
  }, [agentId]);

  useEffect(() => {
    fetchAgent();
    fetchMessages();
    const interval = setInterval(fetchAgent, 10_000);
    return () => clearInterval(interval);
  }, [fetchAgent, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function saveToken(token: string) {
    setMgmtToken(token);
    localStorage.setItem(`mgmt_token_${agentId}`, token);
    setShowTokenModal(false);
    setTokenInput("");
  }

  async function managementAction(
    path: string,
    method = "POST",
    body?: object
  ) {
    if (!mgmtToken) {
      setShowTokenModal(true);
      return;
    }
    setActionError("");
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Management-Token": mgmtToken,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchAgent();
      return data;
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setStreamingText("");

    const userMessage: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const res = await fetch(`${API}/api/agents/${agentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw);
            if (event.type === "text") {
              accumulated += event.content;
              setStreamingText(accumulated);
            } else if (
              event.type === "tool_call" ||
              event.type === "tool_result"
            ) {
              const id = ++activityRef.current;
              setActivity((prev) => [...prev.slice(-49), { id, ...event }]);
            } else if (event.type === "error") {
              const id = ++activityRef.current;
              setActivity((prev) => [
                ...prev.slice(-49),
                { id, type: "error", message: event.message },
              ]);
            } else if (event.type === "done") {
              // finished
            }
          } catch (_) {}
        }
      }

      setStreamingText("");
      await fetchMessages();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.message}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function startLogs() {
    setShowLogsDrawer(true);
    setLogs([]);
    if (!mgmtToken) {
      setShowTokenModal(true);
      return;
    }

    const res = await fetch(`${API}/api/agents/${agentId}/logs`, {
      headers: { "X-Management-Token": mgmtToken },
    });
    if (!res.ok) return;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "log") {
            setLogs((prev) => [...prev, event.content]);
          }
        } catch (_) {}
      }
    }
  }

  async function handleRotateKey() {
    if (!newApiKey.trim()) return;
    await managementAction("rotate-key", "POST", { api_key: newApiKey });
    setNewApiKey("");
    setShowRotateKey(false);
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this agent and all its data?")) return;
    await managementAction("", "DELETE");
    window.location.href = "/";
  }

  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading agent...
      </div>
    );
  }

  const isRunning = agent.status === "running";

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-card border-b border-border shrink-0">
        <a href="/" className="text-muted hover:text-gray-300 text-sm">
          ← AEP
        </a>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-white truncate">{agent.name}</span>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-xs text-muted truncate">{agent.purpose}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isRunning && (
            <ActionButton
              label="Start"
              variant="green"
              onClick={() => managementAction("start")}
            />
          )}
          {isRunning && (
            <ActionButton
              label="Stop"
              variant="red"
              onClick={() => managementAction("stop")}
            />
          )}
          <ActionButton
            label="Restart"
            variant="default"
            onClick={() => managementAction("restart")}
          />
          <button
            onClick={() => (mgmtToken ? null : setShowTokenModal(true))}
            className="text-xs text-muted hover:text-gray-300 px-2 py-1 border border-border rounded"
          >
            {mgmtToken ? "Token ✓" : "Set Token"}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="px-6 py-2 bg-red-900/20 border-b border-red-700/30 text-red-400 text-sm">
          {actionError}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !streamingText && (
              <div className="flex items-center justify-center h-full text-muted text-sm">
                {isRunning
                  ? "Send a message to start working with your agent."
                  : "Start the agent, then send a message."}
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatBubble key={i} message={msg} />
            ))}
            {streamingText && (
              <ChatBubble
                message={{ role: "assistant", content: streamingText }}
                streaming
              />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border bg-card">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={
                  isRunning ? "Message your agent..." : "Agent is stopped"
                }
                disabled={!isRunning || sending}
                rows={2}
                className="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 placeholder-zinc-600 focus:outline-none focus:border-accent resize-none disabled:opacity-40"
              />
              <button
                onClick={sendMessage}
                disabled={!isRunning || sending || !input.trim()}
                className="px-5 bg-accent hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors self-end"
              >
                {sending ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="w-80 shrink-0 border-l border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-xs text-muted uppercase tracking-wider">
            Activity
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {activity.length === 0 && (
              <div className="text-xs text-muted mt-4 text-center">
                Tool calls and results appear here.
              </div>
            )}
            {activity.map((ev) => (
              <ActivityCard key={ev.id} event={ev} />
            ))}
          </div>

          {/* Bottom actions */}
          <div className="border-t border-border p-3 space-y-2">
            <button
              onClick={startLogs}
              className="w-full text-xs text-muted hover:text-gray-300 border border-border rounded py-2 transition-colors"
            >
              View Logs
            </button>
            <button
              onClick={() => setShowRotateKey(true)}
              className="w-full text-xs text-muted hover:text-gray-300 border border-border rounded py-2 transition-colors"
            >
              Rotate API Key
            </button>
            <button
              onClick={handleDelete}
              className="w-full text-xs text-red-500 hover:text-red-400 border border-red-900/40 rounded py-2 transition-colors"
            >
              Delete Agent
            </button>
          </div>
        </div>
      </div>

      {/* Token modal */}
      {showTokenModal && (
        <Modal title="Enter Management Token" onClose={() => setShowTokenModal(false)}>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Management token"
            className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-accent"
            onKeyDown={(e) => e.key === "Enter" && saveToken(tokenInput)}
            autoFocus
          />
          <button
            onClick={() => saveToken(tokenInput)}
            className="w-full mt-3 bg-accent hover:bg-indigo-500 text-white rounded-lg py-3 font-semibold transition-colors"
          >
            Save Token
          </button>
        </Modal>
      )}

      {/* Rotate key modal */}
      {showRotateKey && (
        <Modal title="Rotate API Key" onClose={() => setShowRotateKey(false)}>
          <input
            type="password"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="New Claude API key"
            className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleRotateKey}
            className="w-full mt-3 bg-accent hover:bg-indigo-500 text-white rounded-lg py-3 font-semibold transition-colors"
          >
            Rotate Key
          </button>
        </Modal>
      )}

      {/* Logs drawer */}
      {showLogsDrawer && (
        <div className="fixed bottom-0 left-0 right-0 h-64 bg-card border-t border-border flex flex-col z-20">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-xs text-muted uppercase tracking-wider">
              Container Logs
            </span>
            <button
              onClick={() => setShowLogsDrawer(false)}
              className="text-muted hover:text-gray-300 text-sm"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-gray-400">
            {logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isRunning = status === "running";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
        isRunning
          ? "bg-green-900/30 text-green-400 border border-green-800/40"
          : "bg-zinc-800 text-zinc-400 border border-zinc-700/40"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isRunning ? "bg-green-400" : "bg-zinc-500"
        }`}
      />
      {status}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: "green" | "red" | "default";
}) {
  const colors = {
    green: "bg-green-900/30 hover:bg-green-800/40 text-green-400 border-green-800/40",
    red: "bg-red-900/30 hover:bg-red-800/40 text-red-400 border-red-800/40",
    default: "bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-300 border-zinc-700/40",
  };
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 border rounded transition-colors ${colors[variant]}`}
    >
      {label}
    </button>
  );
}

function ChatBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
          isUser
            ? "bg-accent/20 border border-accent/30 text-gray-200"
            : "bg-card border border-border text-gray-300"
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {streaming && (
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

function ActivityCard({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);

  if (event.type === "tool_call") {
    return (
      <div className="bg-surface border border-border rounded-lg p-2 text-xs">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-yellow-400">⚡</span>
          <span className="text-yellow-300 font-medium">bash</span>
          <span className="text-muted ml-auto">{expanded ? "▲" : "▼"}</span>
        </div>
        {expanded && event.input?.command && (
          <pre className="mt-2 text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all border-t border-border pt-2">
            {event.input.command}
          </pre>
        )}
        {!expanded && event.input?.command && (
          <div className="text-zinc-500 truncate mt-1">
            {event.input.command}
          </div>
        )}
      </div>
    );
  }

  if (event.type === "tool_result") {
    return (
      <div className="bg-surface border border-border rounded-lg p-2 text-xs">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-green-400">✓</span>
          <span className="text-green-300 font-medium">output</span>
          <span className="text-muted ml-auto">{expanded ? "▲" : "▼"}</span>
        </div>
        {expanded && event.output && (
          <pre className="mt-2 text-zinc-400 overflow-x-auto whitespace-pre-wrap break-all border-t border-border pt-2 max-h-40">
            {event.output}
          </pre>
        )}
        {!expanded && event.output && (
          <div className="text-zinc-500 truncate mt-1">{event.output}</div>
        )}
      </div>
    );
  }

  if (event.type === "error") {
    return (
      <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-2 text-xs">
        <span className="text-red-400">✗ {event.message}</span>
      </div>
    );
  }

  return null;
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-30 p-4">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white">{title}</span>
          <button
            onClick={onClose}
            className="text-muted hover:text-gray-300 text-lg leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
