import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Renders LLM chat output (headings, bold, lists, tables) instead of the raw
// markdown source, styled to sit inside a chat bubble without pulling in a
// typography plugin.
export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mb-2 mt-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1.5 mt-1">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          code: ({ children }) => (
            <code className="bg-black/30 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-teal-400 underline">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="border-collapse text-xs w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-navy-600 px-2 py-1 text-left bg-navy-700/60 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-navy-600 px-2 py-1 align-top">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-teal-600 pl-3 italic text-gray-400 mb-2">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-navy-600 my-2" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
