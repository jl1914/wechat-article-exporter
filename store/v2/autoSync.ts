import { getAllInfo, getInfoCache, type MpAccount } from './info';

const STORAGE_KEY = 'auto-sync-accounts';

function getStorage(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setStorage(data: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getMonitoredAccountIds(): string[] {
  const data = getStorage();
  return Object.keys(data).filter(key => data[key]);
}

export function isMonitored(fakeid: string): boolean {
  return !!getStorage()[fakeid];
}

export function setMonitored(fakeid: string, monitored: boolean) {
  const data = getStorage();
  if (monitored) {
    data[fakeid] = true;
  } else {
    delete data[fakeid];
  }
  setStorage(data);
}

export function setAllMonitored(fakeids: string[], monitored: boolean) {
  const data = getStorage();
  for (const fakeid of fakeids) {
    if (monitored) {
      data[fakeid] = true;
    } else {
      delete data[fakeid];
    }
  }
  setStorage(data);
}

export async function getMonitoredAccounts(): Promise<MpAccount[]> {
  const ids = getMonitoredAccountIds();
  if (ids.length === 0) return [];

  const accounts = await getAllInfo();
  const accountMap = new Map(accounts.map(a => [a.fakeid, a]));

  return ids.map(id => accountMap.get(id)).filter((a): a is MpAccount => !!a);
}
