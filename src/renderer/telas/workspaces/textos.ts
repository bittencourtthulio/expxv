import type { AcessoExterno } from "../../../compartilhado/dominio";

export const AVISO_AUTOMATICO =
  "Modo automático: as CLIs deste workspace rodam sem pedir confirmação a cada ação, incluindo editar arquivos e executar comandos na pasta. Use só em projetos de confiança e com o git em dia.";
export const AVISO_SEGURO = "Modo seguro: a CLI pede confirmação antes de agir (padrão).";

export const ROTULO_ACESSO: Record<AcessoExterno, string> = {
  nenhum: "Sem acesso externo",
  leitura: "Acesso externo: leitura",
  leitura_escrita: "Acesso externo: leitura e escrita",
};
