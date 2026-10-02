import type { Migracao } from "../migrar";
import { migracao0001 } from "./0001-base";
import { migracao0002 } from "./0002-dominio";
import { migracao0003 } from "./0003-wake-pendente";
import { migracao0004 } from "./0004-workspace-removido";
import { migracao0005 } from "./0005-harness";
import { migracao0006 } from "./0006-squads";
import { migracao0007 } from "./0007-memoria";
import { migracao0008 } from "./0008-loja-mcp";
import { migracao0009 } from "./0009-conhecimento-chat";
import { migracao0010 } from "./0010-maestro";
import { migracao0011 } from "./0011-agil";
import { migracao0012 } from "./0012-custo";
import { migracao0013 } from "./0013-alertas";
import { migracao0014 } from "./0014-relatorios";
import { migracao0015 } from "./0015-uso-fonte-opencode";
import { migracao0016 } from "./0016-bench";
import { migracao0017 } from "./0017-jarvis-remoto";
import { migracao0018 } from "./0018-catalogo-gateway";
import { migracao0019 } from "./0019-remoto-relay";
import { migracao0020 } from "./0020-bichinho";
import { migracao0021 } from "./0021-bichinho-especies";

/** Lista oficial, em ordem. Nunca editar uma migration já publicada: acrescente a próxima. */
export const MIGRACOES: readonly Migracao[] = [migracao0001, migracao0002, migracao0003, migracao0004, migracao0005, migracao0006, migracao0007, migracao0008, migracao0009, migracao0010, migracao0011, migracao0012, migracao0013, migracao0014, migracao0015, migracao0016, migracao0017, migracao0018, migracao0019, migracao0020, migracao0021];
export const VERSAO_SUPORTADA = MIGRACOES.length;
