import { Children, isValidElement, type ReactNode, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText, sanitizeMarkdownUrl } from "../lib/markdown";

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => sanitizeMarkdownUrl(url)}
        components={{
          a: ({ href, children, ...props }) => {
            const external = Boolean(href && /^https?:\/\//i.test(href));
            return <a href={href || undefined} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} {...props}>{children}</a>;
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = reactNodeText(children).replace(/\n$/, "");
  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="code-block">
      <button className="icon-button code-copy" type="button" onClick={() => void copy()} title="复制代码" aria-label="复制代码">
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function reactNodeText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? reactNodeText(child.props.children) : "";
  }).join("");
}
