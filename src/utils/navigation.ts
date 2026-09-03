export const ME_TAB_PATH = '/pages/me/me';

export function openMeTab(): void {
  uni.switchTab({ url: ME_TAB_PATH });
}
