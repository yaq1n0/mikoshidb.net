<script setup lang="ts">
// No props — rendered while useBootStore().ready is false.
</script>

<template>
  <div class="h-full flex items-center justify-center px-6 py-4">
    <div class="max-w-2xl text-fg font-mono">
      <div class="text-accent glow text-xl mb-6">▓▒░ INITIALIZING ░▒▓</div>
      <div class="space-y-3 glow">
        <div>&gt;&gt; restoring session state…</div>
        <div>&gt;&gt; rehydrating persisted buffers from local store.</div>
      </div>
    </div>
  </div>
</template>
