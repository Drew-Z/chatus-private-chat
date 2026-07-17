export function sanitizeMarkdownUrl(value: string): string {
  const url = value.trim();
  if (!url) return "";
  if (url.startsWith("//")) return "";
  if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return url;
  if (/^data:image\/(?:png|gif|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:"
      || parsed.protocol === "https:"
      || parsed.protocol === "mailto:"
      || parsed.protocol === "tel:"
      ? url
      : "";
  } catch {
    return "";
  }
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.className = "clipboard-fallback";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
