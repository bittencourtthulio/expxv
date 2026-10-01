import { ErroExtracao, type Extrator } from "./comum";

// Stub (T-17.06): o extrator de rust entra na sua task (T-17.08..T-17.15). Lança `nao_implementado`.
export const extratorRust: Extrator = {
  extrair() {
    throw new ErroExtracao("nao_implementado", "rust");
  },
};
