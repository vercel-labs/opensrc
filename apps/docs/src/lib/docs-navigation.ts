export type NavItem = {
  name: string;
  href: string;
};

export const allDocsPages: NavItem[] = [
  { name: "Getting Started", href: "/" },
  { name: "Registries", href: "/registries" },
  { name: "Commands", href: "/commands" },
  { name: "How It Works", href: "/how-it-works" },
];
