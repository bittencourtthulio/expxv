// "Abrir terminal para `gh auth login`" (D-614): abre um terminal NOVO e só DIGITA o comando (sem Enter): quem faz o login é o dono, no terminal dele.
// O app nunca executa login, nunca pede senha nem token (D-34). O comando também vai para a área de transferência, de reserva.
import { ade } from "../ade";
import { pedirAcao, pedirTela } from "./navegacao";
import { storeTerminais } from "./terminais";

export const COMANDO_LOGIN_GH = "gh auth login --hostname github.com";
const ESPERA_SESSAO_MS = 8_000;
const ATRASO_DIGITAR_MS = 400;

export function abrirTerminalDeLogin(op: { escrever?: (sessaoId: string, dados: string) => void } = {}): void {
  const escrever = op.escrever ?? ((id: string, dados: string) => ade()?.terminais.escrever(id, dados));
  const antes = new Set(storeTerminais.obter().sessoes.map((s) => s.sessao_id));
  let cancelarEspera: (() => void) | null = null;
  const parar = (): void => { cancelarEspera?.(); cancelarEspera = null; };
  const desassinar = storeTerminais.assinar(() => {
    const nova = storeTerminais.obter().sessoes.find((s) => !antes.has(s.sessao_id) && s.estado !== "encerrada" && s.estado !== "erro");
    if (nova === undefined) return;
    parar();
    // SEM "\r": o comando fica no prompt, esperando o dono apertar Enter
    setTimeout(() => escrever(nova.sessao_id, COMANDO_LOGIN_GH), ATRASO_DIGITAR_MS);
  });
  const limite = setTimeout(parar, ESPERA_SESSAO_MS);
  cancelarEspera = () => { desassinar(); clearTimeout(limite); };
  void globalThis.navigator?.clipboard?.writeText(COMANDO_LOGIN_GH).catch(() => undefined);
  pedirTela("terminais");
  pedirAcao("novo-terminal");
}
