import { AlertTriangle } from 'lucide-react'

interface AiFallbackNoticeProps {
  rateLimited?: boolean
  retryAfter?: number
}

/**
 * Sits above a chat reply the server substituted after an upstream AI failure
 * (see `ChatStreamChunk.aiFallback`).
 *
 * The server flags these chunks precisely so a consumer can tell them apart
 * from a real answer; appending the text without the flag is how a canned
 * apology ends up reading as if the assistant had analysed the vessel.
 */
export default function AiFallbackNotice({ rateLimited, retryAfter }: AiFallbackNoticeProps) {
  return (
    <div className="flex items-start gap-2 mb-2 rounded-[2px] border border-status-amber/40 bg-status-amber/10 px-2.5 py-1.5">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-status-amber" />
      <span className="text-[11.5px] leading-snug text-status-amber">
        {rateLimited
          ? `The AI service is rate limited${retryAfter ? ` — retry in about ${retryAfter}s` : ''}. This is not a model answer.`
          : 'The AI service could not be reached. This is not a model answer.'}
      </span>
    </div>
  )
}
