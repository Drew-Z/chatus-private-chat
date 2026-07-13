/** Lightweight Markdown renderer for chat messages (no external deps). */
export function renderMarkdown(source) {
  const text = String(source || "");
  if (!text.trim()) return document.createDocumentFragment();

  const root = document.createElement("div");
  root.className = "md-body";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let listType = null;
  let listEl = null;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    p.append(renderInline(para.join("\n")));
    root.append(p);
    para = [];
  };

  const flushList = () => {
    if (listEl) {
      root.append(listEl);
      listEl = null;
      listType = null;
    }
  };

  const flushCode = () => {
    const pre = document.createElement("pre");
    pre.className = "md-code";
    const head = document.createElement("div");
    head.className = "md-code-head";
    const lang = document.createElement("span");
    lang.textContent = codeLang || "code";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "md-copy";
    copy.textContent = "复制";
    const codeText = codeLines.join("\n");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        copy.textContent = "已复制";
        setTimeout(() => {
          copy.textContent = "复制";
        }, 1200);
      } catch {
        copy.textContent = "失败";
      }
    });
    head.append(lang, copy);
    const code = document.createElement("code");
    code.textContent = codeText;
    pre.append(head, code);
    root.append(pre);
    inCode = false;
    codeLang = "";
    codeLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushPara();
      flushList();
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        flushCode();
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      i += 1;
      continue;
    }

    const table = parseMarkdownTable(lines, i);
    if (table) {
      flushPara();
      flushList();
      const wrap = document.createElement("div");
      wrap.className = "md-table-wrap";
      const tableEl = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      table.headers.forEach((value, index) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.style.textAlign = table.alignments[index];
        cell.append(renderInline(value));
        headRow.append(cell);
      });
      thead.append(headRow);
      const tbody = document.createElement("tbody");
      for (const row of table.rows) {
        const rowEl = document.createElement("tr");
        row.forEach((value, index) => {
          const cell = document.createElement("td");
          cell.style.textAlign = table.alignments[index];
          cell.append(renderInline(value));
          rowEl.append(cell);
        });
        tbody.append(rowEl);
      }
      tableEl.append(thead, tbody);
      wrap.append(tableEl);
      root.append(wrap);
      i = table.nextIndex;
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.+)$/);
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (listType !== type) {
        flushList();
        listType = type;
        listEl = document.createElement(type);
      }
      const li = document.createElement("li");
      li.append(renderInline((ul || ol)[1]));
      listEl.append(li);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushPara();
      flushList();
      const h = document.createElement(`h${heading[1].length + 2}`);
      h.append(renderInline(heading[2]));
      root.append(h);
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      flushPara();
      flushList();
      const bq = document.createElement("blockquote");
      bq.append(renderInline(line.slice(2)));
      root.append(bq);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      root.append(document.createElement("hr"));
      i += 1;
      continue;
    }

    flushList();
    para.push(line);
    i += 1;
  }

  if (inCode) flushCode();
  flushPara();
  flushList();
  return root;
}

export function parseMarkdownTable(lines, startIndex = 0) {
  if (!Array.isArray(lines) || startIndex < 0 || startIndex + 1 >= lines.length) return null;
  const headers = splitTableRow(lines[startIndex]);
  const separators = splitTableRow(lines[startIndex + 1]);
  if (headers.length < 2 || separators.length !== headers.length) return null;
  if (!separators.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))) return null;

  const alignments = separators.map((cell) => {
    const value = cell.replace(/\s/g, "");
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    return value.endsWith(":") ? "right" : "left";
  });
  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim() && hasUnescapedPipe(lines[nextIndex])) {
    const cells = splitTableRow(lines[nextIndex]);
    if (cells.length > headers.length) cells.length = headers.length;
    while (cells.length < headers.length) cells.push("");
    rows.push(cells);
    nextIndex += 1;
  }
  return { headers, alignments, rows, nextIndex };
}

function hasUnescapedPipe(value) {
  return /(^|[^\\])\|/.test(String(value || ""));
}

function splitTableRow(value) {
  const source = String(value || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function renderInline(source) {
  const frag = document.createDocumentFragment();
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))|(!\[[^\]]*\]\([^)]+\))/g;
  let last = 0;
  let match;
  const text = String(source || "");

  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      frag.append(document.createTextNode(text.slice(last, match.index)));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.className = "md-inline-code";
      code.textContent = token.slice(1, -1);
      frag.append(code);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      frag.append(strong);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      frag.append(em);
    } else if (token.startsWith("![")) {
      const m = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (m) {
        const safeUrl = sanitizeMarkdownUrl(m[2], "image");
        if (safeUrl) {
          const img = document.createElement("img");
          img.alt = m[1];
          img.src = safeUrl;
          frag.append(img);
        } else {
          frag.append(document.createTextNode(m[1] || "[图片链接已拦截]"));
        }
      }
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        const safeUrl = sanitizeMarkdownUrl(m[2], "link");
        if (safeUrl) {
          const a = document.createElement("a");
          a.href = safeUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = m[1];
          frag.append(a);
        } else {
          frag.append(document.createTextNode(m[1]));
        }
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    frag.append(document.createTextNode(text.slice(last)));
  }
  return frag;
}

export function sanitizeMarkdownUrl(value, kind = "link") {
  const url = String(value || "").trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (kind === "image" && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(url)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
    if (kind === "link" && parsed.protocol === "mailto:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

export function plainTextFromMarkdown(source) {
  return String(source || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/, "").replace(/```$/, ""))
    .replace(/[`*_#>\[\]]/g, "")
    .trim();
}
