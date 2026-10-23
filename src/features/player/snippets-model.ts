export const SNIPPET_TITLE_MAX = 80;

/** A default title: the first few words of the text. */
export function suggestTitle(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return (words || "Untitled").slice(0, SNIPPET_TITLE_MAX);
}
