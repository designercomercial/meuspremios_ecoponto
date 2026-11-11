/**
 * Endereços de outros canais do app SASI.
 *
 * PENDENTE: os endereços reais (deep links) de cada canal. Até lá, são
 * configuráveis por variável de ambiente no build (VITE_LINK_*).
 */
export type Links = {
  faleConosco: string;
  meusPontos: string;
};

const env = import.meta.env;

export const LINKS: Links = {
  faleConosco: env.VITE_LINK_FALE_CONOSCO ?? "/fale-conosco",
  meusPontos: env.VITE_LINK_MEUS_PONTOS ?? "/pontos/",
};
