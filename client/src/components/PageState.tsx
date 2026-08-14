import { RefreshCw } from "lucide-react";
import { ProductBrand } from "./ProductBrand";

export function PageState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <main className="page-state" aria-live="polite">
      <ProductBrand />
      <h1>{title}</h1>
      <p>{detail}</p>
      {onRetry && (
        <button className="primary-button icon-text-button" type="button" onClick={onRetry}>
          <RefreshCw size={16} />
          <span>重新连接</span>
        </button>
      )}
    </main>
  );
}
