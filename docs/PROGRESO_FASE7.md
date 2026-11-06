# Progreso de Fase 7

> Estado actual: la refactorización 2D posterior reemplaza el render OpenGL y
> los circuitos elevados que se describen en las notas históricas de esta fase.
> Para la implementación vigente, consulta `CIRCUITOS.md`.

## Auditoría inicial

- Ruta localizada: `/home/roger/proyecto`.
- La carpeta contiene NEON RUSH y tests; no es repositorio Git (no existe
  `.git`), por lo que no se pudo consultar rama ni `git status`.
- La implementación real es Python/Pygame con módulos de física,
  circuito, IA, perfil, tienda, render y MPI Python. No hay Three.js/Vite ni
  código C++17/OpenMP en esta carpeta.
- Línea base antes de los cambios: 52 pruebas `unittest`, todas aprobadas.
- Validación final de esta iteración: 63 pruebas aprobadas y `compileall` sin
  errores.

## Entrega de esta iteración

Los siguientes puntos describen la entrega anterior a la refactorización 2D;
los elementos de geometría elevada, salto y obstáculo fueron retirados:

- Circuitos `neon_city`, `cyber_desert` y `plasma_circuit` con elevación,
  peralte, rampas, barreras y obstáculos movidos por tiempo de simulación.
- Pendientes afectan velocidad; el vehículo reporta pitch/peralte y ejecuta
  saltos con aterrizaje y recuperación.
- La IA anticipa obstáculos; las tres pistas se completan en simulación.
- Perfil versionado, escritura local atómica, transacciones NC, recompensas de
  carrera idempotentes, compra validada, XP, estadísticas y récords.
- Misiones diarias UTC y NEON CUP persistente; la pantalla DESAFÍOS se conecta al
  perfil y a resultados reales.

## Clasificación histórica de la entrega anterior

- **COMPLETADA Y PROBADA (en simulación/headless):** economía básica NC,
  idempotencia de carrera, compras de los tres cosméticos existentes, pendiente,
  bancos, rampas/saltos, colisión/cooldown de obstáculos, misiones de resultado,
  puntuación NEON CUP, persistencia y conducción IA de una vuelta por pista.
- **IMPLEMENTADA PERO NO PROBADA VISUALMENTE:** representación OpenGL de
  superficies bancadas, obstáculos, rampas y flash de colisión.
- **PARCIAL:** categorías avanzadas de tienda, bus general de eventos, misiones
  en tiempo real, estadísticas exhaustivas, desbloqueos por producto y flujo de
  copa que fuerce el orden.
- **PENDIENTE:** conversión/implementación Three.js/Vite (no es el stack de esta
  carpeta), prueba visual con GPU/ventana, perfiles de rendimiento medidos,
  audio contextual de colisiones/saltos y pruebas reales MPI/C++/OpenMP.

## Próximo paso exacto

Ejecutar la suite completa después de los cambios y la compilación Python;
inspeccionar su salida, registrar resultados y limitaciones en
`docs/PRUEBAS_FINALES.md`. No marcar como completado aquello que no se haya
probado en una sesión gráfica real.
