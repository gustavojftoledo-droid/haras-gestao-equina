// Tipos mínimos, defensivos (tudo opcional/string), refletindo os campos usados
// pelo app_145.html — não é o schema completo do app, só o suficiente para as
// duas ferramentas deste servidor. Ver README para as linhas de referência no app.

export interface Horse {
  id?: string;
  codigo?: string;
  nome?: string;
  apelido?: string;
  sexo?: "MASCULINO" | "FEMININO" | string;
  situacao?: "P" | "E" | "V" | string; // Próprio / Externo / Vendido
  status?: string;
  nascimento?: string; // ISO YYYY-MM-DD
  falecimento?: string; // ISO YYYY-MM-DD, vazio se vivo
  pelagem?: string;
  categoria?: string;
  localizacao?: string;
  proprietario?: string;
  comprador?: string;
  protocoloPotro?: ProtocoloItem[];
  [k: string]: unknown;
}

export interface ManejoAnimalRef {
  id?: string;
  nome?: string;
}

export interface Manejo {
  id?: string;
  data?: string; // ISO YYYY-MM-DD
  tipo?: "Casco" | "Dente" | "Vacina" | "Vermífugo" | string;
  obs?: string;
  animais?: ManejoAnimalRef[];
  medicamentoId?: string;
  medicamentoNome?: string;
  [k: string]: unknown;
}

export interface ProtocoloItem {
  id?: string;
  regraId?: string;
  nome?: string;
  ordinal?: number;
  dataAlvo?: string; // ISO YYYY-MM-DD
  feito?: boolean;
  dataFeito?: string;
}

export interface Nascimento {
  id?: string;
  matriz?: string;
  pai?: string;
  animalId?: string | null;
  protocoloVacinas?: ProtocoloItem[];
  [k: string]: unknown;
}

export interface Config {
  freqVacinas?: Record<string, number | string>;
  [k: string]: unknown;
}

export interface Backup {
  exportedAt?: string;
  horses?: Horse[];
  manejos?: Manejo[];
  nascimentos?: Nascimento[];
  config?: Config;
  [k: string]: unknown;
}
