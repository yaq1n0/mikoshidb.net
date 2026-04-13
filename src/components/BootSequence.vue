<script setup lang="ts">
import { onMounted, ref } from "vue";

const emit = defineEmits<{ (e: "done"): void }>();

const lines = ref<string[]>([]);

const script: Array<{ text: string; delay: number }> = [
  { text: "ARASAKA BIOS v7.3.41  (c) 2077 ARASAKA CORPORATION", delay: 80 },
  { text: "copyright protected — unauthorized access prosecuted", delay: 40 },
  { text: "", delay: 40 },
  { text: "[OK]  POST complete", delay: 120 },
  { text: "[OK]  cradle interface handshake", delay: 120 },
  { text: "[OK]  neural bus nominal", delay: 120 },
  { text: "[OK]  biochip socket armed", delay: 120 },
  { text: "[OK]  WebGPU device located", delay: 140 },
  { text: "[OK]  Mikoshi vault pinged // 42ms", delay: 180 },
  { text: "", delay: 60 },
  { text: ">> mounting /dev/mikoshi/engrams ...", delay: 200 },
  { text: ">> mounting /dev/mikoshi/firmware ...", delay: 200 },
  { text: ">> mounting /dev/mikoshi/themes ...", delay: 200 },
  { text: "", delay: 100 },
  {
    text: "                    __  __ _ _              _     _ ",
    delay: 20,
  },
  {
    text: "                   |  \\/  (_) | _____  ___| |__ (_)",
    delay: 20,
  },
  {
    text: "                   | |\\/| | | |/ / _ \\/ __| '_ \\| |",
    delay: 20,
  },
  {
    text: "                   | |  | | |   < (_) \\__ \\ | | | |",
    delay: 20,
  },
  {
    text: "                   |_|  |_|_|_|\\_\\___/|___/_| |_|_|",
    delay: 20,
  },
  { text: "", delay: 40 },
  {
    text: "           ARASAKA ENGRAM VAULT // PUBLIC READ-ONLY CRADLE",
    delay: 80,
  },
  { text: "", delay: 60 },
  { text: "type 'help' to list commands.", delay: 40 },
  {
    text: "type 'ls engrams' to browse stored personas.",
    delay: 40,
  },
  { text: "type 'ls firmware' to browse biochip firmware.", delay: 40 },
  { text: "", delay: 40 },
];

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

onMounted(async () => {
  for (const step of script) {
    lines.value.push(step.text);
    await delay(step.delay);
  }
  await delay(150);
  emit("done");
});
</script>

<template>
  <div class="h-full overflow-y-auto px-6 py-4 font-mono text-fg">
    <div v-for="(line, i) in lines" :key="i" class="whitespace-pre glow">
      {{ line }}
    </div>
    <div class="glow">&gt;&nbsp;<span class="cursor" /></div>
  </div>
</template>
