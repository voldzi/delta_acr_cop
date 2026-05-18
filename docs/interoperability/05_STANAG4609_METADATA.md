# 05 STANAG 4609 Metadata

STANAG 4609 metadata pro video a senzorické proudy jsou mimo MVP implementaci, ale architektura musí počítat s budoucím adapterem.

## Baseline

- metadata se převádí na canonical observation,
- přílohy nebo objemná média patří do objektového úložiště,
- COP state drží pouze relevantní metadata a odkazy,
- classification a releasability se zachovávají,
- provenance musí odkazovat na původní stream nebo segment.
