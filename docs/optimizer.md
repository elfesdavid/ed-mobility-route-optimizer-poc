# Optimizer V1

## Hard und Soft Constraints

Hard Constraints werden vor dem Weiterführen eines Zustands geprüft: Opportunity-Status, Pickup- und Delivery-Zeitfenster, Fahrer-Verfügbarkeit, tatsächlicher Fahrzeugstandort, Fahrzeugverfügbarkeit, Cargo-Kapazität und bestätigte Bookings. Ein Ergebnis mit einem verletzten Hard Constraint wird nicht zurückgegeben.

Risikoprofile konfigurieren den Transferpuffer und die Risikobewertung. Der Puffer wird als harte Sicherheitsreserve vor Pickup- und Delivery-Deadlines berücksichtigt: `SAFE` reserviert 30 Minuten, `NORMAL` 15 Minuten und `AGGRESSIVE` 5 Minuten. Selbst `AGGRESSIVE` darf keine objektiv unmögliche Zeit akzeptieren. Komfort, bevorzugte Endzeit und zusätzliche Leerfahrt sind für die nächste Iteration als Soft-Penalties vorgesehen.

## Zustandsübergänge

Ein `SearchState` ist ein Wertobjekt: aktuelle Location, aktuelle Zeit, Transportmodus, Fahrzeug, dessen aktuelle Search-State-Position, Opportunity-Sequenz, Legs und kumulierte Kennzahlen. Eigene Fahrzeuge bewegen sich bei `OWN_VEHICLE`-Legs mit dem Fahrer; der unveränderte `WorldState` bleibt nur die Ausgangsbasis. Eine Fahrzeugüberführung endet am Ziel im Modus `WALKING`, weil das Kundenfahrzeug dort abgegeben wurde. Cargo wird für die gesamte Aktion gegen die aktuelle Kapazität geprüft. Der übergebene `WorldState` wird nie verändert.

## Beam Search und Lookahead

Für jede Ebene werden alle noch nicht verwendeten Opportunities als mögliche nächste Aktion getestet. Feasible Aktionen erzeugen neue Zustände. Nach jeder Ebene bleiben höchstens `beamWidth` Kandidaten. Der effektive Suchhorizont ist `min(lookaheadDepth, maxStops)`: `maxStops` bleibt die harte Obergrenze, während `lookaheadDepth` die tatsächlich untersuchte Tiefe begrenzt. Die Standardkonfiguration erlaubt drei Schritte, damit Ketten wie `A → B → C` bewertet werden, ohne die gesamte Kombinationenmenge zu enumerieren.

Kandidaten mit bestätigten Bookings erhalten beim partiellen Ranking einen starken Prioritätsbonus. Die finale Auswahl verwirft jede Sequenz, die nicht alle bestätigten zukünftigen Bookings enthält. Wenn ein bestätigtes Booking im aktualisierten Snapshot nicht mehr verfügbar ist, erzeugt Replanning eine `CONFIRMED_BOOKING_AT_RISK`-Erklärung.

## Scoring

`ScoreBreakdown` enthält Umsatz, Reisekosten, Überschuss, Dauer, Umsatz pro Stunde, Leerstrecke, Risikopenalty und den finalen Score. `MAX_REVENUE` sortiert primär nach Umsatz und verwendet Überschuss, Umsatz/Stunde und Risiko als Tie-Breaker. Die anderen Modi verwenden eine direkt lesbare Formel; die BALANCED-Gewichte liegen zentral in `DEFAULT_CONFIG`.

## Local Search

Die besten Beam-Kandidaten werden begrenzt mit Remove, Replace und Swap erneut abgespielt. Jede Variante durchläuft dieselben Feasibility-Regeln wie die Beam Search. Dadurch kann eine gute Reihenfolge lokal verbessert werden, ohne eine zweite, abweichende Regelimplementierung zu pflegen.

## Replanning

`replan` übernimmt alle Legs, deren Ankunft vor `currentTime` liegt, unverändert. Die Restoptimierung startet am letzten bekannten Zielort mit dem aktualisierten WorldState und übernimmt den Transportmodus des letzten abgeschlossenen Legs, einschließlich Taxi, Rideshare und Eigenfahrzeug. Liegt `currentTime` innerhalb eines Legs, wird das Replanning sicher blockiert, weil der exakte Zwischenstand nicht aus einer abgeschlossenen Mission ableitbar ist. Zukünftige bestätigte Bookings des betroffenen Fahrers bleiben Pflicht; nicht mehr erreichbare oder nicht mehr vorhandene Bookings werden als gefährdet erklärt. Der zurückgegebene Score wird über Vergangenheit und Zukunft aggregiert.

## Warum V1 kein MILP/CP-SAT ist

Beam Search ist für einen kleinen, deterministischen Proof of Concept einfacher zu testen und zu erklären. Sie bildet die wichtigsten Sequenzentscheidungen, Lookahead und Ressourcenübergänge ab. Bei deutlich mehr Nebenbedingungen, harten globalen Ressourcenlimits oder größeren Suchräumen können CP-SAT, MILP oder LNS später ergänzend eingesetzt werden. Der RoutingProvider und die Zustands-/Scoring-Grenzen halten diese Erweiterung offen.
