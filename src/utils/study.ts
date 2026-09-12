/**
 * 学习模块的纯逻辑工具（与 `utils/workout.ts` 同定位）。
 *
 * 这里放的是「跨端形态换算」中与学习领域相关、且能在映射层之外复用的部分。
 * 云端记录的字段映射本身在 `utils/cloudMap.ts`。
 */

/**
 * 归一化打卡备注。
 *
 * `validateStudyCheckin` 要求 `note` **必须是字符串**（不能是 `undefined` / `null`），
 * 而云端空备注存的是 `null`。不归一化的话，云端回来的整条打卡会被校验器判非法，
 * 进而被 `StudyCheckinRepository.readByKey` **静默丢弃** ——
 * 现象是「打卡莫名其妙少了几条」，而且本地写入是成功的，很难对照发现。
 *
 * 其它类型（数字等）统一转成字符串，而不是丢弃：
 * 宁可展示成 `"3"`，也不让一条记录凭空消失。
 */
export function normalizeStudyNote(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}
