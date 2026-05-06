<template>
  <div :class="isDev ? 'debug-screens' : ''" class="flex flex-col h-screen">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <UNotifications />
    <UModals />
  </div>
</template>

<script setup lang="ts">
import { ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { isDev } from '~/config';
import { isChromeBrowser } from '~/utils';

const runtimeConfig = useRuntimeConfig();

ModuleRegistry.registerModules([AllEnterpriseModule]);
LicenseManager.setLicenseKey(runtimeConfig.public.aggridLicense);

if (!isChromeBrowser()) {
  alert('为了更好的用户体验，推荐使用 Chrome 浏览器。');
}

// 初始化自动同步（仅在客户端）
if (process.client) {
  const autoSync = useAutoSync();
  console.log('[app.vue] calling autoSync.start(), loginAccount=', useLoginAccount().value);
  autoSync.start();
  console.log('[app.vue] autoSync.start() returned');
}
</script>

<style>
@import 'style.css';
</style>
