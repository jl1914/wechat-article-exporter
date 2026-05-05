import { useDocumentVisibility, useIntervalFn } from '@vueuse/core';
import { getArticleList } from '~/apis';
import toastFactory from '~/composables/toast';
import { getMonitoredAccounts } from '~/store/v2/autoSync';
import type { MpAccount } from '~/store/v2/info';
import type { Preferences } from '~/types/preferences';
import type { AppMsgEx } from '~/types/types';
import { Downloader } from '~/utils/download/Downloader';

type SyncStatus = 'idle' | 'syncing' | 'downloading' | 'error';

const isRunning = ref(false);
const lastSyncTime = ref<number | null>(null);
const syncStatus = ref<SyncStatus>('idle');
const lastError = ref<string | null>(null);
const newArticleCount = ref(0);

export default () => {
  const toast = toastFactory();
  const loginAccount = useLoginAccount();
  const preferences = usePreferences();
  const visibility = useDocumentVisibility();

  let downloader: Downloader | null = null;

  const intervalMs = computed(() => {
    const minutes = (preferences.value as unknown as Preferences).autoSync?.intervalMinutes ?? 30;
    return Math.max(minutes, 1) * 60 * 1000;
  });

  const { pause, resume, isActive } = useIntervalFn(
    () => {
      syncCycle();
    },
    intervalMs,
    { immediate: false, immediateCallback: false }
  );

  watch(
    () => (preferences.value as unknown as Preferences).autoSync?.enabled,
    enabled => {
      if (enabled) {
        start();
      } else {
        stop();
      }
    },
    { immediate: true }
  );

  watch(visibility, vis => {
    if (!(preferences.value as unknown as Preferences).autoSync?.enabled) return;
    if (vis === 'visible') {
      resume();
    } else {
      pause();
    }
  });

  function start() {
    if (!loginAccount.value) return;
    if (isActive) return;
    resume();
    syncStatus.value = 'idle';
    lastError.value = null;
  }

  function stop() {
    pause();
    isRunning.value = false;
    syncStatus.value = 'idle';
  }

  function syncNow() {
    if (!loginAccount.value) {
      toast.error('自动同步', '请先登录公众号');
      return;
    }
    syncCycle();
  }

  async function syncCycle() {
    if (isRunning.value) return;
    if (!loginAccount.value) {
      stop();
      return;
    }

    isRunning.value = true;
    syncStatus.value = 'syncing';
    lastError.value = null;
    newArticleCount.value = 0;

    try {
      const accounts = await getMonitoredAccounts();
      if (accounts.length === 0) {
        isRunning.value = false;
        syncStatus.value = 'idle';
        return;
      }

      const newArticleUrls: string[] = [];

      for (const account of accounts) {
        try {
          const previousLastUpdateTime = account.last_update_time ?? 0;
          const [articles] = await getArticleList(account, 0);

          const newArticles = articles.filter(
            article => article.itemidx === 1 && article.create_time > previousLastUpdateTime
          );

          if (newArticles.length > 0) {
            newArticleUrls.push(...newArticles.map(a => a.link));
            newArticleCount.value += newArticles.length;
          }
        } catch (e: any) {
          if (e.message === 'session expired') {
            loginAccount.value = null;
            stop();
            toast.error('自动同步', '登录会话已过期，请重新登录');
            return;
          }
          console.error(`自动同步账号 ${account.nickname} 失败:`, e);
        }
      }

      if (newArticleUrls.length > 0) {
        toast.success('自动同步', `检测到 ${newArticleUrls.length} 篇新文章`);

        if ((preferences.value as unknown as Preferences).autoSync?.autoDownload) {
          syncStatus.value = 'downloading';
          await autoDownload(newArticleUrls);
        }
      }

      lastSyncTime.value = Date.now();
      syncStatus.value = 'idle';
    } catch (e: any) {
      console.error('自动同步周期失败:', e);
      syncStatus.value = 'error';
      lastError.value = e.message;
    } finally {
      isRunning.value = false;
    }
  }

  async function autoDownload(urls: string[]) {
    try {
      downloader = new Downloader(urls, { concurrency: 3 });
      await downloader.startDownload('html');
      toast.success('自动下载', `${urls.length} 篇新文章已自动下载`);
    } catch (e: any) {
      console.error('自动下载失败:', e);
      toast.error('自动下载', `部分文章下载失败: ${e.message}`);
    } finally {
      downloader = null;
    }
  }

  return {
    isRunning: readonly(isRunning),
    lastSyncTime: readonly(lastSyncTime),
    syncStatus: readonly(syncStatus),
    lastError: readonly(lastError),
    newArticleCount: readonly(newArticleCount),
    isActive,
    start,
    stop,
    syncNow,
  };
};
