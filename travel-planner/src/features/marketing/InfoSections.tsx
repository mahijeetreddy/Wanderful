export function InfoSections() {
  return (
    <section className="marketing-section relative z-30 px-4 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto grid max-w-[1240px] gap-5">
        <section id="benefits" className="marketing-panel scroll-mt-28 rounded-[32px] p-6 sm:p-9">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div><p className="section-kicker">Beyond itinerary generation</p><h3 className="mt-3 max-w-3xl text-3xl font-medium leading-[1.02] tracking-[-0.05em] text-white sm:text-6xl">Planning that survives <span className="font-serif font-normal italic text-[#72d7dc]">the real world.</span></h3></div>
            <p className="max-w-sm text-sm leading-6 text-white/48">From the first search to the last day abroad, one continuous workspace keeps context intact.</p>
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <InfoCard number="01" title="Know why it fits" text="Evidence, freshness, and ranking reasons make every recommendation easier to trust." />
            <InfoCard number="02" title="Adapt without unraveling" text="Live recovery changes flexible moments while preserving locked commitments." />
            <InfoCard number="03" title="Get better every trip" text="Travel memory carries what you loved and skipped into the journeys ahead." />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section id="journal" className="marketing-panel group scroll-mt-28 rounded-[32px] p-6 sm:p-8">
            <div className="flex items-start justify-between gap-5"><div><p className="section-kicker">Travel journal</p><h3 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-white">Keep the story beside the schedule.</h3></div><span className="font-serif text-5xl italic text-[#f0b86a]/55">J</span></div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/52">Personal notes, booking details, discoveries, and reminders stay attached to the trip where they belong.</p>
            <p className="mt-8 text-[10px] font-medium uppercase tracking-[.16em] text-[#72d7dc]">Available inside every saved trip →</p>
          </section>

          <section id="guidebook" className="marketing-panel group scroll-mt-28 rounded-[32px] p-6 sm:p-8">
            <div className="flex items-start justify-between gap-5"><div><p className="section-kicker">Personal guidebook</p><h3 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-white">Arrive already oriented.</h3></div><span className="font-serif text-5xl italic text-[#72d7dc]/55">G</span></div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/52">Customs, safety, currency, and transport guidance shaped around your exact destination, dates, and interests.</p>
            <p className="mt-8 text-[10px] font-medium uppercase tracking-[.16em] text-[#72d7dc]">Generated for your journey →</p>
          </section>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="benefit-card rounded-[24px] p-5">
      <p className="text-[10px] font-semibold tracking-[.16em] text-[#72d7dc]">{number}</p>
      <p className="mt-7 text-lg font-medium tracking-[-.02em] text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/48">{text}</p>
    </div>
  );
}
