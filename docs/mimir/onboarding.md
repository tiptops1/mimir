# Onboarding client — parcours d'intégration Mimir (brouillon S13b)

> Document côté client : ce que le cabinet (courtier ou autre vertical) doit préparer et
> valider avant et pendant son intégration sur la plateforme. Rédigé au stade S13b — aucun
> client réel n'est encore passé par ce parcours ; à réviser au premier onboarding réel.

## 1. Prérequis client

- **Approbateur désigné.** Une personne nommée côté client détient le rôle ADMIN et approuve
  les actions des agents dans la boîte d'approbation (Heimdallr). C'est elle qui valide les
  imports, les montées en autonomie et les purges. Sans approbateur désigné, pas de mise en route.
- **Accès Google (si messagerie/agenda concernés).** Consentement OAuth par le titulaire du
  compte — jamais de partage de mot de passe. Portée minimale (lecture Gmail, lecture/écriture
  Calendar selon modules activés). *Dépend de G1 (vérification OAuth production + CASA) — tant
  que non close, uniquement des comptes de test.*
- **DPA signé.** Accord de traitement des données (sous-traitance RGPD) signé avant toute
  ingestion de données réelles : finalités, sous-traitants ultérieurs (hébergeur, fournisseurs
  de modèles), durées de conservation, procédure d'effacement.

## 2. Inventaire des données (gate G2)

Avant toute ingestion (emails, documents, exports CRM), le client répond à l'inventaire :

- Quelles sources ? (export CRM, boîte mail support, documents internes, transcriptions)
- Quels volumes mensuels approximatifs ?
- **Les données contiennent-elles des données de santé ?** (Pour un courtier santé/prévoyance :
  presque certainement oui.) La réponse détermine le périmètre HDS et le champ d'application de
  la posture d'exclusion D3 : le classifieur santé met en quarantaine tout contenu signalé
  **avant** stockage — seule une empreinte (hash) et le verdict sont conservés, jamais le texte.
- Quels champs de l'export CRM sont du texte libre ? (notes, commentaires — ce sont eux qui
  passent par le classifieur à l'import)

## 3. Exports à fournir

- Format : **CSV encodé UTF-8**, 4 Mo max par fichier (découper si besoin), avec ligne
  d'en-têtes. Séparateur `;` ou `,` — détecté automatiquement.
- Attention aux exports Excel Windows : « Enregistrer sous → CSV UTF-8 », sinon l'import
  rejette le fichier (encodage non UTF-8 détecté, accents illisibles).
- Colonnes utiles : identifiant société (SIRET idéalement), raison sociale, contact
  (nom/prénom/email/téléphone), étape pipeline, dates de contact, notes. Les colonnes sans
  équivalent restent ignorées ou deviennent des **champs personnalisés** (aucune migration
  nécessaire — configuration, pas code).
- Sources typiques : export natif HubSpot/Pipedrive/Salesforce, ou l'onglet Excel qui sert de
  CRM aujourd'hui.

## 4. Déroulé de l'import (Paramètres → Import)

1. **Téléversement** — empreinte du fichier calculée ; le même fichier re-téléversé reprend
   l'import existant (idempotent).
2. **Mapping des colonnes** — suggestions automatiques à partir des en-têtes ; l'approbateur
   valide colonne par colonne. Le mapping peut être enregistré (« Export HubSpot ») et réutilisé.
3. **Simulation (dry-run)** — rapport sans écriture : créations, mises à jour, doublons
   ignorés (même SIRET ; les lignes sans SIRET reçoivent une clé déterministe), lignes en
   erreur, sociétés ressemblantes à vérifier dans Doublons.
4. **Confirmation** — import réel en tâche de fond : le texte libre passe par le classifieur
   santé (quarantaine des champs signalés — la fiche est importée sans eux), chaque fiche créée
   est tracée vers son import (`importRunId`). Relançable sans double-création.
5. **Revue post-import** — l'approbateur vérifie les lignes en erreur, la quarantaine et les
   doublons suggérés.

## 5. Politique de montée en autonomie

- Tous les agents démarrent au **niveau 0** (proposition uniquement, rien ne s'exécute sans
  approbation). La graduation (0 → 3) est **par catégorie d'action et par tenant**, fondée sur
  les statistiques réelles d'approbation/édition — jamais globale, jamais implicite.
- Catégories **jamais graduées** : argent, engagement juridique, contenu signalé santé.
  Plafond appliqué par le code, pas seulement par la configuration.
- Un disjoncteur rétrograde automatiquement une catégorie dont le taux d'édition se dégrade.
- Le client choisit son rythme : rester au niveau 0 indéfiniment est un mode de
  fonctionnement supporté, pas un échec d'onboarding.

## 6. Réversibilité et traçabilité

- Chaque fiche importée porte l'identifiant de son import : « tout ce qu'a créé l'import X »
  est une requête, et une purge ciblée par import est possible sur demande.
- Toutes les actions d'agents passent par le registre (ledger) : proposé → approuvé/édité/
  rejeté → exécuté → annulable, avec sources et déclencheur. L'historique d'événements est
  append-only.
- Effacement RGPD : procédure dédiée (AuditLog `RGPD_ERASE`) ; la quarantaine ne contenant
  jamais de texte, elle n'entre pas dans le périmètre des données personnelles restituables.

## 7. Checklist go-live

- [ ] Approbateur désigné, compte ADMIN créé, connexion vérifiée
- [ ] DPA signé
- [ ] Inventaire G2 complété ; périmètre santé/HDS tranché
- [ ] Export CRM fourni au format CSV UTF-8, import simulé puis confirmé
- [ ] Lignes en erreur et quarantaine revues par l'approbateur
- [ ] Doublons suggérés arbitrés (Paramètres → Doublons)
- [ ] OAuth Google accordé (si modules messagerie/agenda) — sinon planifié post-G1
- [ ] Politique d'autonomie expliquée ; toutes les catégories confirmées au niveau 0
- [ ] Contact de support et procédure d'escalade communiqués
