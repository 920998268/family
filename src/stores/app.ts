import { defineStore } from 'pinia';
import { ref } from 'vue';
import { todayKey } from '@/utils/date';

export const useAppStore = defineStore('app', () => {
  const currentDate = ref(todayKey());
  const selectedDate = ref(todayKey());

  function refreshToday(): void {
    currentDate.value = todayKey();
  }

  function selectDate(date: string): void {
    selectedDate.value = date;
  }

  return {
    currentDate,
    selectedDate,
    refreshToday,
    selectDate,
  };
});

