import { ErroExtracao, type Extrator } from "./comum";

// Stub (T-17.06): o extrator de cpp entra na sua task (T-17.08..T-17.15). Lança `nao_implementado`.
export const extratorCpp: Extrator = {
  extrair() {
    throw new ErroExtracao("nao_implementado", "cpp");
  },
};
