<script setup lang="ts">
import { commandUi } from "../cockpit";
import CommandDialog from "./CommandDialog.vue";

/**
 * Mount point for the command UI. One instance, near the app root, because a
 * command is not attached to any widget — `kavibay.google-calendar/join-next-meeting`
 * has no widget at all, and an argument prompt must not be trapped inside a
 * card that happens to be on screen.
 */
</script>

<template>
  <CommandDialog
    :request="commandUi.request.value"
    @answer="commandUi.answer"
    @confirm="commandUi.confirm"
  />

  <!--
    `notify` is the one thing a command says rather than asks, and it must not
    block: `runCommand` calls it on a failure path it is about to rethrow.
  -->
  <div v-if="commandUi.notice.value" class="notice" role="status" @click="commandUi.dismissNotice()">
    {{ commandUi.notice.value }}
  </div>
</template>

<style scoped>
.notice {
  position: fixed;
  bottom: 18px;
  left: 50%;
  z-index: 40;
  transform: translateX(-50%);
  max-width: 420px;
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--fg-rgb));
  background: rgba(28, 30, 34, 0.96);
  border: 1px solid rgba(var(--fg-rgb), 0.18);
  border-radius: 9px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
</style>
