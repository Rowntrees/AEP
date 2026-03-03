"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function CreateAgentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    agent_id: string;
    management_token: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, purpose, api_key: apiKey }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create agent");
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-card border border-border rounded-xl p-8 space-y-6">
          <div className="text-center space-y-1">
            <div className="text-2xl font-bold text-white">Agent Created</div>
            <div className="text-sm text-muted">
              Save these credentials — the management token will not be shown again
            </div>
          </div>

          <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-4 text-yellow-400 text-sm">
            Warning: Copy your management token now. It cannot be recovered.
          </div>

          <div className="space-y-4">
            <CredentialBox
              label="Agent ID"
              value={result.agent_id}
              onCopy={() => copy(result.agent_id, "id")}
              copied={copied === "id"}
            />
            <CredentialBox
              label="Management Token"
              value={result.management_token}
              onCopy={() => copy(result.management_token, "token")}
              copied={copied === "token"}
              sensitive
            />
          </div>

          <button
            onClick={() => router.push(`/agent/${result.agent_id}`)}
            className="w-full bg-accent hover:bg-indigo-500 text-white rounded-lg py-3 font-semibold transition-colors"
          >
            Open Agent Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="text-xs text-muted uppercase tracking-widest">
            Holiday Extras
          </div>
          <h1 className="text-2xl font-bold text-white">AI Employee Platform</h1>
          <p className="text-sm text-muted">Create a new virtual employee</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Data Analyst Bot"
              required
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted uppercase tracking-wider">
              Purpose
            </label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe what this agent does and any persistent context..."
              required
              rows={4}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted uppercase tracking-wider">
              Claude API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              required
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-gray-200 placeholder-zinc-600 focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-xs text-muted">
              Encrypted with AES-256-GCM and stored securely.
            </p>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg py-3 font-semibold transition-colors"
          >
            {loading ? "Creating..." : "Create Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CredentialBox({
  label,
  value,
  onCopy,
  copied,
  sensitive,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  sensitive?: boolean;
}) {
  const [show, setShow] = useState(!sensitive);

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-4 py-3">
        <span className="flex-1 text-sm font-mono text-gray-300 break-all">
          {show ? value : "•".repeat(Math.min(value.length, 40))}
        </span>
        {sensitive && (
          <button
            onClick={() => setShow(!show)}
            className="text-xs text-muted hover:text-gray-300 shrink-0"
          >
            {show ? "Hide" : "Show"}
          </button>
        )}
        <button
          onClick={onCopy}
          className="text-xs text-accent hover:text-indigo-300 shrink-0 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
