import { getCloud, isCloudReady, uploadAvatar } from '@/unicloud';

/**
 * 确保头像为云端可访问地址：
 * - 已是云存储 fileID(cloud://) 或永久 URL(https://) → 直接返回
 * - 本地临时路径(wxfile://、blob:、含 /tmp/ 或 /temp/ 的 http) → 上传云存储，返回 fileID
 */
export async function ensureCloudAvatar(url?: string): Promise<string | undefined> {
  if (!url) return url;
  if (url.startsWith('cloud://') || url.startsWith('https://')) return url;
  const isLocalTemp =
    url.startsWith('wxfile://') ||
    url.startsWith('blob:') ||
    url.includes('/tmp/') ||
    url.includes('/temp/');
  if (!isLocalTemp) return url;
  try {
    uni.showLoading({ title: '上传头像中...', mask: true });
    const fileID = await uploadAvatar(url);
    return fileID;
  } catch (e) {
    console.warn('[头像] 上传失败，保留本地路径:', e);
    return url;
  } finally {
    uni.hideLoading();
  }
}

/** 云存储 fileID 临时 URL 缓存 */
const tempUrlCache = new Map<string, string>();

/** 将云存储 fileID(cloud://) 解析为可访问 URL；普通 URL 原样返回 */
export async function resolveAvatarUrl(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (!url.startsWith('cloud://')) return url;
  if (tempUrlCache.has(url)) return tempUrlCache.get(url);
  if (!isCloudReady()) {
    // 未初始化时框架会给 uniCloud 挂上直接 reject 的桩方法，
    // 报错信息是「cli项目需要使用HBuilderX运行菜单并关联服务空间」，容易误导
    console.warn('[头像] uniCloud 未初始化，跳过临时URL解析，改用占位头像');
    return url;
  }
  try {
    // 必须走 getCloud()：裸 uniCloud 编译后是框架的静态导出快照，取不到已初始化的实例
    const res = await getCloud().getTempFileURL({ fileList: [url] });
    const u = res?.fileList?.[0]?.tempFileURL || url;
    tempUrlCache.set(url, u);
    return u;
  } catch (e) {
    console.warn('[头像] 临时URL解析失败，尝试原样显示:', e);
    return url;
  }
}
