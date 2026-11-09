# Obstáculos dinámicos

`frontend/src/game/Obstacles.js` mantiene una implementación reutilizable para los tres circuitos. Cada obstáculo conserva progreso, carril base, fase, estado activo y mapa de cooldowns por vehículo.

| Tipo | Comportamiento |
|---|---|
| Barredor / roca | Desplazamiento lateral periódico; las rocas se representan como geometría facetada. |
| Giratorio | Rotación continua sobre el trazado. |
| Plataforma | Oscilación vertical; solo colisiona cuando está en posición baja. |
| Puerta | Se eleva para abrir y baja para cerrar. |
| Eléctrico | Se activa y desactiva por fase; el brillo refleja su estado. |

Los choques separan al vehículo, aplican rebote arcade y reducen su velocidad. Cada obstáculo impone un cooldown independiente por vehículo para evitar penalizaciones continuas. `destroy()` libera geometría/materiales y `reset()` restaura fases/cooldowns al reiniciar.

Los rivales usan las posiciones actualizadas de obstáculos activos al buscar bloqueos y carriles alternativos; no intentan esquivar una barrera temporalmente inactiva.

La detección sigue siendo aproximada: radios circulares XZ más tolerancia de altura, no contacto exacto con la forma visible. El ajuste de carril de la IA es gradual, pero no se ha probado visualmente una carrera completa con cada obstáculo y los cuatro vehículos simultáneos.
