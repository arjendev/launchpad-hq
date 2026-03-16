import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const markdownStyles = `
.lp-markdown {
  font-size: var(--mantine-font-size-sm);
  line-height: 1.55;
  color: inherit;
  word-break: break-word;
}
.lp-markdown > *:first-child { margin-top: 0; }
.lp-markdown > *:last-child { margin-bottom: 0; }
.lp-markdown p { margin: 0.4em 0; }
.lp-markdown h1, .lp-markdown h2, .lp-markdown h3,
.lp-markdown h4, .lp-markdown h5, .lp-markdown h6 {
  margin: 0.6em 0 0.3em;
  font-weight: 600;
  line-height: 1.3;
}
.lp-markdown h1 { font-size: 1.3em; }
.lp-markdown h2 { font-size: 1.15em; }
.lp-markdown h3 { font-size: 1.05em; }
.lp-markdown ul, .lp-markdown ol {
  margin: 0.3em 0;
  padding-left: 1.5em;
}
.lp-markdown li { margin: 0.15em 0; }
.lp-markdown li > p { margin: 0; }
.lp-markdown code {
  font-family: var(--mantine-font-family-monospace);
  font-size: 0.88em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.25);
}
[data-mantine-color-scheme="light"] .lp-markdown code {
  background-color: rgba(0, 0, 0, 0.06);
}
.lp-markdown pre {
  margin: 0.4em 0;
  border-radius: 6px;
  overflow-x: auto;
  background-color: rgba(0, 0, 0, 0.3);
}
[data-mantine-color-scheme="light"] .lp-markdown pre {
  background-color: rgba(0, 0, 0, 0.04);
}
.lp-markdown pre code {
  display: block;
  padding: 0.6em 0.8em;
  background: none;
  font-size: 0.82em;
  line-height: 1.5;
  white-space: pre;
  overflow-x: auto;
}
.lp-markdown blockquote {
  margin: 0.4em 0;
  padding: 0.2em 0.8em;
  border-left: 3px solid var(--lp-accent, #4c9aff);
  opacity: 0.85;
}
.lp-markdown a {
  color: var(--lp-accent, #4c9aff);
  text-decoration: none;
}
.lp-markdown a:hover { text-decoration: underline; }
.lp-markdown hr {
  border: none;
  border-top: 1px solid var(--lp-border, #253044);
  margin: 0.6em 0;
}
.lp-markdown table {
  border-collapse: collapse;
  margin: 0.4em 0;
  font-size: 0.9em;
}
.lp-markdown th, .lp-markdown td {
  border: 1px solid var(--lp-border, #253044);
  padding: 0.3em 0.6em;
}
.lp-markdown th {
  font-weight: 600;
  background-color: rgba(0, 0, 0, 0.15);
}
.lp-markdown strong { font-weight: 600; }
.lp-markdown em { font-style: italic; }
`;

let styleInjected = false;
function ensureStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = markdownStyles;
  document.head.appendChild(style);
}

// Custom components to keep rendering clean and Mantine-consistent
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export const MarkdownContent = memo(function MarkdownContent({
  content,
}: {
  content: string;
}) {
  ensureStyles();

  return (
    <div className="lp-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
