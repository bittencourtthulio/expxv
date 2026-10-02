import { PRODUTO } from "../produto";

// Onde o mapa grava no repositório do usuário (e SÓ aí): `<pasta do produto>/mapa/<carimbo>/`. O nome vem de `PRODUTO` (D-01).
export const PASTA_PRODUTO = PRODUTO.pastaNoProjeto;
export const PASTA_PACOTES = `${PRODUTO.pastaNoProjeto}/mapa`;
export const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
