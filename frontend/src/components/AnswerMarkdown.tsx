import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/types";

export default function AnswerMarkdown({ content, sources = [], onSource }: {
  content: string; sources?: Source[]; onSource: (source: Source) => void;
}) {
  const cited = content.replace(/\[(\d+)\](?!\()/g, (match, id: string) =>
    sources.some(source => source.id === id) ? "[" + id + "](#source-" + id + ")" : match);
  return <div className="answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => {
      const source = href?.startsWith("#source-") ? sources.find(item => item.id === href.slice(8)) : undefined;
      if (source) return <button className="inline-citation" onClick={() => onSource(source)} aria-label={"Open source " + source.id}>{children}</button>;
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  }}>{cited}</ReactMarkdown></div>;
}
