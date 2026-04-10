import { useEffect } from "react";

type Props = {
  onClose: () => void;
};

export default function InstallDialog({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2 style={{ margin: 0, fontSize: 18 }}>Install the todos CLI</h2>
          <button className="dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="dialog-body">
          <section className="dialog-section">
            <h3>1. Install</h3>
            <pre className="dialog-code">
              curl -fsSL https://todos.in/install.sh | sh
            </pre>
          </section>

          <section className="dialog-section">
            <h3>2. Add your webhook to a project</h3>
            <p>
              Each category has a webhook URL (tap the URL under the category
              name to copy it). Add it to your project's <code>.env</code>:
            </p>
            <pre className="dialog-code">
              TODOS_WEBHOOK=https://todos.in/w/01ABC123DEF456GHI789
            </pre>
          </section>

          <section className="dialog-section">
            <h3>3. Use it</h3>
            <pre className="dialog-code">
{`todos              # list todos
todos Buy milk     # add a todo
todos done 1       # mark #1 as done
todos undo 1       # mark #1 as not done
todos del 1        # delete #1
todos first 3      # move #3 to the top
todos last 2       # move #2 to the bottom
todos open         # open in the browser`}
            </pre>
          </section>

          <section className="dialog-section">
            <h3>4. Teach your AI agent</h3>
            <p>
              Install the skill file so Claude Code and Cursor know how to use
              your todos:
            </p>
            <pre className="dialog-code">todos skill</pre>
          </section>
        </div>
      </div>
    </div>
  );
}
