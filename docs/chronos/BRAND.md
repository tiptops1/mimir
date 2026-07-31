# Chronos — charte de marque

> Source de vérité pour l'identité visuelle et verbale du produit.
> Les valeurs de cette page sont implémentées dans `src/app/globals.css` (tokens),
> `src/lib/brand.ts` (nom / accroche) et `src/lib/realms.ts` (royaumes).
> **Ne jamais coder une couleur en dur dans un composant** — toujours passer par un token.

---

## 1. La marque

**Chronos** — le poste de pilotage de l'achat, de la restauration et de la revente de montres.

L'emblème (`assets/brands/chronos/logo-source.png`) donne toute la direction : un boîtier
d'acier poli flottant dans une nébuleuse indigo, traversé par une aiguille-comète, cerclé
d'orbites cyan, un saphir bleu en son centre. Deux mondes s'y rencontrent — **l'horlogerie**
(métal, précision, mécanique) et **le cosmos** (profondeur, orbites, poussière d'étoiles).
Tout le produit tient dans cette rencontre.

| | |
|---|---|
| Nom produit | **Chronos** |
| Accroche | *Achat, restauration, revente — le poste de pilotage horloger.* |
| Ton | Précis, sobre, jamais bavard. Un instrument, pas un tableau de bord de startup. |
| Langue | Français (`<html lang="fr">`) |
| Emblème | `public/brands/chronos/mark.png` — carré, plein cadre, sans marge interne |

### Le wordmark

`Chr` en couleur de texte + `onos` en accent (`--brand`). Le découpage est calculé
(`splitBrand`, `src/lib/brand.ts`), jamais écrit en dur.

### Interdits

- Ne pas poser l'emblème sur un fond clair uni sans son anneau (`ring-inset`) — il perd son ancrage.
- Ne pas ré-étirer, recolorer ni recadrer l'emblème.
- Ne pas écrire « Chronos CRM », « Chronos App », « Chronos Watches ». Le nom est nu.
- Aucune référence à *Mimir*, *Avelior*, *Vision RM* nulle part dans une surface utilisateur.

---

## 2. Palette

Chronos est **sombre par nature**. Le thème clair existe et doit rester impeccable, mais le
thème sombre est celui où la marque est chez elle : c'est là que la nébuleuse respire.

### 2.1 Nébuleuse — les accents

| Rôle | Clair | Sombre | Prélevé sur |
|---|---|---|---|
| `--brand` | `#4b39c4` | `#9b8cff` | le disque violet du boîtier |
| `--brand-hover` | `#3d2ea8` | `#b5aaff` | |
| `--brand-active` | `#32248c` | `#c9c1ff` | |
| `--brand-subtle` | `#eeebff` | `rgba(155,140,255,.14)` | |
| `--accent-orbit` | `#0e8ea6` | `#4fd1e0` | les anneaux d'orbite cyan |
| `--accent-crown` | `#3b6fd4` | `#7da9ff` | le saphir de la couronne |

Le violet est **l'accent primaire** ; le cyan est le **second accent**, réservé aux surfaces
qui ont besoin de deux séries distinguables (waterfall de marge, P&L). Le bleu saphir est
décoratif — auras, halos, dégradés — jamais porteur d'information.

### 2.2 Vide et acier — les neutres

Le thème sombre descend de l'espace profond ; le thème clair, de l'acier brossé.

| Rôle | Clair (acier) | Sombre (vide) |
|---|---|---|
| `--background` | `#f6f7fb` | `#05070f` — *le vide* |
| `--surface` | `#ffffff` | `#0f1426` — *panneau* |
| `--surface-2` | `#eef0f6` | `#0b1020` |
| `--foreground` | `#141827` | `#e8ecf7` — *lumière d'étoile* |
| `--muted` | `#66708a` | `#95a1bd` |
| `--faint` | `#98a1b8` | `#5d6883` |
| `--border` | `#e5e8f0` | `#1a2138` |
| `--border-strong` | `#d3d8e5` | `#27314f` |

Aucun gris pur : tous les neutres sont légèrement bleutés. C'est ce qui empêche l'interface
de retomber dans le SaaS générique.

### 2.3 Sémantique

Verts et rouges restent lisibles à côté du violet, jamais en compétition avec lui.

| | Clair | Sombre |
|---|---|---|
| `--success` | `#0f7a45` / `#dcfce9` | `#4ade9b` / `rgba(74,222,155,.15)` |
| `--warning` | `#a55a06` / `#fdf1d6` | `#fbbf5c` / `rgba(251,191,92,.15)` |
| `--danger` | `#d32054` / `#ffe3ea` | `#fb7191` / `rgba(251,113,145,.15)` |
| `--info` | `#0e6fa8` / `#e2f1fd` | `#5cc4f5` / `rgba(92,196,245,.14)` |

### 2.4 Séries de graphiques

Ordre imposé pour toute visualisation multi-séries (`--chart-1` … `--chart-6`) :
nébuleuse → orbite → saphir → succès → alerte → danger. Une série ne choisit jamais sa
couleur elle-même.

---

## 3. Royaumes

Un royaume = un groupe de modules partageant une teinte (voir `src/lib/realms.ts`).
Chronos en compte quatre, tous dérivés de l'emblème.

| Slug | Libellé | Ce qu'il couvre | Teinte |
|---|---|---|---|
| `atelier` | **Atelier** | inventaire, fiches unités, coûts, restauration | nébuleuse (`--brand`) |
| `marche` | **Marché** | import de ventes, rapprochement, marketplaces | orbite cyan |
| `tresor` | **Trésor** | finances, marge, TVA, trésorerie | saphir → vert |
| `agents` | **Agents** | approbations, agents autonomes | ambre / comète |

Une page hors royaume (paramètres, authentification) retombe sur l'accent neutre `--brand`.

---

## 4. Typographie

| Usage | Police | Règle |
|---|---|---|
| Interface, tableaux, formulaires | **Geist Sans** | tout le travail quotidien |
| Chiffres, montants, SKU, dates | **Geist Mono** *(ou `tnum`)* | **tout montant est tabulaire** — non négociable |
| Titre de héros cosmique uniquement | **Fraunces** | jamais sur une surface de travail |

Échelle : `11px` sur-titres · `13px` navigation · `14px` corps · `15px` wordmark ·
`20px` titre de page. Suivi resserré (`tracking-tight`) sur les titres uniquement.

---

## 5. Matière et profondeur

Chronos a une **matière** : l'espace derrière, l'acier devant.

- **Bordure d'abord, ombre ensuite.** Une carte se définit par sa hairline, pas par son ombre.
- **L'aura de royaume** (`.realm-aura`) : un unique dégradé radial dans la teinte du royaume,
  ancré hors du coin haut-droit de l'en-tête de page. C'est la seule boucle ambiante autorisée.
- **Le champ d'étoiles** est réservé aux surfaces héroïques (connexion, observatoire). Jamais
  derrière un tableau — un fond animé sous des chiffres est une faute.
- **Chrome** : un `ring-1 ring-inset ring-white/15` sur les tuiles d'emblème et les pastilles
  d'accent suffit à donner le biseau métallique. Pas de dégradé de bouton.
- Rayons : `6 / 8 / 12px`. Rien de plus rond — l'horlogerie est anguleuse et précise.

## 6. Mouvement

Le mouvement dit « ces deux écrans sont le même monde », rien d'autre.

- Traverser un royaume → `realm-shift` (fondu croisé + glissement de teinte).
- Descendre dans une fiche → `nav-forward` ; remonter → `nav-back`.
- Morphs d'élément partagé sur l'identité d'une unité (`unit-${id}`).
- `prefers-reduced-motion` retire toute boucle ambiante et raccourcit les transitions.
- **Sélectionner ou cliquer ne doit jamais faire défiler la page.**

## 7. Voix

- Français, vouvoiement, phrases courtes.
- Vocabulaire du métier — *unité*, *SKU*, *référence*, *lot*, *restauration*, *marge*,
  *régime de la marge*, *marketplace*. Jamais *société*, *entreprise*, *prospect*, *deal*,
  *client B2B*.
- Les montants sont affichés en devise de base du locataire, cadrés à droite, tabulaires.
- Un chiffre financier non calculable s'affiche `—`, jamais `0`.
- Aucun conseil fiscal : les écrans de TVA rappellent que le régime relève du comptable.

## 8. Iconographie

`lucide-react` uniquement, `18px` en navigation, `16px` en ligne, trait `2`. Vocabulaire fixe :

| Concept | Icône |
|---|---|
| Inventaire / unité | `Watch` |
| Coûts / restauration | `Wrench` |
| Ventes / import | `PackageOpen` |
| Rapprochement | `Scale` |
| Finances | `Wallet` |
| Marge / performance | `TrendingUp` |
| Approbations | `ShieldCheck` |
| Paramètres | `Settings` |

---

## 9. Règles opposables

1. Aucune couleur littérale dans un composant — uniquement des tokens.
2. Le thème sombre est vérifié à chaque changement d'UI, pas après coup.
3. Chaque page de liste porte une barre de filtres complète, dans le même ordre partout.
4. Tout montant est tabulaire et aligné à droite.
5. Aucun nom de plateforme interne (Mimir, Avelior, Vision RM, panthéon nordique) visible.
6. Le vocabulaire « société / entreprise / prospect » est banni de l'interface.
