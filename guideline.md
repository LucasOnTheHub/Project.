---
type: master
role: core-star
project: Project.
version: 0.2.0
status: draft
created: 2026-04-12
author: LucasOnTheHub
tags: [core, guideline, architecture, vision]
gravity: 1.0
---

# Project. — Guideline maîtresse

> Ce fichier est l'**étoile centrale** du vault `Project.`.
> Tous les autres fichiers orbitent autour de lui via leur propriété `project:` et leur `gravity:`.
> Il doit rester le point de vérité pour la vision, l'architecture et les conventions.

---

## 1. Vision

**Project.** est un gestionnaire de projets *file-based* (comme un Vault Obsidian) avec une interface **3D spatiale** où chaque projet est représenté comme un **système solaire** :

- **Étoile centrale** → fichier maître du projet (ce type de fichier, `type: master`)
- **Planètes / nodes** → fichiers du projet (`.md`, `.py`, `.jsx`, `.json`, assets, etc.)
- **Orbites** → relation gravitationnelle au cœur, définie par la propriété `gravity`
- **Liens directs** → arêtes explicites entre nodes (équivalent des `[[wikilinks]]` Obsidian)
- **Galaxie** → ensemble des projets visibles simultanément, chacun avec son étoile

L'objectif n'est **pas** de remplacer un IDE ou Obsidian, mais d'offrir une **couche d'orchestration visuelle et sémantique** au-dessus d'un simple dossier de fichiers, pilotable **à 100 % par une IA via MCP**.

---

## 2. Principes directeurs

1. **File-first** — Aucune donnée n'existe uniquement en base. Tout est un fichier sur disque, lisible hors de l'app, versionnable par git.
2. **Open format** — Les métadonnées vivent dans un front-matter YAML (pour les fichiers texte) ou dans un sidecar `.project.yml` (pour les binaires et fichiers code qui ne supportent pas de front-matter non-invasif).
3. **Type-agnostic** — Le système accepte *n'importe quel* type de fichier. Le type détermine uniquement le rendu du node et les actions contextuelles, pas sa capacité à exister dans le graphe.
4. **MCP-native** — Toute action utilisateur doit être réalisable via l'API MCP. L'UI est un client parmi d'autres.
5. **Local-first** — Fonctionne offline. La synchro (git, cloud) est optionnelle.
6. **Physique comme sémantique** — La position spatiale n'est pas décorative : elle *signifie* quelque chose (gravité = importance, distance = couplage, cluster = sous-système).

---

## 3. Architecture fichiers

```
MyProject/
├── .project/
│   ├── config.yml           # config du vault
│   ├── index.db             # cache SQLite (reconstructible)
│   └── sidecars/            # métadonnées pour fichiers non-textuels
│       └── assets/logo.png.project.yml
├── guideline.md             # ⭐ étoile centrale (type: master)
├── docs/
│   ├── architecture.md
│   └── roadmap.md
├── src/
│   ├── main.py
│   └── ui/App.jsx
└── assets/
    └── logo.png
```

Le dossier `.project/` est l'équivalent du `.obsidian/` d'Obsidian : il contient la config et un cache, jamais de données canoniques.

---

## 4. Schéma de métadonnées (front-matter)

Chaque fichier trackable expose (au minimum) :

```yaml
---
type: master | doc | code | asset | task | note | reminder
project: Project.          # nom du projet parent (= étoile)
gravity: 0.0 → 1.0         # force d'attraction vers le cœur (1.0 = collé, 0.0 = libre)
links: [file1.md, src/main.py]   # liens explicites sortants
tags: [arch, backend]
status: draft | active | done | archived
created: YYYY-MM-DD
---
```

### Champs spécifiques par `type`

- **`task`** : `due`, `priority`, `parent` (pour les sous-tâches), `assignee`, `done: bool`
- **`reminder`** : `trigger` (cron ou ISO date), `channel` (notif, mcp, email), `recurring: bool`
- **`code`** : `language`, `entrypoint: bool`
- **`asset`** : `mime`, `size`

Règle d'or : **tout champ inconnu est conservé tel quel**. Le système ne doit jamais strip une propriété qu'il ne comprend pas.

---

## 5. Modèle 3D & physique

- **Moteur** : three.js + react-three-fiber (côté renderer).
- **Étoile** : sphère émissive, taille ∝ nombre de fichiers du projet.
- **Nodes** : mesh dont la forme dépend du `type` (cube pour code, sphère pour doc, tétraèdre pour task…).
- **Force gravitationnelle** : chaque node subit une attraction vers son étoile proportionnelle à `gravity × masse_étoile / distance²`. Un node avec `gravity: 0` dérive librement.
- **Liens** : arêtes lumineuses (lignes courbes géodésiques) entre nodes liés. Un lien agit comme un ressort qui rapproche deux nodes.
- **Clusters** : les nodes partageant des `tags` subissent une faible attraction mutuelle → formation naturelle de constellations.
- **Caméra** : navigation libre (orbit + fly), focus automatique sur un node au clic.
- **LOD** : au-delà d'une distance seuil, les labels disparaissent et les nodes deviennent des points lumineux (lisibilité à l'échelle galaxie).

---

## 6. API MCP — surface à exposer

Le serveur MCP `project-mcp` doit exposer au minimum :

### Ressources
- `project://{name}` — lecture du master file
- `project://{name}/files` — liste complète
- `project://{name}/graph` — graphe sérialisé (nodes + edges)

### Tools
- `list_projects()`
- `create_project(name, master_content)`
- `create_node(project, path, type, content, metadata)`
- `update_node(project, path, patch)`
- `delete_node(project, path)`
- `link_nodes(project, from, to)`
- `set_gravity(project, path, value)`
- `create_task(project, title, parent?, due?)`
- `toggle_task(project, path)`
- `create_reminder(project, title, trigger, channel)`
- `search(project?, query)` — plein-texte + métadonnées
- `export_project(project, format)` — `zip`, `md-bundle`, `json-graph`

Règle : chaque tool doit être **idempotent quand c'est possible** et retourner l'état post-action, pas juste un OK.

---

## 7. Stack technique (proposition)

| Couche | Choix |
|---|---|
| Runtime | Electron + Node (desktop, pour l'accès fichier natif) |
| UI | React + TypeScript |
| 3D | three.js + @react-three/fiber + @react-three/drei |
| Physique | custom (force-directed + gravité radiale) ou `d3-force-3d` |
| Parser front-matter | `gray-matter` |
| Watcher fichiers | `chokidar` |
| Index | SQLite via `better-sqlite3` (FTS5 pour la recherche) |
| MCP | SDK officiel `@modelcontextprotocol/sdk` (serveur stdio + HTTP) |
| Tests | vitest |

À challenger — aucune de ces briques n'est gravée dans le marbre tant que le MVP n'est pas figé.

---

## 8. Roadmap indicative

- **M0 — Fondations** : lecture/écriture vault, front-matter, index SQLite, CLI debug.
- **M1 — MCP** : serveur MCP fonctionnel avec les tools de §6. Claude doit pouvoir créer un projet et des nodes de bout en bout sans UI.
- **M2 — UI 2D** : vue graphe plate (d3) pour valider le modèle de données.
- **M3 — UI 3D** : passage three.js, étoile centrale, gravité, liens.
- **M4 — Tâches & rappels** : sous-tâches, scheduler pour les reminders.
- **M5 — Export & sync** : zip, git, éventuellement sync cloud.
- **M6 — Galaxie multi-projets** : plusieurs étoiles visibles, transitions.

---

## 9. Conventions de développement

- **Commits** : Conventional Commits (`feat:`, `fix:`, `docs:`…).
- **Branches** : `main` protégée, features sur `feat/xxx`.
- **Code style** : Prettier + ESLint, TypeScript strict.
- **Tests** : toute route MCP doit avoir au moins un test d'intégration.
- **Docs** : chaque décision d'architecture non-triviale → un fichier `docs/adr-XXX.md` (type: `doc`, gravity élevée, linké à ce guideline).

---

## 10. Décisions d'architecture

*Tranchées avant M1 — 2026-04-12*

### Sidecars
- [x] **`foo.ext.project.yml` à côté du binaire** (ex: `logo.png.project.yml`).
  Le sidecar vit et meurt avec son fichier. Un `mv`/`rm` reste cohérent sans logique de sync centralisée.
  → Le watcher `chokidar` doit filtrer les `*.project.yml` pour ne pas les indexer comme nodes.

### Tâches
- [x] **Fichiers dédiés** (`type: task`).
  Un fichier = un node = un objet physique dans le graphe 3D. Permet le linking individuel via MCP, impossible avec des blocs inline.

### Scheduler des rappels
- [x] **Délégation OS encapsulée derrière une interface `ReminderScheduler`**.
  Aucun process daemon maison. Trois implémentations :

  ```typescript
  interface ReminderScheduler {
    schedule(reminder: Reminder): Promise<void>
    cancel(reminderId: string): Promise<void>
    list(): Promise<ScheduledReminder[]>
  }
  // MacOSScheduler   → launchd (plist ~/Library/LaunchAgents)
  // LinuxScheduler   → systemd user timers ou cron
  // WindowsScheduler → schtasks CLI
  ```

  Le reminder déclenche l'app via deep link `project://remind?id=xxx` ou l'outil MCP `trigger_reminder`.
  Pour M4 : implémenter la plateforme cible principale, plugger les autres ensuite.

### Permissions MCP
- [x] **Granulaire — 3 scopes** :

  | Scope | Tools couverts |
  |---|---|
  | `read` | `list_projects`, `search`, lecture graph/node |
  | `write` | `create_node`, `update_node`, `link_nodes`, `set_gravity`, `create_task`, `toggle_task`, `create_reminder` |
  | `admin` | `delete_node`, `delete_project`, `export_project`, `create_project` |

  Configuration dans `.project/config.yml` :

  ```yaml
  mcp:
    default_scope: read
    agents:
      claude-code: [read, write]
      claude-desktop: [read, write, admin]
  ```

  Règle : `write` = réversible (git). `admin` = irréversible ou structurant, accordé explicitement.

### Gestion des conflits
- [x] **Last-write-wins pour M1** (hypothèse documentée, non adressée).
  Adresser en M5 avec la couche de sync git. Aucun lockfile, aucun diff UI avant M5.

---

## 11. Questions ouvertes

*(aucune à ce stade — à alimenter au fil du développement)*

---

*Ce document est vivant. Toute modification de la vision ou de l'architecture doit passer par une mise à jour ici en priorité — c'est littéralement l'étoile qui tient le reste du projet en orbite.*
