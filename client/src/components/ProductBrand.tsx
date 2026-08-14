export function ProductBrand({ compact = false, meta }: { compact?: boolean; meta?: string }) {
  return (
    <div className={`brand-lockup product-brand ${compact ? "compact" : ""}`} aria-label="泊语 HarborTalk，BIAU PORT 旗下 Chatus">
      <div className={`brand-mark ${compact ? "small" : ""}`} aria-hidden="true">泊</div>
      <div className="product-brand-copy">
        <strong>泊语 HarborTalk</strong>
        <span>{meta || "BIAU PORT · Chatus"}</span>
      </div>
    </div>
  );
}
