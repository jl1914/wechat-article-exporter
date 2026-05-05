<template>
  <UCard class="mx-4 mt-10 flex-1">
    <template #header>
      <h3 class="text-2xl font-semibold">自动同步</h3>
    </template>

    <div class="flex flex-col space-y-4">
      <!-- 启用开关 -->
      <div class="flex gap-1">
        <UCheckbox v-model="autoSyncEnabled" name="autoSyncEnabled" label="启用自动同步" />
        <UPopover mode="hover" :popper="{ placement: 'top' }">
          <template #panel>
            <p class="max-w-[300px] p-3 text-sm text-gray-500">
              开启后，系统会按照设定的时间间隔自动检查已监控的公众号是否有新文章。 需要保持浏览器标签页打开才能正常工作。
            </p>
          </template>
          <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
        </UPopover>
      </div>

      <!-- 同步间隔 -->
      <div class="flex items-center gap-3">
        <span class="text-sm">同步间隔：</span>
        <UInput
          type="number"
          v-model="autoSyncInterval"
          :min="10"
          :disabled="!autoSyncEnabled"
          class="w-32 font-mono"
        >
          <template #trailing>
            <span class="text-gray-500 dark:text-gray-400 text-xs">分钟</span>
          </template>
        </UInput>
      </div>

      <!-- 立即同步按钮 -->
      <div class="flex items-center gap-3">
        <UButton
          icon="i-heroicons:bolt"
          color="amber"
          :disabled="!autoSyncEnabled || isSyncRunning"
          :loading="isSyncRunning"
          @click="autoSync.syncNow()"
        >
          {{ isSyncRunning ? '同步中...' : '立即同步' }}
        </UButton>
        <span v-if="lastSyncTime" class="text-sm text-gray-500">
          上次同步：<span class="font-mono">{{ formatTime(lastSyncTime) }}</span>
        </span>
        <span v-else class="text-sm text-gray-400">尚未执行过同步</span>
      </div>

      <!-- 自动下载开关 -->
      <div class="flex gap-1">
        <UCheckbox
          v-model="autoSyncDownload"
          name="autoDownload"
          label="自动下载新文章到缓存"
          :disabled="!autoSyncEnabled"
        />
        <UPopover mode="hover" :popper="{ placement: 'top' }">
          <template #panel>
            <p class="max-w-[300px] p-3 text-sm text-gray-500">
              开启后，当检测到新文章时会自动下载 HTML 内容到浏览器本地缓存。 仅下载文章内容，不包含阅读量、评论等需要 Credential 的数据。
            </p>
          </template>
          <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
        </UPopover>
      </div>

      <!-- 导出格式多选 -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm">自动导出格式：</span>
          <UPopover mode="hover" :popper="{ placement: 'top' }">
            <template #panel>
              <p class="max-w-[300px] p-3 text-sm text-gray-500">
                检测到新文章后，除了下载到缓存，还会按选中的格式自动导出到指定的文件夹。 命名规则复用「导出配置」中的目录名设置。 需要提前选择导出文件夹。
              </p>
            </template>
            <UIcon color="gray" name="i-heroicons:question-mark-circle-16-solid" class="size-5" />
          </UPopover>
        </div>
        <USelectMenu
          v-model="autoSyncFormats"
          :options="exportFormatOptions"
          multiple
          :disabled="!autoSyncEnabled"
          placeholder="选择要自动导出的格式"
          class="w-72"
        />
      </div>

      <!-- 导出文件夹选择 -->
      <div class="flex items-center gap-3">
        <UButton
          icon="i-heroicons:folder"
          color="sky"
          :disabled="!autoSyncEnabled"
          @click="autoSync.pickExportDirectory()"
        >
          {{ hasDirectoryHandle ? '已选择文件夹' : '选择导出文件夹' }}
        </UButton>
        <span v-if="hasDirectoryHandle" class="text-sm text-green-600">已配置</span>
        <span v-else class="text-sm text-gray-400">未配置（自动导出将不会执行）</span>
      </div>

      <!-- 状态显示 -->
      <div v-if="newArticleCount > 0" class="text-sm text-sky-600">
        <span>上次检测到 </span>
        <span class="font-mono font-bold">{{ newArticleCount }}</span>
        <span> 篇新文章</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-sm">当前状态：</span>
        <UBadge :color="statusColor" :label="statusLabel" size="sm" />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import type { Preferences } from '~/types/preferences';

const preferences = usePreferences() as unknown as Ref<Preferences>;
const autoSync = useAutoSync();

const autoSyncEnabled = computed({
  get: () => preferences.value.autoSync?.enabled ?? false,
  set: (val: boolean) => {
    if (!preferences.value.autoSync) {
      preferences.value.autoSync = { enabled: false, intervalMinutes: 30, autoDownload: false, exportFormats: [] };
    }
    preferences.value.autoSync.enabled = val;
  },
});

const autoSyncInterval = computed({
  get: () => preferences.value.autoSync?.intervalMinutes ?? 30,
  set: (val: number) => {
    if (!preferences.value.autoSync) {
      preferences.value.autoSync = { enabled: false, intervalMinutes: 30, autoDownload: false, exportFormats: [] };
    }
    preferences.value.autoSync.intervalMinutes = val;
  },
});

const autoSyncDownload = computed({
  get: () => preferences.value.autoSync?.autoDownload ?? false,
  set: (val: boolean) => {
    if (!preferences.value.autoSync) {
      preferences.value.autoSync = { enabled: false, intervalMinutes: 30, autoDownload: false, exportFormats: [] };
    }
    preferences.value.autoSync.autoDownload = val;
  },
});

const autoSyncFormats = computed({
  get: () => preferences.value.autoSync?.exportFormats ?? [],
  set: (val: string[]) => {
    if (!preferences.value.autoSync) {
      preferences.value.autoSync = { enabled: false, intervalMinutes: 30, autoDownload: false, exportFormats: [] };
    }
    preferences.value.autoSync.exportFormats = val;
  },
});

const lastSyncTime = computed(() => autoSync.lastSyncTime.value);
const newArticleCount = computed(() => autoSync.newArticleCount.value);
const syncStatus = computed(() => autoSync.syncStatus.value);
const isSyncRunning = computed(() => autoSync.isRunning.value);
const hasDirectoryHandle = computed(() => !!autoSync.exportDirectoryHandle.value);

const exportFormatOptions = [
  { label: 'HTML', value: 'html' },
  { label: 'JSON', value: 'json' },
  { label: 'Excel', value: 'excel' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'TXT', value: 'txt' },
  { label: 'Word', value: 'word' },
  { label: 'PDF', value: 'pdf' },
];

const statusLabel = computed(() => {
  switch (syncStatus.value) {
    case 'syncing':
      return '同步中';
    case 'downloading':
      return '下载中';
    case 'exporting':
      return '导出中';
    case 'error':
      return '出错';
    default:
      return '空闲';
  }
});

const statusColor = computed(() => {
  switch (syncStatus.value) {
    case 'syncing':
    case 'downloading':
    case 'exporting':
      return 'blue';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
});

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
}
</script>
