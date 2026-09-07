# ED Mobility Route Optimizer – Proof of Concept

Dieser PoC beweist die Kernlogik für mehrstufige Missionen eines einzelnen selbstständigen Fahrzeugüberführers. Er enthält bewusst keine Website, Datenbank, Plattformintegration oder externe Routing-API.

## Architektur

- `src/domain`: typisierte, immutable behandelbare Fachmodelle wie `Money`, `Opportunity`, `Booking`, `Mission` und `WorldState`.
- `src/fixtures`: reproduzierbare deutsche Städte, statische Transitverbindungen und 50+ synthetische Opportunities.
- `src/routing`: `RoutingProvider`-Schnittstelle und deterministischer Fixture-Provider.
- `src/optimizer`: Hard-Constraint-Prüfung, Transport-/Cargo-Regeln, Zustandsübergänge, Beam Search, Lookahead, Local Search und Replanning.
- `src/scoring`: nachvollziehbare Scoring-Modi und ScoreBreakdown.

Geld wird ausschließlich als Ganzzahl in Cent gespeichert. Fahrer und Fahrzeuge sind getrennte Ressourcen. Ein Fahrzeug darf nur an seinem tatsächlichen Standort verwendet werden; Cargo und Passenger-Aufträge werden gegen Transportmittel, Cargo-Kapazität und verfügbare Sitze geprüft.

## Optimierungsansatz

Der Optimizer erzeugt mit Beam Search mehrere Zustandskandidaten. Der effektive Suchhorizont ist `min(lookaheadDepth, maxStops)`; `maxStops` bleibt die harte Obergrenze. Jeder Zustand enthält Ort, Zeit, Transportmittel, Legs, Umsatz, Kosten und verwendete Opportunities. Nur hard-feasible Übergänge werden weiterverfolgt. Die besten Kandidaten werden anschließend mit begrenzten Remove-, Replace- und Swap-Schritten lokal verbessert.

Unterstützte Modi sind `MAX_REVENUE`, `MAX_REVENUE_PER_HOUR`, `MAX_ESTIMATED_SURPLUS`, `BALANCED` und `DESTINATION`. `DESTINATION` behandelt Zielort und Deadline als Hard Constraint und kann eine reine Transferroute zurückgeben.

## Setup

Voraussetzung ist eine aktuelle Node.js-Version mit npm. Das Projekt verwendet keine Datenbank, keine Cloud-Dienste und keine externen APIs.

Abhängigkeiten installieren:

```bash
npm install
```

## Build und Tests

TypeScript kompilieren:

```bash
npm run build
```

Die automatisierten Tests ausführen:

```bash
npm test
```

Der Testlauf deckt Hard Constraints, Fahrzeugstandorte, Cargo-Kapazität, Lookahead, Destination Mode, bestätigte Bookings, Replanning, Determinismus, Mutation und Hard-Constraint-Invarianten ab.

## Demo und Benchmark

Eine formatierte Beispielausgabe mit mehreren Missionsalternativen erzeugen:

```bash
npm run demo
```

Die deterministischen Benchmark-Szenarien für 50, 100, 250 und 500 Opportunities ausführen:

```bash
npm run benchmark
```

## Lokale Browser-Demo

Die kleine lokale Demo-Oberfläche verwendet weiterhin ausschließlich die Demo-Fixtures und den bestehenden Optimizer. Es gibt noch kein Backend, keine Datenbank und keine externe Routing-API.

```bash
npm run ui
```

Danach im Browser [http://127.0.0.1:3000](http://127.0.0.1:3000) öffnen. Die Oberfläche zeigt bis zu drei Missionsalternativen und erlaubt die Auswahl von Optimierungsmodus, Risikoprofil, Startort und Transportmittel. Die Szenario-Auswahl bleibt eine lokale Demo-Annahme und speichert noch keine echten Fahrerdaten.

## Bekannte Vereinfachungen

- Routing ist statisch und nutzt keine echte Fahrplan-, Karten- oder Verkehrsdatenquelle.
- Cargo-Machbarkeit ist eine konservative Size-Class-Regel, kein 3D-Bin-Packing.
- Cargo wird innerhalb einer Opportunity atomar zwischen Pickup und Delivery geführt; neue Opportunities werden in diesem Abschnitt nicht eingeschoben. Transport-Legs tragen die Cargo-Items als Audit-Information, und diese Strecke zählt nicht als Leerfahrt.
- Local Search ist absichtlich klein gehalten und kein vollständiges LNS/CP-SAT-Verfahren.
- `excludeNegativeContribution` bewertet den kumulierten Missionsüberschuss; negative Zwischenlegs bleiben für profitable Lookahead-Ketten zulässig.
- Kosten und Fahrzeiten sind Fixture-Schätzungen.

Neue Fixtures können in `src/fixtures/world.ts` über die vorhandenen Helfer `opportunity`, `cargo` und `createBaseWorld` ergänzt werden. Für einen neuen Routing-Provider muss nur `RoutingProvider` implementiert werden.
