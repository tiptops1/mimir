/**
 * Le Bureau — the agent roster for the cosmos scene (see components/bureau/
 * bureau-cosmos.tsx). Config, not vendor protocol: each entry is a planet in
 * the solar system, keyed by the same AgentEvent.module the ledger already
 * uses (src/lib/nornir/queries.ts). Radius/period grow together (outer =
 * slower), phase staggers orbit start so planets never line up.
 */
export interface BureauAgent {
  module: string;
  name: string;
  /** One-line French flavor text — the agent's mythic role in the platform. */
  role: string;
  radius: number; // cqw, distance from the sun
  period: number; // seconds per orbit
  phase: number; // 0..1, fraction of the orbit already travelled at mount
}

export const BUREAU_AGENTS: BureauAgent[] = [
  { module: "heimdallr", name: "Heimdallr", role: "Le gardien — ledger & approbations", radius: 16, period: 16, phase: 0 },
  { module: "huginn", name: "Huginn", role: "L'éclaireur — recherche & veille", radius: 20, period: 21, phase: 0.62 },
  { module: "muninn", name: "Muninn", role: "La mémoire — archives & rappels", radius: 24, period: 26, phase: 0.28 },
  { module: "nornir", name: "Nornir", role: "Le destin — santé des comptes", radius: 28, period: 32, phase: 0.85 },
  { module: "bragi", name: "Bragi", role: "Le barde — brouillons & relances", radius: 32, period: 38, phase: 0.15 },
  { module: "forseti", name: "Forseti", role: "Le juge — conformité & contrats", radius: 36, period: 44, phase: 0.5 },
  { module: "odin", name: "Odin", role: "Le veilleur — directives & revue", radius: 40, period: 50, phase: 0.4 },
  { module: "thor", name: "Thor", role: "Le renouveau — relances & rétention", radius: 44, period: 56, phase: 0.72 },
];
