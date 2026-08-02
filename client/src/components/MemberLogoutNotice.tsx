import { RotateCw } from "lucide-react";

export function MemberLogoutNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <div className="workspace-error member-logout-error" role="alert">
      <span>{message}</span>
      <div className="error-actions">
        <button className="icon-text-button quiet-button" type="button" onClick={() => void onRetry()}>
          <RotateCw size={15} aria-hidden="true" />
          <span>重试退出</span>
        </button>
      </div>
    </div>
  );
}
