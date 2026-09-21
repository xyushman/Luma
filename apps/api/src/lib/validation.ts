// Import zod, the schema-validation library used to guard API inputs.
import { z } from "zod";

// Accept either cuid2 or legacy cuid ids so both in-house and imported record ids pass validation.
export const cuidSchema = z.cuid2().or(z.cuid());

// Turn zod issues into a field -> message map so clients can annotate the exact offending inputs.
export const mapZodIssuesToFields = (
  issues: z.ZodIssue[]
): Record<string, string> =>
  // Flatten each issue's nested path into a dot-joined key pointing at its human-readable message.
  Object.fromEntries(
    issues.map((issue) => [issue.path.join("."), issue.message])
  );
