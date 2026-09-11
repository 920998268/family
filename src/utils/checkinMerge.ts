/**
 * 「本地 ∪ 云端」合并规则（纯函数，可单测）。
 *
 * 读取路径是「本地先渲染、云端后到达」：本地缓存立刻出画面（秒开），
 * 云端结果回来后再合并回写。合并必须同时满足两件事：
 *
 * 1. **同 id 以云端为准** —— 别人（同一家庭的另一台设备）改了这条记录，要能覆盖本地旧值；
 * 2. **本地独有记录保留** —— 尚未上云的新记录不能因为云端没有就被抹掉。
 *
 * ⚠️ 第三条容易被忽略：**本地有待同步修改的记录，必须用本地版本**。
 * 若一律「云端为准」，离线时改的那条记录会被云端的旧值覆盖回去 ——
 * 用户看到自己刚改的内容自己变回去了，且这次覆盖还会被回写进本地缓存。
 */
export function mergeCheckins<T extends { id: string }>(
  local: readonly T[],
  remote: readonly T[],
  pendingIds?: ReadonlySet<string>,
): T[] {
  const localById = new Map<string, T>();
  for (const entry of local) {
    if (!localById.has(entry.id)) {
      localById.set(entry.id, entry);
    }
  }

  const merged: T[] = [];
  const taken = new Set<string>();

  for (const remoteEntry of remote) {
    // 云端理论上不会出现重复 id；真出现时只取第一条，避免同一条记录展示两遍
    if (taken.has(remoteEntry.id)) {
      continue;
    }
    taken.add(remoteEntry.id);

    const localEntry = localById.get(remoteEntry.id);
    if (localEntry && pendingIds?.has(remoteEntry.id)) {
      // 本地这条还没推上云，云端拿到的是旧值 —— 保留本地
      merged.push(localEntry);
    } else {
      merged.push(remoteEntry);
    }
  }

  // 本地独有：既包含「云端还没有的新记录」，也包含「云端已删除但本地仍在」的情况。
  // 后者按 §6 的约定刻意保留（云端没有删除入口给别的设备用），不做隐式删除。
  for (const localEntry of local) {
    if (!taken.has(localEntry.id)) {
      taken.add(localEntry.id);
      merged.push(localEntry);
    }
  }

  return merged;
}
