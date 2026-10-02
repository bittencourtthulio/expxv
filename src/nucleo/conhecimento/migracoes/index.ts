import type { Migracao } from "../../banco/migrar";
import { migracaoConhecimento0001 } from "./0001-base";
import { migracaoConhecimento0002 } from "./0002-fila-por-colecao";

/** Migrations do conhecimento.db, em ordem; `user_version` próprio. Nunca editar uma já publicada. */
export const MIGRACOES_CONHECIMENTO: readonly Migracao[] = [migracaoConhecimento0001, migracaoConhecimento0002];
