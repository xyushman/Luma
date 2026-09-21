// Page header and badge UI primitives
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
// All copy for this page lives in content/ai-log.ts (keeps the component a pure renderer)
import {
  AI_CODE_PERCENT,
  HUMAN_PERCENT,
  LESSONS,
  LIVE_NOTE,
  PROCESS_RULES,
  PROMPTS,
  REJECTED,
  REVIEW_PROCESS,
  TEST_EVIDENCE,
  TIMELINE,
  TOOLS,
  VERIFIED_NOTES,
} from "@/content/ai-log";

/* Spec §7.1 — AI Development Log (in-app deliverable for the Agentic Coding
   Demonstration judging category). Content lives in content/ai-log.ts,
   transcribed from docs/AI_DEVELOPMENT_LOG.md. */

// SectionHeading: consistent title + optional hint used by every page section
function SectionHeading({ hint, title }: { hint?: string; title: string }) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold text-[15px] tracking-tight">{title}</h3>
      {/* Hint renders only when supplied (optional prop) */}
      {hint ? (
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// Stat: one large-number card (e.g. AI-generated code percentage)
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-card p-5">
      {/* Small uppercase label above the big number */}
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </p>
      {/* Tabular numbers keep the stat digits aligned across cards */}
      <p className="mt-1.5 font-semibold text-[26px] tabular-nums leading-none tracking-tight">
        {value}
      </p>
    </div>
  );
}

// AiDevelopmentLogPage: renders the static AI development log deliverable (timeline, prompts, reviews, lessons)
export default function AiDevelopmentLogPage() {
  return (
    <div className="mx-auto max-w-[1000px] space-y-6 p-8">
      <PageHeader
        description="How Luma was built with AI — prompts, reviews, rejections, and lessons. Logged live during Phases 0–5, verified against git history."
        eyebrow="Deliverable"
        title="AI Development Log"
      />

      {/* Live-update callout banner explaining what is currently being logged */}
      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-3 text-[12.5px] text-muted-foreground">
        <i
          aria-hidden="true"
          className="ri-information-line mt-0.5 text-primary"
        />
        {LIVE_NOTE}
      </p>

      {/* Stats */}
      {/* Three headline percentages pulled from the content constants */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Stat label="AI-generated code" value={`~${AI_CODE_PERCENT}%`} />
        <Stat label="Human hardening" value={`~${HUMAN_PERCENT}%`} />
        <Stat label="Tests passing" value="150" />
      </div>

      {/* Timeline */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading
          hint="Every commit below is verifiable in git history."
          title="Development timeline"
        />
        <ol className="space-y-3">
          {/* One entry per phase/branch pairing */}
          {TIMELINE.map((row) => (
            <li className="flex flex-col gap-1.5" key={row.phase + row.branch}>
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                {/* Phase label (e.g. Phase 1) in a fixed-width gutter */}
                <span className="w-20 shrink-0 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                  {row.phase}
                </span>
                {/* Branch name rendered in monospace accent */}
                <span className="font-mono text-[12px] text-primary">
                  {row.branch}
                </span>
              </div>
              {/* Commit chips indented under each phase */}
              <div className="flex flex-wrap gap-1.5 pl-[90px]">
                {row.commits.map((commit) => (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px]"
                    key={commit.hash}
                  >
                    {/* Short hash followed by its human label */}
                    <span className="font-medium font-mono text-foreground/80">
                      {commit.hash}
                    </span>
                    <span className="text-muted-foreground">
                      {commit.label}
                    </span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Tools */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading title="Tools used" />
        <ul className="space-y-3">
          {TOOLS.map((tool) => (
            <li className="flex items-start gap-3" key={tool.name}>
              {/* Icon chip prefixing each tool row */}
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
              >
                <i className="ri-tools-line text-[13px]" />
              </span>
              <div>
                {/* Tool name + one-line detail */}
                <p className="font-medium text-[13px]">{tool.name}</p>
                <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                  {tool.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Prompt log */}
      <section className="rounded-xl border border-border bg-card">
        {/* Header split from the list body by a bottom border */}
        <header className="border-border border-b px-5 py-4">
          <SectionHeading
            hint="8 of the prompts that shaped the system — verbatim, typos included."
            title="Prompt log"
          />
        </header>
        {/* One quote block per prompt alongside its outcome */}
        <ol className="divide-y divide-border">
          {PROMPTS.map((entry) => (
            <li className="px-5 py-4" key={entry.title}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-[13px]">{entry.title}</p>
              </div>
              {/* Verbatim prompt rendered as a left-bordered blockquote */}
              <blockquote className="mt-2 border-primary/25 border-l-2 pl-3 font-mono text-[11.5px] text-muted-foreground leading-relaxed">
                “{entry.prompt}”
              </blockquote>
              {/* How the prompt was resolved, prefixed by an arrow icon */}
              <p className="mt-2 flex items-start gap-1.5 text-[12px] text-foreground/80">
                <i
                  aria-hidden="true"
                  className="ri-arrow-right-line mt-0.5 text-[11px] text-success"
                />
                {entry.outcome}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Human review */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading
          hint="How humans stayed in the loop for every AI-assisted decision."
          title="Human review process"
        />
        {/* Checklist-style list of documented review steps */}
        <ul className="space-y-2.5">
          {REVIEW_PROCESS.map((item) => (
            <li className="flex items-start gap-2.5" key={item.slice(0, 40)}>
              <i
                aria-hidden="true"
                className="ri-checkbox-circle-line mt-0.5 text-[13px] text-success"
              />
              <p className="text-[13px] text-foreground/90 leading-relaxed">
                {item}
              </p>
            </li>
          ))}
        </ul>

        {/* Claims vs live verification: definition list of claim -> recorded result */}
        <div className="mt-5 border-border border-t pt-4">
          <h4 className="mb-3 font-semibold text-[13px] tracking-tight">
            Claims vs live verification
          </h4>
          <dl className="space-y-2.5">
            {VERIFIED_NOTES.map((note) => (
              <div className="text-[12.5px]" key={note.claim}>
                <dt className="font-medium text-foreground/90">{note.claim}</dt>
                <dd className="mt-0.5 text-muted-foreground leading-relaxed">
                  {note.result}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Test evidence note rendered as a muted footnote card */}
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 px-3.5 py-3 text-[12px] text-muted-foreground leading-relaxed">
          <i aria-hidden="true" className="ri-flask-line mt-0.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground/80">
              Test evidence:{" "}
            </span>
            {TEST_EVIDENCE}
          </span>
        </p>
      </section>

      {/* Rejected */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-border border-b px-5 py-4">
          <SectionHeading
            hint="Required deliverable — what AI produced, why it was rejected, and what shipped instead."
            title="What was rejected"
          />
        </header>
        {/* Each rejection: AI said / Rejected / Shipped triple-column layout */}
        <ol className="divide-y divide-border">
          {REJECTED.map((entry, index) => (
            <li className="px-5 py-4" key={entry.title}>
              <div className="flex flex-wrap items-center gap-2">
                {/* Numbered rejection title */}
                <span className="font-semibold text-[13.5px]">
                  {index + 1}. {entry.title}
                </span>
                {/* Severity badge shows when supplied (Block = destructive tone) */}
                {entry.severity ? (
                  <Badge
                    variant={
                      entry.severity === "Block" ? "destructive" : "secondary"
                    }
                  >
                    {entry.severity}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 space-y-2.5">
                {/* "AI said" row with the AI's original claim */}
                <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider sm:w-16 sm:pt-0.5">
                    AI said
                  </span>
                  <p className="text-[12.5px] text-foreground/85 leading-relaxed">
                    {entry.what}
                  </p>
                </div>
                {/* "Rejected" row with the human rationale */}
                <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  <span className="font-medium text-[11px] text-destructive uppercase tracking-wider sm:w-16 sm:pt-0.5">
                    Rejected
                  </span>
                  <p className="text-[12.5px] text-foreground/85 leading-relaxed">
                    {entry.why}
                  </p>
                </div>
                {/* "Shipped" row with what replaced the rejected approach */}
                <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  <span className="font-medium text-[11px] text-success uppercase tracking-wider sm:w-16 sm:pt-0.5">
                    Shipped
                  </span>
                  <p className="text-[12.5px] text-foreground/85 leading-relaxed">
                    {entry.instead}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Lessons */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading title="Lessons learned" />
        {/* Two-column comparison: AI wins vs human judgment calls */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 font-medium text-[12px] text-success uppercase tracking-wider">
              <i aria-hidden="true" className="ri-thumb-up-line" />
              Where AI helped most
            </h4>
            <p className="text-[13px] text-foreground/90 leading-relaxed">
              {LESSONS.whereAiHelped}
            </p>
          </div>
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 font-medium text-[12px] text-primary uppercase tracking-wider">
              <i aria-hidden="true" className="ri-user-search-line" />
              Where human judgment was necessary
            </h4>
            <p className="text-[13px] text-foreground/90 leading-relaxed">
              {LESSONS.humanJudgment}
            </p>
          </div>
        </div>
        {/* Process rules quoted at the bottom of the section */}
        <div className="mt-5 space-y-2 border-border border-t pt-4">
          {PROCESS_RULES.map((rule) => (
            <p
              className="flex items-start gap-2 text-[12.5px] text-muted-foreground"
              key={rule.slice(0, 30)}
            >
              <i
                aria-hidden="true"
                className="ri-double-quotes-l mt-0.5 shrink-0 text-primary"
              />
              {rule}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
