export const PAGE_TITLES: Record<string, string> = {
  "": "Source Code for\nAI Coding Agents",
  registries: "Registries",
  commands: "Commands",
  auth: "Authentication",
  "how-it-works": "How It Works",
};

export function getPageTitle(slug: string): string | null {
  return slug in PAGE_TITLES ? PAGE_TITLES[slug]! : null;
}
