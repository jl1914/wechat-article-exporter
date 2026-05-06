import { useDocumentVisibility, useIntervalFn } from '@vueuse/core';
import { getArticleList } from '~/apis';
import toastFactory from '~/composables/toast';
import { getMonitoredAccounts } from '~/store/v2/autoSync';
import type { MpAccount } from '~/store/v2/info';
import type { Preferences } from '~/types/preferences';
import type { AppMsgEx } from '~/types/types';
import { Downloader } from '~/utils/download/Downloader';
import { Exporter } from '~/utils/download/Exporter';

type SyncStatus = 'idle' | 'syncing' | 'downloading' | 'exporting' | 'error';

const isRunning = ref(false);
const syncStatus = ref<SyncStatus>('idle');
const lastError = ref<string | null>(null);
const newArticleCount = ref(0);
const exportDirectoryHandle = ref<FileSystemDirectoryHandle | null>(null);

// 持久化到 localStorage 的运行时状态
const LAST_SYNC_TIME_KEY = 'auto-sync-last-time';
const EXPORT_DIR_FLAG_KEY = 'auto-sync-export-dir-ready';

function getLastSyncTime(): number | null {
  const raw = localStorage.getItem(LAST_SYNC_TIME_KEY);
  return raw ? Number(raw) : null;
}

function setLastSyncTime(timestamp: number | null) {
  if (timestamp) {
    localStorage.setItem(LAST_SYNC_TIME_KEY, String(timestamp));
  } else {
    localStorage.removeItem(LAST_SYNC_TIME_KEY);
  }
}

function getExportDirFlag(): boolean {
  return localStorage.getItem(EXPORT_DIR_FLAG_KEY) === '1';
}

function setExportDirFlag(flag: boolean) {
  if (flag) {
    localStorage.setItem(EXPORT_DIR_FLAG_KEY, '1');
  } else {
    localStorage.removeItem(EXPORT_DIR_FLAG_KEY);
  }
}

// IndexedDB 持久化 FileSystemDirectoryHandle
const EXPORT_DIR_DB_NAME = 'auto-sync-export-dir';
const EXPORT_DIR_DB_VERSION = 1;

function openExportDirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EXPORT_DIR_DB_NAME, EXPORT_DIR_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handle')) {
        db.createObjectStore('handle');
      }
    };
  });
}

async function saveExportDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openExportDirDB();
  const tx = db.transaction('handle', 'readwrite');
  const store = tx.objectStore('handle');
  await new Promise<void>((resolve, reject) => {
    const req = store.put(handle, 'dir');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  db.close();
}

async function loadExportDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openExportDirDB();
    const tx = db.transaction('handle', 'readonly');
    const store = tx.objectStore('handle');
    const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const req = store.get('dir');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle || null;
  } catch {
    return null;
  }
}

async function verifyExportDirHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // @ts-ignore
    const status = await handle.queryPermission({ mode: 'readwrite' });
    return status === 'granted';
  } catch {
    return false;
  }
}

export default () => {
  const toast = toastFactory();
  const loginAccount = useLoginAccount();
  const preferences = usePreferences();
  const visibility = useDocumentVisibility();

  let downloader: Downloader | null = null;

  const lastSyncTime = ref<number | null>(getLastSyncTime());
  const hadExportDir = ref<boolean>(getExportDirFlag());

  // 页面加载时尝试从 IndexedDB 恢复导出文件夹 handle
  onMounted(async () => {
    if (getExportDirFlag()) {
      const handle = await loadExportDirHandle();
      if (handle && (await verifyExportDirHandle(handle))) {
        exportDirectoryHandle.value = handle;
      }
    }
  });

  const intervalMs = computed(() => {
    const minutes = (preferences.value as unknown as Preferences).autoSync?.intervalMinutes ?? 30;
    return Math.max(minutes, 1) * 60 * 1000;
  });

  const { pause, resume, isActive } = useIntervalFn(
    () => {
      console.log('[autoSync interval] timer fired, calling syncCycle()');
      syncCycle();
    },
    intervalMs,
    { immediate: false, immediateCallback: false }
  );

  watch(
    () => (preferences.value as unknown as Preferences).autoSync?.enabled,
    enabled => {
      console.log('[autoSync watch enabled] enabled=', enabled);
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

  // 登录状态恢复后，如果自动同步已启用则启动
  watch(loginAccount, account => {
    if (account && (preferences.value as unknown as Preferences).autoSync?.enabled) {
      start();
    }
  });

  function start() {
    console.log('[autoSync.start] called, loginAccount=', !!loginAccount.value, 'isActive=', isActive.value);
    if (!loginAccount.value) {
      console.log('[autoSync.start] aborted: no loginAccount');
      return;
    }
    if (isActive.value) {
      console.log('[autoSync.start] aborted: already active');
      return;
    }
    console.log('[autoSync.start] calling resume(), intervalMs=', intervalMs.value);
    resume();
    syncStatus.value = 'idle';
    lastError.value = null;
    console.log('[autoSync.start] resume() called, isActive now=', isActive.value);
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

  async function pickExportDirectory() {
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
      });
      exportDirectoryHandle.value = handle;
      setExportDirFlag(true);
      hadExportDir.value = true;
      await saveExportDirHandle(handle);
      toast.success('导出文件夹', '已成功选择导出文件夹');
      return handle;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return null;
      }
      toast.error('导出文件夹', `选择文件夹失败: ${e.message}`);
      return null;
    }
  }

  async function syncCycle() {
    console.log('[syncCycle] called, isRunning=', isRunning.value);
    if (isRunning.value) {
      console.log('[syncCycle] skipped: already running');
      return;
    }
    if (!loginAccount.value) {
      console.log('[syncCycle] stopping: no loginAccount');
      stop();
      return;
    }

    isRunning.value = true;
    syncStatus.value = 'syncing';
    lastError.value = null;
    newArticleCount.value = 0;

    try {
      const accounts = await getMonitoredAccounts();
      console.log('[syncCycle] monitored accounts count=', accounts.length);
      if (accounts.length === 0) {
        isRunning.value = false;
        syncStatus.value = 'idle';
        console.log('[syncCycle] no monitored accounts, returning');
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

        const autoSyncConfig = (preferences.value as unknown as Preferences).autoSync;

        if (autoSyncConfig?.autoDownload) {
          syncStatus.value = 'downloading';
          await autoDownload(newArticleUrls);
        }

        const formats = autoSyncConfig?.exportFormats ?? [];
        if (formats.length > 0) {
          if (exportDirectoryHandle.value) {
            syncStatus.value = 'exporting';
            await autoExport(newArticleUrls, formats);
          } else if (hadExportDir.value) {
            toast.warning('自动导出', '导出文件夹授权已过期，请重新选择');
          }
        }
      }

      lastSyncTime.value = Date.now();
      setLastSyncTime(lastSyncTime.value);
      syncStatus.value = 'idle';
      console.log('[syncCycle] completed successfully, lastSyncTime=', new Date(lastSyncTime.value).toISOString());
    } catch (e: any) {
      console.error('[syncCycle] failed:', e);
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

  async function autoExport(urls: string[], formats: string[]) {
    for (const format of formats) {
      try {
        const exporter = new Exporter(urls);
        exporter.setExportDirectoryHandle(exportDirectoryHandle.value);
        await exporter.startExport(format as any);
        toast.success('自动导出', `已自动导出 ${format.toUpperCase()} 格式`);
      } catch (e: any) {
        console.error(`自动导出 ${format} 失败:`, e);
        toast.error('自动导出', `${format.toUpperCase()} 导出失败: ${e.message}`);
      }
    }
  }

  return {
    isRunning: readonly(isRunning),
    lastSyncTime: readonly(lastSyncTime),
    syncStatus: readonly(syncStatus),
    lastError: readonly(lastError),
    newArticleCount: readonly(newArticleCount),
    exportDirectoryHandle: readonly(exportDirectoryHandle),
    hadExportDir: readonly(hadExportDir),
    isActive,
    start,
    stop,
    syncNow,
    pickExportDirectory,
  };
};
