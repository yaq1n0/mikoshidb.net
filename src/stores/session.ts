import { defineStore } from "pinia";
import { ref } from "vue";
import type { Mode } from "@/terminal/session";

export const useSessionStore = defineStore(
  "session",
  () => {
    const mode = ref<Mode>("shell");
    const theme = ref<string>("arasaka");
    const currentEngramId = ref<string | null>(null);
    const currentFirmwareId = ref<string | null>(null);

    return { mode, theme, currentEngramId, currentFirmwareId };
  },
  {
    persist: {
      key: "mikoshi.session",
      storage: localStorage,
    },
  },
);
