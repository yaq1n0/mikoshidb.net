export type ThemeMeta = {
  id: string;
  displayName: string;
  description: string;
};

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

export const DEFAULT_THEME_ID = "arasaka";

export function isValidThemeId(id: string): boolean {
  return themes.some((t) => t.id === id);
}

/** Apply a theme to the document root. Caller is responsible for persistence. */
export function applyTheme(id: string): void {
  if (!isValidThemeId(id)) return;
  try {
    document.documentElement.dataset.theme = id;
  } catch {
    /* ignore failures */
  }
}
