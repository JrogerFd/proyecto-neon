# Optimización gráfica y rendimiento — Sprint 7.8.2

## Alcance
Este sprint reforzó la eficiencia del render, la reutilización de recursos, la reducción de draw calls y la calidad configurable sin alterar la identidad visual de los circuitos ni de los vehículos.

## Cambios realizados

### 1) Calidad de render aplicada de verdad
- Se centralizó la aplicación de la calidad visual con `applyRendererQuality()` en `frontend/src/game/QualityProfiles.js`.
- La configuración de `pixelRatio`, `toneMapping`, `shadowMap` y `exposure` se aplica al renderer real, no solo al perfil configurado.
- Se añadieron ajustes de perfil específicos para Bajo, Medio y Alto (`shadowMapSize`, `drawCallBudget`, `fogFar`, `toneMappingExposure`).

### 2) Reutilización de geometrías y materiales en vehículos
- En `frontend/src/game/Car.js` se introdujo reutilización de geometrías compartidas para neumáticos, radios, cubos y elementos repetidos.
- Esto reduce la presión de memoria al crear varios vehículos sin cambiar su apariencia visual ni sus diferencias de estilo.
- Se mantienen las diferencias entre modelos mediante variaciones en color, forma de cabin, alerón, rueda y luminarias.

### 3) Optimización de pistas y entorno
- En `frontend/src/game/Track.js` se redujo la resolución de malla de la pista y la densidad decorativa según el perfil gráfico.
- Se aplicaron cuotas más estrictas para bajos/medios/altos sin aplanar circuitos ni alterar pendientes, subidas, bajadas, rampas ni obstáculos móviles.
- La configuración de sombras del punto de luz principal ahora usa `shadowMapSize` por perfil y mantiene un rango de cámara de sombra ajustado al entorno.

### 4) Simplificación del render del garage y la carrera
- `frontend/src/game/GarageView.js` y `frontend/src/game/Race.js` ahora usan la misma pipeline centralizada de calidad de renderer, evitando divergencias entre escenas.
- Esto evita inconsistencias entre la vista del garaje y la carrera real.

## Resultados verificados

### Pruebas automatizadas
Se ejecutó:

```bash
cd frontend
npm test
npm run build
```

Resultado real:
- 44 pruebas correctas.
- 0 fallos.
- Build de producción en Vite correcto.

### Medición real de rendimiento
No se inventaron valores de FPS ni métricas de GPU.
El entorno disponible no incluye navegador automatizado ni herramientas de benchmarking de render en vivo, por lo que no fue posible medir FPS reales, draw calls de navegación ni uso de memoria GPU en ejecución.

## Limitaciones pendientes
- Falta validación real en navegador para inspeccionar frame time, FPS y draw calls en las escenas cargadas.
- La medición de GPU disponible requiere un entorno con acceso a DevTools o una automatización de navegador habilitada.
- La optimización gráfica se limitó a una reducción real de trabajo del render y a la reutilización de recursos; no se introdujo un refactor de arquitectura no necesario.

## Estado final
- Las configuraciones Bajo/Medio/Alto se aplican de forma real al renderer.
- Los seis vehículos conservan su identidad visual y se beneficia de geometrías reutilizadas.
- Los tres circuitos preservan sus elevaciones, rampas, curvas y obstáculos.
- El proyecto queda listo para continuar con el siguiente sprint sin haber iniciado el 7.8.3.
