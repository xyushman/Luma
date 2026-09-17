# AI Integration & Decision Model

## The Role of AI in Luma
The AI assistant in Luma is designed to accelerate the exception resolution process for Reviewers. It does not auto-resolve issues; instead, it acts as a "Copilot" to analyze, explain, and suggest.

## AI Features
1. **Explain Exceptions**: Analyzes why a record failed validation and suggests corrections.
2. **Classify Severity**: Automatically categorizes the severity of an exception based on the context.
3. **Draft Reviewer Notes**: Generates a professional summary note for the reviewer's decision.
4. **Summarize Batches**: Provides a high-level summary of a complete upload batch.
5. **Suggest Rules**: Translates natural language into structured validation rules.

## Model Choice: Google Gemini
Luma uses **Google Gemini** (specifically `gemini-3.5-flash-lite`), integrated via the **Vercel AI SDK**.

**Why Gemini?**
- **Structured Output**: Excellent support for `generateObject` with Zod schemas, ensuring predictable, typed JSON responses suitable for API consumption.
- **Cost & Speed**: `flash-lite` provides a great balance of low latency and cost-effectiveness, crucial for processing potentially thousands of exceptions.
- **Flexibility**: Handles both natural language summaries and structured data extraction efficiently.

## AI Controls & Safety (Human-in-the-loop)
- **No Silent Changes**: AI output never mutates the database directly. It provides recommendations.
- **Explicit Decisions**: Reviewers must explicitly `Accept`, `Edit`, or `Reject` an AI suggestion.
- **Auditability**: Every AI recommendation, along with the model used and confidence score, is recorded in the immutable Audit Log (`AI_RECOMMENDATION` event).
- **Graceful Fallback**: If the API key is missing or the AI is unreachable, Luma falls back to a deterministic mock (`MOCK_AI=true`), ensuring the platform remains functional.
