import ReactMarkdown, { type Components } from "react-markdown";

// Markdown from content/instructions. Raw HTML is dropped (skipHtml), so the
// files can carry <!-- comments --> for editors without them reaching the page.
const components: Components = {
  h2: (p) => <h3 className="mt-4 mb-2 text-sm font-semibold first:mt-0" {...p} />,
  h3: (p) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0" {...p} />,
  p: (p) => <p className="my-2 text-sm leading-relaxed text-muted-foreground" {...p} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground" {...p} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground" {...p} />,
  strong: (p) => <strong className="font-medium text-foreground" {...p} />,
  code: (p) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground" {...p} />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 break-all">
      {children}
    </a>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown skipHtml components={components}>
      {children}
    </ReactMarkdown>
  );
}
