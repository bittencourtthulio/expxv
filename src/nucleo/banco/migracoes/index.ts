import type { Migracao } from "../migrar";
import { migracao0001 } from "./0001-base";
import { migracao0002 } from "./0002-dominio";
import { migracao0003 } from "./0003-wake-pendente";
import { migracao0004 } from "./0004-workspace-removido";
import { migracao0005 } from "./0005-harness";
import { migracao0006 } from "./0006-squads";

/** Lista oficial, em ordem. Nunca editar uma migration já publicada: acrescente a próxima. */
export const MIGRACOES: readonly Migracao[] = [migracao0001, migracao0002, migracao0003, migracao0004, migracao0005, migracao0006];
export const VERSAO_SUPORTADA = MIGRACOES.length;
