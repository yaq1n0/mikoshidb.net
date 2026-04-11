export interface ThemeMeta {
  id: string;
  displayName: string;
  description: string;
}

export const themes: ThemeMeta[] = [
  {
    id: "arasaka",
    displayName: "ARASAKA",
    description: "Black & red. Corporate. Imperial. The house skin.",
  },
  {
    id: "nightcity",
    displayName: "NIGHT CITY",
    description: "Yellow & cyan. Chrome-street neon, circa 2077.",
  },
  {
    id: "netrunner",
    displayName: "NETRUNNER",
    description: "Classic green phosphor. For the old-school decks.",
  },
  {
    id: "militech",
    displayName: "MILITECH",
    description: "Navy & orange. Tactical. Low signature.",
  },
];

export function applyTheme(id: string): void {
  if (!themes.some((t) => t.id === id)) return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem("mikoshi.theme", id);
  } catch {
    /* ignore */
  }
}

export function loadSavedTheme(): string {
  try {
    const saved = localStorage.getItem("mikoshi.theme");
    if (saved && themes.some((t) => t.id === saved)) {
      document.documentElement.dataset.theme = saved;
      return saved;
    }
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = "arasaka";
  return "arasaka";
}
