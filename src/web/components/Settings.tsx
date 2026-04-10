import { useState } from "react";

type Props = {
  onBack: () => void;
  email: string;
  isSelfHosted: boolean;
};

export default function Settings({ onBack, email, isSelfHosted }: Props) {
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/t/auth/logout", { method: "POST", credentials: "include" });
      window.location.reload();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>
          &#8592; Back
        </button>
        <h2 className="screen-title">Settings</h2>
      </div>
      <div className="form" style={{ padding: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
            Email
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#e2e8f0" }}>{email}</p>
          {!isSelfHosted && (
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#64748b" }}>
              Managed by Legendum
            </p>
          )}
        </div>

        {!isSelfHosted && (
          <button
            className="btn btn-secondary"
            onClick={logout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
        )}
      </div>
    </div>
  );
}
