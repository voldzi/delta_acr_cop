# 06 Synthetic Data Handling

Syntetická data jsou plnohodnotně validovaná, ale vždy explicitně označená a oddělená od reálných dat.

## Pravidla

- SIM eventy musí mít `simulation.synthetic=true`.
- Handling caveats mají obsahovat `SYNTHETIC`, pokud to odpovídá policy.
- UI musí syntetická data jasně odlišit.
- Audit musí umožnit filtrovat syntetické zdroje a scénáře.
- AI odpovědi musí rozlišovat skutečná a syntetická data.
- Exporty a reporty musí nést syntetické označení.

Syntetická data nesmí být použita k vytvoření dojmu reálného situačního stavu bez explicitního označení.
