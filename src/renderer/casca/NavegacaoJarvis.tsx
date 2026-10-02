import { useEffect } from "react";
import { ade } from "../ade";
import { pedirTela } from "../estado/navegacao";

/** `abrir_pane` do Jarvis: o main já validou o painel; aqui só leva a pessoa à tela Terminais (sem UI própria, sem peso no boot). */
export function NavegacaoJarvis({ api = ade()?.jarvis }: { api?: { assinarNavegacao(cb: (e: { ref: string }) => void): () => void } | undefined }) {
  useEffect(() => api?.assinarNavegacao(() => pedirTela("terminais")), [api]);
  return null;
}
