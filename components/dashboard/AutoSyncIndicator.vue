<template>
  <div
    v-if="enabled"
    class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
  >
    <span
      class="inline-block size-2 rounded-full"
      :class="indicatorClass"
    />
    <span>{{ statusText }}</span>
  </div>
</template>

<script setup lang="ts">
import type { Preferences } from '~/types/preferences';

const preferences = usePreferences() as unknown as Ref<Preferences>;
const autoSync = useAutoSync();

const enabled = computed(() => preferences.value.autoSync?.enabled);
const syncStatus = computed(() => autoSync.syncStatus.value);
const isActive = computed(() => autoSync.isActive.value);

const indicatorClass = computed(() => {
  if (syncStatus.value === 'error') {
    return 'bg-rose-500';
  }
  if (!isActive.value) {
    return 'bg-gray-400';
  }
  if (syncStatus.value === 'syncing' || syncStatus.value === 'downloading') {
    return 'bg-blue-500 animate-pulse';
  }
  return 'bg-green-500';
});

const statusText = computed(() => {
  if (syncStatus.value === 'error') {
    return '自动同步出错';
  }
  if (!isActive.value) {
    return '自动同步已暂停';
  }
  if (syncStatus.value === 'syncing') {
    return '自动同步中';
  }
  if (syncStatus.value === 'downloading') {
    return '自动下载中';
  }
  return '自动同步中';
});
</script>
