import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, RotateCw } from "lucide-react";
import type { AgentErrorPresentation } from "../lib/agent-errors";
import { copyText } from "../lib/markdown";

type AgentErrorBannerProps = {
  presentation: AgentErrorPresentation;
  retryAvailability: "hidden" | "enabled" | "disabled";
  retryBusy: boolean;
  onRetry: () => void;
  onReconnect: () => void;
};

export function AgentErrorBanner({
  presentation,
  retryAvailability,
  retryBusy,
  onRetry,
  onReconnect,
}: AgentErrorBannerProps) {
  const [copiedRequestId, setCopiedRequestId] = useState("");
  const requestId = presentation.requestId;

  useEffect(() => {
    if (!copiedRequestId) return;
    const timer = window.setTimeout(() => setCopiedRequestId(""), 1_500);
    return () => window.clearTimeout(timer);
  }, [copiedRequestId]);

  const copyRequestReference = async (requestId: string) => {
    try {
      if (await copyText(requestId)) setCopiedRequestId(requestId);
    } catch {
      // Keep the primary task error visible when clipboard access is unavailable.
    }
  };

  return (
    <div className="error-banner" role="alert">
      <div className="error-summary">
        <span>{presentation.message}</span>
        {requestId && (
          <span className="error-request-reference">
            <code title={requestId}>请求引用 {requestId}</code>
            <button
              className="icon-button"
              type="button"
              onClick={() => void copyRequestReference(requestId)}
              title={copiedRequestId === requestId ? "请求引用已复制" : "复制请求引用"}
              aria-label={copiedRequestId === requestId ? "请求引用已复制" : "复制请求引用"}
            >
              {copiedRequestId === requestId ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </span>
        )}
      </div>
      <div className="error-actions">
        {retryAvailability !== "hidden" && (
          <button
            className="quiet-button icon-text-button"
            type="button"
            onClick={onRetry}
            disabled={retryAvailability !== "enabled" || retryBusy}
            title="重试这一轮"
            aria-label="重试这一轮"
          >
            <RotateCw size={15} />
            <span>{retryBusy ? "重试中..." : "重试"}</span>
          </button>
        )}
        <button className="icon-button" type="button" onClick={onReconnect} title="重新连接" aria-label="重新连接"><RefreshCw size={16} /></button>
      </div>
    </div>
  );
}
