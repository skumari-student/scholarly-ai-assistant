export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().match(/\S+/g)?.length ?? 0;
}
