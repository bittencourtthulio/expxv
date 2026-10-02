// Cofre do app no main (Fase 9, T-09.21): escolhe o motor e abre o cofre SOB DEMANDA (nada de cofre/chaveiro no boot).
//  - macOS/Windows (e Linux com chaveiro seguro): `safeStorage` do Electron (injetado, nunca importado aqui).
//  - Linux sem chaveiro (`basic_text`) ou sem cifrador: arquivo cifrado com SENHA-MESTRA do usuário (P-29; scrypt + AES-256-GCM).
//  - Se o arquivo já existe, o motor que o criou vale (trocar de motor não perde segredos nem os abre errado).
import { join } from "node:path";
import { criarCofre, criarMotorSafeStorage, criarMotorSenhaMestra, lerMotorDoArquivo, type Cofre, type MotorCofre, type ParametrosScrypt, type PortaSafeStorage } from "../nucleo/cofre";

/** Subconjunto do `safeStorage` do Electron que o cofre usa (injetado). */
export interface SafeStorageDoElectron {
  isEncryptionAvailable(): boolean;
  encryptString(texto: string): Uint8Array;
  decryptString(dados: Uint8Array): string;
  getSelectedStorageBackend?: () => string;
}

export function adaptarSafeStorage(ss: SafeStorageDoElectron): PortaSafeStorage {
  return {
    disponivel: () => {
      try {
        return ss.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    backend: () => {
      try {
        return typeof ss.getSelectedStorageBackend === "function" ? ss.getSelectedStorageBackend() : null;
      } catch {
        return null;
      }
    },
    cifrar: (t) => ss.encryptString(t),
    decifrar: (d) => ss.decryptString(d),
  };
}

export interface DependenciasCofreMain {
  /** `app.getPath("userData")`. */
  userData: string;
  safeStorage: SafeStorageDoElectron;
  /** bloqueio automático (padrão 15 min; 0 = nunca). Só vale com senha-mestra. */
  inatividade_ms?: number;
  aviso?: (mensagem: string) => void;
  aoMudarEstado?: Parameters<typeof criarCofre>[0]["aoMudarEstado"];
  /** custo do scrypt (padrão do núcleo; testes injetam baixo). */
  scrypt?: ParametrosScrypt;
}

export const ARQUIVO_COFRE = "cofre.json";

export async function escolherMotor(d: DependenciasCofreMain): Promise<MotorCofre> {
  const arquivo = join(d.userData, ARQUIVO_COFRE);
  const gravado = await lerMotorDoArquivo(arquivo);
  const safe = criarMotorSafeStorage(adaptarSafeStorage(d.safeStorage));
  const mestra = (): MotorCofre => criarMotorSenhaMestra(d.scrypt === undefined ? {} : { scrypt: d.scrypt });
  if (gravado === "senha_mestra") return mestra();
  if (gravado === "safe_storage") return safe;
  return safe.estado().ok ? safe : mestra();
}

export interface CofreSobDemanda {
  /** abre (1ª vez) e devolve o cofre; chamadas seguintes reaproveitam. */
  obter(): Promise<Cofre>;
  aberto(): boolean;
  encerrar(): Promise<void>;
}

export function criarCofreSobDemanda(d: DependenciasCofreMain): CofreSobDemanda {
  let aberto: Promise<Cofre> | null = null;
  return {
    obter() {
      aberto ??= escolherMotor(d).then((motor) =>
        criarCofre({
          arquivo: join(d.userData, ARQUIVO_COFRE),
          motor,
          ...(d.inatividade_ms === undefined ? {} : { inatividade_ms: d.inatividade_ms }),
          ...(d.aviso === undefined ? {} : { aviso: d.aviso }),
          ...(d.aoMudarEstado === undefined ? {} : { aoMudarEstado: d.aoMudarEstado }),
        }),
      );
      return aberto;
    },
    aberto: () => aberto !== null,
    async encerrar() {
      if (aberto === null) return;
      const c = await aberto;
      aberto = null;
      await c.encerrar();
    },
  };
}
