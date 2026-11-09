# Arquitectura final de NEON RUSH — Fase 7

## Alcance

Este documento consolida la arquitectura funcional, gráfica, de progresión y de cómputo paralela de la Fase 7 antes de la entrega académica y de demostración.

## 1. Frontend y gameplay

### Runtime principal
- `frontend/src/main.js` centraliza el arranque del juego, navegación, selección de circuitos y vehículos, gestión del estado de carrera y recursos asociados.
- Se mantiene la lógica de pantallas y transiciones entre menú, garaje, carrera, resultados y progreso.
- La limpieza de recursos se reforzó para evitar polling en segundo plano y mantener la carrera activa destruida al abandonar una pantalla.

### Sistema de progresión y economía
- La economía, el monedero, recompensas, misión y campeonato siguen operando sobre datos persistidos localmente y con idempotencia de recompensas.
- No se añadieron cambios de backend innecesarios; el flujo sigue validado en lógica y persistencia local.

### Calidad gráfica
- `frontend/src/game/QualityProfiles.js` sirve como fuente central del perfil de calidad Bajo/Medio/Alto.
- Los cambios se aplican al renderer activo (pixel ratio, tone mapping, sombras y detalle). Se preserva la identidad visual de cada vehículo y circuito.

### Audio
- `frontend/src/game/AudioManager.js` centraliza Web Audio API, música de menú/carrera, motor, nitro, colisiones, saltos y recursos de audio.
- Los controles de volumen, silencio y persistencia están conectados con la UI.

## 2. Simulación y backend

### C++17 y comparación secuencial/OpenMP
- El backend simula movimiento y colisiones con una referencia secuencial; OpenMP reutiliza el mismo estado determinista con paralelización en la actualización y comparación de colisiones.
- El proyecto sigue validado en Release y con CTest.

### MPI y clúster Docker
- La infraestructura en `infrastructure/mpi-cluster/` define un conjunto de tres nodos con OpenMPI y SSH para validación distribuida.
- El entorno se validó con `node1`, `node2` y `node3` distribuyendo ranks reales.
- La validación fue ejecutada sobre la arquitectura de Docker del repositorio y no sobre benchmarks falsos ni inventados.

## 3. Estructura clave del repositorio

- `frontend/` — juego, rendering, progresión, audio, UI, validación Node.
- `backend/` — motor C++, validación secuencial/OpenMP/MPI, CTest.
- `infrastructure/mpi-cluster/` — despliegue distribuido de OpenMPI.
- `docs/` — documentación de fase, arquitectura, pruebas y evidencias de rendimiento.

## 4. Estado funcional final

| Componente | Estado |
|---|---|
| Menús y navegación | COMPLETADO Y PROBADO (lógica y flujo principal) |
| Vehículos y garage | COMPLETADO Y PROBADO |
| Circuitos y físicas | IMPLEMENTADO Y VALIDADO EN LÓGICA |
| Economía y Progresión | COMPLETADO Y PROBADO |
| Desafíos, misiones y campeonato | COMPLETADO Y PROBADO |
| Audio | IMPLEMENTADO Y PROBADO EN LÓGICA |
| Render y calidad gráfica | COMPLETADO Y PROBADO EN CONFIGURACIÓN RENDER |
| OpenMP | COMPLETADO Y PROBADO |
| MPI distribuido | COMPLETADO Y PROBADO EN CLÚSTER DOCKER |
| Validación visual real en navegador | PENDIENTE |

## 5. Limitaciones destacadas

- No se dispone de navegador o automatización visual en esta sesión, por lo que la validación visual y auditiva real queda pendiente fuera del entorno actual.
- El gameplay en 3D y la experiencia auditiva no puede declararse “completamente validada en navegador” sin una ejecución real sobre un navegador con audio.
- Los beneficios MPI son medibles, pero la comunicación entre nodos sigue imponiendo una sobrecarga relevante en cargas pequeñas.

## 6. Conclusión

La Fase 7 queda consolidada como una entrega académica funcional y verificable en lógica, build, pruebas automatizadas y validación distribuida real. La parte no cubierta en esta sesión es la comprobación visual y auditiva final en navegador, que debe hacerse manualmente en el equipo del usuario con la guía correspondiente.
