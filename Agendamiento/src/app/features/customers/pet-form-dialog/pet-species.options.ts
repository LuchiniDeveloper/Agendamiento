/** Valor interno del mat-select cuando la especie es libre. */
export const PET_SPECIES_OTHER = '__otro__' as const;

export interface PetSpeciesGroup {
  label: string;
  options: { label: string; value: string }[];
}

export const PET_SPECIES_GROUPS: readonly PetSpeciesGroup[] = [
  {
    label: 'Común',
    options: [
      { label: 'Perro', value: 'Perro' },
      { label: 'Gato', value: 'Gato' },
    ],
  },
  {
    label: 'Aves',
    options: [
      { label: 'Canarios', value: 'Canarios' },
      { label: 'Periquitos', value: 'Periquitos' },
      { label: 'Loros', value: 'Loros' },
      { label: 'Cacatúas', value: 'Cacatúas' },
    ],
  },
  {
    label: 'Pequeñas',
    options: [
      { label: 'Conejos', value: 'Conejos' },
      { label: 'Hámsters', value: 'Hámsters' },
      { label: 'Cobayas', value: 'Cobayas' },
      { label: 'Hurones', value: 'Hurones' },
    ],
  },
  {
    label: 'Reptiles',
    options: [
      { label: 'Tortugas', value: 'Tortugas' },
      { label: 'Iguanas', value: 'Iguanas' },
      { label: 'Serpientes', value: 'Serpientes' },
      { label: 'Ranas', value: 'Ranas' },
    ],
  },
  {
    label: 'Peces',
    options: [{ label: 'Ornamentales', value: 'Ornamentales' }],
  },
  {
    label: 'Grandes',
    options: [
      { label: 'Caballos', value: 'Caballos' },
      { label: 'Vacas', value: 'Vacas' },
      { label: 'Cerdos', value: 'Cerdos' },
      { label: 'Cabras', value: 'Cabras' },
      { label: 'Ovejas', value: 'Ovejas' },
    ],
  },
  {
    label: 'Exóticas',
    options: [
      { label: 'Erizos', value: 'Erizos' },
      { label: 'Chinchillas', value: 'Chinchillas' },
    ],
  },
];

const PRESET_VALUES = new Set(
  PET_SPECIES_GROUPS.flatMap((g) => g.options.map((o) => o.value)),
);

export function resolveSpeciesPreset(
  species: string | null | undefined,
): { preset: string; other: string } {
  const s = species?.trim() ?? '';
  if (!s) return { preset: '', other: '' };
  if (PRESET_VALUES.has(s)) return { preset: s, other: '' };
  return { preset: PET_SPECIES_OTHER, other: s };
}

export function speciesFromForm(preset: string, other: string): string | null {
  if (!preset) return null;
  if (preset === PET_SPECIES_OTHER) {
    const t = other.trim();
    return t || null;
  }
  return preset;
}
