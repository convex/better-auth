import { source } from "@/lib/source";

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const raw = await page.data.getText("processed");
  const body = collapseBlankLines(stripDropMarkers(raw));
  const description = page.data.description?.trim();

  const header = `# ${page.data.title} (${page.url})`;
  const intro = description ? `${header}\n\n${description}` : header;

  return `${intro}\n\n${body}`;
}

function stripDropMarkers(text: string): string {
  return text.replace(/​+/g, "").replace(/^[ \t]+$/gm, "");
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
