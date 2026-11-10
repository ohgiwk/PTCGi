import type { EnergyType, ProvidedEnergy } from '../engine';

export const TYPE_INFO: Record<ProvidedEnergy, { label: string; color: string; text: string }> = {
  Grass: { label: '草', color: '#3fa34d', text: '#fff' },
  Fire: { label: '炎', color: '#e4572e', text: '#fff' },
  Water: { label: '水', color: '#2e86de', text: '#fff' },
  Lightning: { label: '雷', color: '#f4c20d', text: '#222' },
  Psychic: { label: '超', color: '#9b59b6', text: '#fff' },
  Fighting: { label: '闘', color: '#b5651d', text: '#fff' },
  Darkness: { label: '悪', color: '#2d3436', text: '#fff' },
  Metal: { label: '鋼', color: '#8e9aa6', text: '#fff' },
  Dragon: { label: '竜', color: '#b8860b', text: '#fff' },
  Fairy: { label: 'フ', color: '#e88fc7', text: '#fff' },
  Colorless: { label: '無', color: '#d9d9d9', text: '#222' },
  Any: { label: '全', color: 'linear-gradient(135deg,#e4572e,#f4c20d,#3fa34d,#2e86de,#9b59b6)', text: '#fff' },
};

export function typeColor(t: EnergyType | undefined): string {
  return t ? TYPE_INFO[t].color : '#ccc';
}
