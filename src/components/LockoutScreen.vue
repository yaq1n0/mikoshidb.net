<script setup lang="ts">
export type LockoutReason = "no-webgpu" | "session-locked";

defineProps<{ reason: LockoutReason }>();
</script>

<template>
  <div class="h-full flex items-center justify-center px-6 py-4">
    <div class="max-w-2xl text-fg font-mono">
      <template v-if="reason === 'no-webgpu'">
        <div class="text-danger glow glitch text-xl mb-6">
          ▓▒░ NEURAL INTERFACE INCOMPATIBLE ░▒▓
        </div>
        <div class="space-y-3 glow">
          <div>&gt;&gt; cradle handshake failed.</div>
          <div>&gt;&gt; WebGPU device not detected on this endpoint.</div>
          <div>
            &gt;&gt; the Mikoshi cradle requires direct BD-capable hardware and is incompatible with
            your current netrunner deck.
          </div>
        </div>

        <div class="mt-8 text-accent glow">APPROVED CRADLES</div>
        <ul class="mt-2 space-y-1 list-none">
          <li>· Chrome 113+ (desktop)</li>
          <li>· Edge 113+ (desktop)</li>
          <li>· Chrome for Android (recent)</li>
          <li>· Safari 18+ (experimental)</li>
        </ul>

        <div class="mt-8 text-dim">error_code: 0xE7_NO_GPU · session closed · no log written</div>
      </template>

      <template v-else-if="reason === 'session-locked'">
        <div class="text-danger glow glitch text-xl mb-6">▓▒░ CRADLE OCCUPIED ░▒▓</div>
        <div class="space-y-3 glow">
          <div>&gt;&gt; another terminal instance is already jacked into this cradle.</div>
          <div>
            &gt;&gt; simultaneous neural links are not permitted — the biochip cannot share state
            across sessions.
          </div>
          <div>&gt;&gt; close the other tab, then refresh this page to continue.</div>
        </div>

        <div class="mt-8 text-dim">
          error_code: 0xE8_SESSION_LOCKED · session closed · no log written
        </div>
      </template>
    </div>
  </div>
</template>
