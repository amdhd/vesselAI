import { Waves } from 'lucide-react'

interface AuthShellProps {
  /** Display headline, set dark on the pale sky of the photograph. */
  headline: React.ReactNode
  /** One sentence under the headline. */
  lead: string
  /** Optional supporting content under the lead (a tally, a list). */
  aside?: React.ReactNode
  /** Footer line on the photograph. */
  note?: string
  /** The form, set in smoked glass. */
  children: React.ReactNode
}

/**
 * Dusk's one photograph: an estuary at dusk behind the sign-in screens. The
 * head sits on the palest part of the sky over a fog scrim; the form sits in
 * smoked glass over the darker water.
 */
export default function AuthShell({ headline, lead, aside, note, children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-paper">
      <img
        className="dusk-photo"
        src="/photos/estuary.jpg"
        width={1920}
        height={1280}
        alt="A calm estuary at dusk, boats at their moorings under an amber sky"
      />
      <div className="dusk-scrim" aria-hidden="true" />

      <div className="relative z-10 min-h-screen max-w-[1320px] mx-auto px-6 lg:px-12 py-8 flex flex-col">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-day-ink flex items-center justify-center">
            <Waves className="w-[18px] h-[18px] text-fog" strokeWidth={1.8} />
          </div>
          <div className="leading-tight">
            <p className="font-display text-[16px] font-medium text-day-ink">VesselMind AI</p>
            <p className="text-[12.5px] text-day-muted">Maritime intelligence platform</p>
          </div>
        </div>

        <div className="flex-1 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] gap-10 lg:gap-16 items-center py-10">
          {/* The head, on the sky */}
          <div className="hidden lg:block max-w-[34rem] self-start pt-[6vh]">
            <h1 className="text-[52px] leading-[1.04] text-day-ink">{headline}</h1>
            <p className="mt-5 text-[18px] leading-[1.5] text-day-muted max-w-[30rem]">{lead}</p>
            {aside && <div className="mt-10 rounded-card bg-fog/75 backdrop-blur-md px-6 py-2 shadow-[inset_0_1px_0_oklch(var(--c-light)/0.5)]">{aside}</div>}
          </div>

          {/* The form, in glass */}
          <div className="glass w-full max-w-[440px] justify-self-center lg:justify-self-end p-8 sm:p-9">
            {children}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 text-[12.5px] text-ink-2">
          {note && <p>{note}</p>}
          <p className="text-muted">
            Photograph:{' '}
            <a
              className="underline underline-offset-2 hover:text-ink"
              href="https://commons.wikimedia.org/wiki/File:Conwy_Estuary_at_dusk_-_geograph.org.uk_-_4556293.jpg"
              target="_blank"
              rel="noreferrer"
            >
              Matt Harrop
            </a>{' '}
            (CC BY-SA 2.0), Wikimedia Commons
          </p>
        </div>
      </div>
    </div>
  )
}
