import { defineStore } from "pinia";
import { ref } from "vue";
import { useTerminalStore } from "@/stores/terminal";
import { useRagStore } from "@/stores/rag";
import { useChatStore } from "@/stores/chat";

/**
 * Boot store — hydration gate for the rest of the app.
 *
 * Hybrid persistence: pinia-plugin-persistedstate is synchronous, but
 * scrollback / chat session / rag log all live in IndexedDB and rehydrate
 * asynchronously. Components that mount before those resolve would otherwise
 * see an empty state. App.vue renders <InitializingScreen /> while
 * `ready === false` and only reveals the real UI once `hydrate()` resolves.
 *
 * This step (5a) ships the scaffold only — the task array is empty. Later
 * steps append real work into `hydrate()`.
 */
export const useBootStore = defineStore("boot", () => {
  const ready = ref<boolean>(false);

  // Cached so repeated callers all await the same in-flight hydration and
  // post-completion callers short-circuit immediately.
  let hydratePromise: Promise<void> | null = null;

  async function hydrate(): Promise<void> {
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      const terminalStore = useTerminalStore();
      const ragStore = useRagStore();
      const chatStore = useChatStore();
      const tasks: Promise<unknown>[] = [
        terminalStore.hydrateScrollback(),
        ragStore.hydrate(),
        chatStore.hydrate(),
      ];
      await Promise.all(tasks);
      ready.value = true;
    })();

    return hydratePromise;
  }

  return { ready, hydrate };
});
