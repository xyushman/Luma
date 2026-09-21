/* Client-side CSV/JSON blob download for already-fetched data. */

// Cells containing commas, double quotes, or newlines must be quoted in CSV;
// otherwise the row would split into extra columns/lines in a spreadsheet.
const CSV_SPECIAL_CHARS = /[",\n\r]/;

// Escapes a single CSV cell, guarding against injection and column breakage.
function escapeCsvCell(value: string): string {
  if (value.length > 0 && CSV_SPECIAL_CHARS.test(value)) {
    // Only quote cells that actually need it
    return `"${value.replaceAll('"', '""')}"`; // Double inner quotes per CSV spec and wrap the whole cell in quotes
  }
  return value; // No special chars, safe to emit as-is
}

// Serializes a header plus rows into one CSV blob and downloads it to the client.
export function downloadAsCsv(
  filename: string,
  header: string[],
  rows: string[][]
): void {
  const body = [
    header.map(escapeCsvCell).join(","), // Escape + comma-join the header cells first
    ...rows.map((row) => row.map(escapeCsvCell).join(",")), // One escaped, comma-joined line per data row
  ].join("\n"); // Standard CSV uses \n as the line/record separator
  triggerDownload(filename, body, "text/csv"); // Shared download path with the CSV MIME type
}

// Serializes arbitrary data as pretty-printed JSON and downloads it.
export function downloadAsJson(filename: string, data: unknown): void {
  triggerDownload(filename, JSON.stringify(data, null, 2), "application/json"); // 2-space indent for readable exports
}

// Creates a temporary object URL and clicks a hidden anchor to trigger the download.
function triggerDownload(filename: string, body: string, mime: string): void {
  const blob = new Blob([body], { type: `${mime};charset=utf-8` }); // charset ensures Unicode exports render correctly
  const url = URL.createObjectURL(blob); // Object URL lets the browser treat the blob as a downloadable file
  const anchor = document.createElement("a"); // Programmatic anchor avoids needing any visible UI element
  anchor.href = url;
  anchor.download = filename; // Sets the suggested filename in the browser's save dialog
  document.body.append(anchor); // Anchor must be in the DOM for some browsers to honor click()
  anchor.click(); // Fires the download immediately
  anchor.remove(); // Clean up the temporary anchor node
  URL.revokeObjectURL(url); // Release the object URL to avoid leaking memory
}
