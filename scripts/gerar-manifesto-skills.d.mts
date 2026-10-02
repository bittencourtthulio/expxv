export const VERSAO_PACOTE: number;
export interface SkillManifesto { name: string; version: number; path: string; description: string; clis: string[]; sha256: string }
export interface ManifestoSkills { manifest_version: number; skills: SkillManifesto[] }
export function calcularManifesto(raiz: string): ManifestoSkills;
export function textoDoManifesto(raiz: string): string;
