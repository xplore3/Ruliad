import api from './api';

/**
 * 下载冠军汇报包：必须走 axios 带 Authorization 头，
 * window.open 直连 /api 会被后端鉴权钩子 401。
 */
export async function exportChampionReport(): Promise<void> {
  const res = await api.get('/admin/report-export', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
