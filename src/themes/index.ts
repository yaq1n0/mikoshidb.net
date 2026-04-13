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

const DEFAULT_THEME_ID = "arasaka";

const LOCAL_STORAGE_THEME_KEY = "mikoshi.theme";

export function applyTheme(id: string): void {
  // Validate theme ID before applying, ignore if it's not valid
  if (!themes.some((t) => t.id === id)) return;

  // Try to apply the theme by setting data attribute on documentElement, and save to localStorage
  try {
    document.documentElement.dataset.theme = id;
    localStorage.setItem(LOCAL_STORAGE_THEME_KEY, id);
  } catch {
    /* ignore failures */
  }
}

export function loadSavedTheme(): string {
  // Try to load saved theme from localStorage
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_THEME_KEY);
    if (saved && themes.some((t) => t.id === saved)) {
      document.documentElement.dataset.theme = saved;
      return saved;
    }
  } catch {
    /* ignore failures */
  }

  // Fallback to default theme if no valid saved theme is found
  document.documentElement.dataset.theme = DEFAULT_THEME_ID;
  return DEFAULT_THEME_ID;
}
