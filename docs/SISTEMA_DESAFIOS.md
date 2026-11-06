# Desafíos y misiones

## Misiones diarias

La pantalla DESAFÍOS muestra tres misiones seleccionadas de una rotación
determinista de cuatro: terminar una carrera, acabar sin colisiones, ganar una
carrera o registrar una vuelta válida. El progreso se calcula al consolidar un
resultado real del simulador, no por animaciones. Se almacenan fecha UTC,
progreso, objetivo, estado, expiración y recompensas.

Las recompensas valen 45–80 NC y 40 XP por misión. Cada evento final de carrera
usa el ID de resultado como clave idempotente. El reinicio ocurre al cambiar la
fecha UTC. Sin servidor, un cambio manual del reloj puede adelantar o retrasar
la renovación.

## Alcance no implementado

No existe todavía un bus general con telemetría en tiempo real para nitro,
adelantamientos, sectores, velocidad o récords. Los desafíos actuales son
misiones agregadas al finalizar la carrera; por ello el sistema es funcional,
pero no cubre todas las categorías del encargo.
