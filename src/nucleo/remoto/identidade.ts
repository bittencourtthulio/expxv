// Identidade de longo prazo do servidor remoto (T-13.12): par ECDSA P-256 guardado SÓ no cofre (porta de segredos; o main liga ao cofre do SO). O dispositivo fixa a chave
// pública no pareamento. A chave privada nunca é devolvida ao renderer, nunca vai a log nem a arquivo em claro. Gera na primeira vez.
import { assinar, novoParAssinatura } from "./protocolo";

export const NOME_SEGREDO_IDENTIDADE = "REMOTO_IDENTIDADE_PRIVADA";
export const NOME_SEGREDO_IDENTIDADE_PUBLICA = "REMOTO_IDENTIDADE_PUBLICA";

export interface PortaSegredos {
  ler(nome: string): Promise<string | null>;
  gravar(nome: string, valor: string): Promise<void>;
}
export interface IdentidadeServidor {
  publicaSpki(): Buffer;
  assinar(dados: Buffer): Buffer;
}
export async function carregarIdentidade(segredos: PortaSegredos): Promise<IdentidadeServidor> {
  const priv = await segredos.ler(NOME_SEGREDO_IDENTIDADE);
  const pub = await segredos.ler(NOME_SEGREDO_IDENTIDADE_PUBLICA);
  let privada: Buffer;
  let publica: Buffer;
  if (priv !== null && pub !== null) {
    privada = Buffer.from(priv, "base64");
    publica = Buffer.from(pub, "base64");
  } else {
    const par = novoParAssinatura();
    privada = par.privadaPkcs8;
    publica = par.publicaSpki;
    await segredos.gravar(NOME_SEGREDO_IDENTIDADE, privada.toString("base64"));
    await segredos.gravar(NOME_SEGREDO_IDENTIDADE_PUBLICA, publica.toString("base64"));
  }
  return { publicaSpki: () => publica, assinar: (d) => assinar(privada, d) };
}
