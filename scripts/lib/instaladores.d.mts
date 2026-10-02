export interface ItemVerificacao { id: string; ok: boolean; mensagem: string; pulado?: boolean; [k: string]: unknown }
export interface Ferramentas { hdiutil?: string; lipo?: string; unzip?: string; plutil?: string }
export interface ProdutoLido { nome: string; id: string; appId: string; prefixoEnv: string }
export const LIMITE_MB_PADRAO: number;
export const ARQUITETURAS_MAC: string[];
export function lerProduto(raiz: string): ProdutoLido;
export function lerVersao(raiz: string): string;
export function ferramentaExiste(caminho: string): boolean;
export function sha512Base64(arquivo: string): Promise<string>;
export function lerLatest(arquivo: string): { version: string; arquivos: { url: string; sha512: string; size: number }[]; path?: string; sha512?: string };
export function conferirHashes(dir: string, yml: string, opcoes?: { exigir?: string[] }): Promise<{ itens: ItemVerificacao[]; latest: ReturnType<typeof lerLatest> | null }>;
export function conferirBlockmap(arquivo: string, blockmap: string): ItemVerificacao;
export function parsePlistXml(texto: string): any;
export function lerPlist(arquivo: string, opcoes?: { plutil?: string }): any;
export function conferirInfoPlist(plist: any, opcoes: { appId: string; versao: string }): ItemVerificacao[];
export function arquiteturas(arquivo: string, lipo?: string): string[] | null;
export function conferirApp(app: string, opcoes: { appId: string; versao: string; ferramentas?: Ferramentas }): ItemVerificacao[];
export function comDmgMontado<T>(dmg: string, hdiutil: string, fn: (pontoDeMontagem: string) => T | Promise<T>): Promise<{ erro?: string; valor?: T }>;
export function verificarZip(zip: string, unzip?: string): ItemVerificacao;
export function verificarMac(opcoes: { dir: string; produto: ProdutoLido; versao: string; ferramentas?: Ferramentas; limiteMb?: number }): Promise<ItemVerificacao[]>;
export function lerCabecalhoPE(arquivo: string): { ok: boolean; motivo?: string; maquina?: number; x64?: boolean; assinado?: boolean };
export function verificarWindows(opcoes: { dir: string; produto: ProdutoLido; versao: string; limiteMb?: number }): Promise<ItemVerificacao[]>;
export function resumo(itens: ItemVerificacao[]): { ok: boolean; falhas: string[]; total: number; pulados: number };
