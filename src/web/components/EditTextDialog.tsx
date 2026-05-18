import { Dialog } from "pues/base/objects";
import { useEffect, useRef } from "react";

export default function EditTextDialog({
  title,
  text,
  placeholder,
  onChange,
  onSave,
  onClose,
}: {
  title: string;
  text: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Dialog title={title} onClose={onClose}>
      <input
        ref={inputRef}
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
        }}
        style={{ width: "100%" }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          justifyContent: "flex-end",
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onSave}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
