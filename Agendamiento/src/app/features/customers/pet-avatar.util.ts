export type PetAvatarTone =
  | 'perro'
  | 'gato'
  | 'aves'
  | 'pequenas'
  | 'reptiles'
  | 'peces'
  | 'grandes'
  | 'exoticas'
  | 'other';

export interface PetAvatarDisplay {
  emoji: string;
  tone: PetAvatarTone;
}

const EXACT: Record<string, PetAvatarDisplay> = {
  Perro: { emoji: '🐕', tone: 'perro' },
  Gato: { emoji: '🐈', tone: 'gato' },
  Canarios: { emoji: '🐤', tone: 'aves' },
  Periquitos: { emoji: '🦜', tone: 'aves' },
  Loros: { emoji: '🦜', tone: 'aves' },
  Cacatúas: { emoji: '🦜', tone: 'aves' },
  Conejos: { emoji: '🐰', tone: 'pequenas' },
  Hámsters: { emoji: '🐹', tone: 'pequenas' },
  Cobayas: { emoji: '🐹', tone: 'pequenas' },
  Hurones: { emoji: '🐹', tone: 'pequenas' },
  Tortugas: { emoji: '🐢', tone: 'reptiles' },
  Iguanas: { emoji: '🦎', tone: 'reptiles' },
  Serpientes: { emoji: '🐍', tone: 'reptiles' },
  Ranas: { emoji: '🐸', tone: 'reptiles' },
  Ornamentales: { emoji: '🐟', tone: 'peces' },
  Caballos: { emoji: '🐴', tone: 'grandes' },
  Vacas: { emoji: '🐄', tone: 'grandes' },
  Cerdos: { emoji: '🐷', tone: 'grandes' },
  Cabras: { emoji: '🐐', tone: 'grandes' },
  Ovejas: { emoji: '🐑', tone: 'grandes' },
  Erizos: { emoji: '🦔', tone: 'exoticas' },
  Chinchillas: { emoji: '🐭', tone: 'exoticas' },
};

function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Heurística para textos libres («Otro») o datos antiguos. */
function guessFromText(raw: string): PetAvatarDisplay | null {
  const s = normalizeKey(raw);
  if (!s) return null;
  if (/(perro|dog|can)\b/.test(s) || s.includes('perro')) {
    return EXACT['Perro'];
  }
  if (/(gato|cat|felin)\b/.test(s) || s.includes('gato')) {
    return EXACT['Gato'];
  }
  if (/(ave|loro|periqu|canari|pajaro|pájaro|cacatu|guacamayo)/.test(s)) {
    return { emoji: '🦜', tone: 'aves' };
  }
  if (/(conejo|hamster|hámster|cobaya|hurón|huron|rata|cone)\b/.test(s)) {
    return { emoji: '🐰', tone: 'pequenas' };
  }
  if (/(tortug|iguana|serpiente|rana|reptil|lagart)/.test(s)) {
    return { emoji: '🐢', tone: 'reptiles' };
  }
  if (/(pez|peces|pescado|ornamental|acuario)/.test(s)) {
    return EXACT['Ornamentales'];
  }
  if (/(caballo|vaca|cerdo|cabra|oveja|burro|mula|granja)/.test(s)) {
    return { emoji: '🐴', tone: 'grandes' };
  }
  if (/(erizo|chinchilla|exotic)/.test(s)) {
    return { emoji: '🦔', tone: 'exoticas' };
  }
  return null;
}

export function petAvatarFromSpecies(species: string | null | undefined): PetAvatarDisplay {
  const key = species?.trim() ?? '';
  if (key && EXACT[key]) {
    return EXACT[key];
  }
  const guessed = key ? guessFromText(key) : null;
  if (guessed) {
    return guessed;
  }
  return { emoji: '🐾', tone: 'other' };
}
