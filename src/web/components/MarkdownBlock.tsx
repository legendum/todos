import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

function markdownLink(stopPropagation: boolean): NonNullable<Components["a"]> {
  return ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-inline-link"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </a>
  );
}

const blockComponents: Components = {
  a: markdownLink(false),
};

const todoComponents: Components = {
  a: markdownLink(true),
  p: ({ children }) => <span>{children}</span>,
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
    <ReactMarkdown components={todoComponents}>
      {text || "\u00a0"}
    </ReactMarkdown>
  );
}
