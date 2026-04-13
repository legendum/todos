import ReactMarkdown from "react-markdown";

/** Read-only markdown for free-form lines in todos.md (headings, notes, etc.). */
export default function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="md-block">
      <ReactMarkdown
        components={{
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
        }}
      >
        {text || "\u00a0"}
      </ReactMarkdown>
    </div>
  );
}
