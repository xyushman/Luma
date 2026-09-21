// Imports: rule types, mutation hooking, React state, toasts, and shared UI building blocks.
import type { AiSuggestRuleResponse } from "@repo/types";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { aiApi } from "@/lib/api";

/* Spec §5.4 — Rule Builder (stretch, Module D). Plain-English rule input →
   AI-generated JSON preview matching the validation rule shape, with
   Accept & Add to Ruleset and a list of active rules. */

// Describes a rule the reviewer added from the AI draft during this session.
interface ActiveRule {
  addedAt: string;
  rule: NonNullable<AiSuggestRuleResponse["rule"]>;
}

// Clickable starter prompts so reviewers can try realistic validation rules quickly.
const EXAMPLE_PROMPTS = [
  "Flag loans where days past due exceeds 90",
  "Reject any loan missing a servicer name",
  "Flag loans whose current balance grew by more than 10% since origination",
];

// Purpose: plain-English rule builder — AI drafts a JSON validation rule that a reviewer can review and accept.
export default function RuleBuilderPage() {
  // Text the reviewer types describing the validation rule they want.
  const [prompt, setPrompt] = useState("");
  // Holds the AI-suggested rule preview once generated (visible as a card until discarded/accepted).
  const [result, setResult] = useState<AiSuggestRuleResponse | null>(null);
  // Session-only list of rules the reviewer has accepted into the ruleset.
  const [rules, setRules] = useState<ActiveRule[]>([]);

  // Mutation that calls the API to have the AI translate the prompt into a structured rule.
  const generate = useMutation({
    mutationFn: () => aiApi.suggestRule(prompt.trim()),
    onError: (error: Error) => {
      toast.error("Rule generation failed", { description: error.message });
    },
    onSuccess: (data) => {
      if (data.rule) {
        setResult(data);
      } else {
        toast.error("No rule produced", {
          description: data.error ?? data.note ?? "Try a more specific prompt.",
        });
      }
    },
  });

  // Moves the accepted AI draft into the active ruleset and clears the preview.
  const accept = () => {
    if (!result?.rule) {
      return;
    }
    setRules((previous) => [
      {
        addedAt: new Date().toISOString(),
        rule: result.rule as NonNullable<AiSuggestRuleResponse["rule"]>,
      },
      ...previous,
    ]);
    toast.success("Rule added to ruleset", {
      description: "It will apply to the next validation run.",
    });
    setResult(null);
    setPrompt("");
  };

  return (
    // Centred page column with consistent vertical rhythm.
    <div className="mx-auto max-w-[1000px] space-y-6 p-8">
      {/* Standard page header for the rule-builder workspace. */}
      <PageHeader
        description="Describe a validation rule in plain English — the AI drafts the JSON rule and you decide what ships."
        eyebrow="Reviewer"
        title="Rule Builder"
      />
      {/* Input card where the reviewer types the prompt and triggers generation. */}
      <section className="rounded-xl border border-border bg-card p-5">
        {/* Labeled textarea for the plain-English rule (two-way bound to */}
        prompt).
        <label className="block space-y-2" htmlFor="rule-prompt">
          {/* Compact uppercase label above the textarea. */}
          <span className="block font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            Rule in plain English
          </span>
          {/* Multiline textarea that updates the prompt state on each keystroke. */}
          <Textarea
            id="rule-prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="e.g. Flag loans where the current balance exceeds the original principal"
            rows={3}
            value={prompt}
          />
        </label>
        {/* Action row: example prompt chips on the left, generate button on the */}
        right.
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Renders one clickable example chip per starter prompt. */}
          {EXAMPLE_PROMPTS.map((example) => (
            // Chip that loads the example text into the prompt box.
            <button
              className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/50"
              key={example}
              onClick={() => setPrompt(example)}
              type="button"
            >
              {example}
            </button>
          ))}
          {/* Generate button disabled while a prompt is too short or a request */}
          is in flight.
          <Button
            className="ml-auto"
            disabled={prompt.trim().length < 8 || generate.isPending}
            onClick={() => generate.mutate()}
            size="sm"
          >
            {/* Swaps the label for a spinner while the AI is drafting. */}
            {generate.isPending ? (
              // Pending state fragment with a spinning loader icon.
              <>
                <i
                  aria-hidden="true"
                  className="ri-loader-4-line animate-spin"
                />
                Drafting…
              </>
            ) : (
              // Idle state fragment with a sparkle icon and the primary label.
              <>
                <i aria-hidden="true" className="ri-sparkling-2-line" />
                Generate rule
              </>
            )}
          </Button>
        </div>
      </section>
      {/* Preview card shown only while an AI-drafted rule is waiting to be */}
      accepted/discarded.
      {result ? (
        // Highlighted card that visually sets the draft apart from the rest of the page.
        <section className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04]">
          {/* Draft header row: rule name plus severity/type badges. */}
          <header className="flex flex-wrap items-center justify-between gap-2 border-primary/15 border-b px-5 py-3">
            {/* Name cell with a braces icon and the generated rule name. */}
            <span className="flex items-center gap-2 font-semibold text-[13.5px]">
              {/* Braces icon signalling the structured rule shape. */}
              <i aria-hidden="true" className="ri-braces-line text-primary" />
              {result.rule?.name ?? "Generated rule"}
            </span>
            {/* Badge group summarising severity and exception type of the draft. */}
            <div className="flex items-center gap-2">
              {/* Severity badge (defaults to medium when unset). */}
              <Badge variant="outline">
                {result.rule?.severity ?? "medium"}
              </Badge>
              {/* Exception-type badge with underscores rendered as spaces. */}
              <Badge variant="outline">
                {result.rule?.exceptionType?.replaceAll("_", " ") ?? "rule"}
              </Badge>
            </div>
          </header>
          {/* Draft body: description, pretty-printed JSON, provenance, and */}
          action buttons.
          <div className="space-y-4 p-5">
            {/* Human-readable description of what the rule flags. */}
            <p className="text-[13.5px] text-foreground/90">
              {result.rule?.description}
            </p>
            {/* Pretty-printed JSON preview of the full rule object for */}
            transparency.
            <pre className="custom-scrollbar-hide overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-[12px] leading-relaxed">
              {JSON.stringify(result.rule, null, 2)}
            </pre>
            {/* Footer row separating provenance metadata from accept/discard */}
            controls.
            <div className="flex flex-wrap items-center justify-between gap-3 border-primary/15 border-t pt-3">
              {/* AI provenance line: model name, pinned generation time, and */}
              prompt summary.
              <p className="font-mono text-[11px] text-muted-foreground">
                {result.model} ·{" "}
                {new Date(result.timestamp).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                prompt: {result.promptSummary.slice(0, 60)}
                {(result.promptSummary.length ?? 0) > 60 ? "…" : ""}
              </p>
              {/* Control buttons for discarding or accepting the draft rule. */}
              <div className="flex gap-2">
                {/* Ghost button that clears the draft without keeping it. */}
                <Button
                  onClick={() => setResult(null)}
                  size="sm"
                  variant="ghost"
                >
                  Discard
                </Button>
                {/* Primary button that runs accept() and adds the rule to the */}
                ruleset.
                <Button onClick={accept} size="sm">
                  {/* Check icon marking the accept action. */}
                  <i aria-hidden="true" className="ri-check-line" />
                  Accept & Add to Ruleset
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
      {/* Card listing the rules accepted during this session. */}
      <section className="rounded-xl border border-border bg-card">
        {/* Section header with the active ruleset heading and count. */}
        <header className="flex items-center justify-between border-border border-b px-5 py-3.5">
          <div>
            {/* Title of the accepted-rules list. */}
            <h3 className="font-semibold text-[14px] tracking-tight">
              Active ruleset
            </h3>
            {/* Subtitle noting session rules are additive to the engine's */}
            default rules.
            <p className="text-[12px] text-muted-foreground">
              {rules.length} rule{rules.length === 1 ? "" : "s"} added this
              session · engine defaults still apply
            </p>
          </div>
        </header>
        {/* Empty state shown before any rule has been accepted. */}
        {rules.length === 0 ? (
          // Centred prompt nudging the reviewer to generate a first rule.
          <div className="flex flex-col items-center gap-2 py-10">
            {/* Shield icon implying rules protect data quality. */}
            <i
              aria-hidden="true"
              className="ri-shield-keyhole-line text-2xl text-muted-foreground/40"
            />
            {/* Message that no custom rules exist yet. */}
            <p className="text-[13px] text-muted-foreground">
              No custom rules yet — generate one above.
            </p>
          </div>
        ) : (
          // Divider-styled list of accepted rules newest-first.
          <ul className="divide-y divide-border">
            {rules.map(({ addedAt, rule }) => (
              // Row per accepted rule; keyed by id + timestamp to survive duplicates.
              <li
                className="flex items-start justify-between gap-4 px-5 py-3"
                key={`${rule.id}-${addedAt}`}
              >
                {/* Left side: rule name and truncated description. */}
                <div className="min-w-0">
                  {/* Name of the accepted rule. */}
                  <p className="font-medium text-[13px]">{rule.name}</p>
                  {/* Truncated description so long rules stay tidy. */}
                  <p className="truncate text-[12px] text-muted-foreground">
                    {rule.description}
                  </p>
                </div>
                {/* Right side: badge pair for exception type and severity. */}
                <div className="flex shrink-0 items-center gap-2">
                  {/* Exception-type badge with underscores rendered as spaces. */}
                  <Badge variant="outline">
                    {rule.exceptionType.replaceAll("_", " ")}
                  </Badge>
                  {/* Severity badge for the accepted rule. */}
                  <Badge variant="outline">{rule.severity}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
