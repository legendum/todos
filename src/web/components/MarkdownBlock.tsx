import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

const blockComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-inline-link"
    >
      {children}
    </a>
  ),
};

const todoComponents: Components = {
  ...blockComponents,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-inline-link"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  ),
  p: ({ children }) => <span className="todo-md-p">{children}</span>,
};

/** Read-only markdown for free-form lines in todos.md (headings, notes, etc.). */
export default function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="md-block">
      <ReactMarkdown components={blockComponents}>
        {text || "\u00a0"}
      </ReactMarkdown>
    </div>
  );
}

/** Inline markdown for task line text (bold, links, etc.), matching {@link MarkdownBlock}. */
export function TodoMarkdownText({ text }: { text: string }) {
  return (
    <span className="todo-markdown">
      <ReactMarkdown components={todoComponents}>
        {text || "\u00a0"}
      </ReactMarkdown>
    </span>
  );
}
