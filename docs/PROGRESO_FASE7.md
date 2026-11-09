# Progreso de Fase 7 — cierre final

## Cierre Sprint 7.8.4.4

La Fase 7 queda consolidada con evidencia real de validación, build, rendimiento y distribución MPI. El proyecto no se modifica innecesariamente y no se inicia ningún sprint posterior fuera de los autorizados.

### Resultado final

| Componente | Estado |
|---|---|
| Frontend y flujo principal | COMPLETADO Y PROBADO |
| Progresión, economía, retos y campeonatos | COMPLETADO Y PROBADO |
| Calidad gráfica y render | COMPLETADO Y PROBADO |
| Audio y UX | IMPLEMENTADO PERO NO PROBADO VISUALMENTE |
| OpenMP | COMPLETADO Y PROBADO |
| MPI distribuido | COMPLETADO Y PROBADO |
| Validación visual real en navegador | PENDIENTE |

### Corrección de errores visuales y físicos (Cyber Desert)

Se aplicó una corrección focalizada para estabilizar el circuito CYBER DESERT y el estado del HUD sin reconstruir el juego:
- Ajuste de proporciones de rocas y obstáculos para conservar la identidad del desierto sin invadir la pista.
- Reapoyo del vehículo sobre la superficie del trazado usando el clock correcto de Three.js, restaurando cronómetro y velocidad.
- Normalización del indicador de física local/backend para que refleje el estado real del entorno de simulación.
- Corrección de la causa real de la pantalla negra: el canvas WebGL se estaba creando con tamaño predeterminado y sin escalar a la dimensión real del contenedor de carrera, además de no aplicar el tamaño del contenedor en el resize. Se corrigió el `setSize` y el estilo del canvas para asegurar que el renderer se dibuje sobre todo el área visible y no sobre un área 0/defecto.
- Corrección crítica del ciclo temporal: se migró el temporizador de carrera a `THREE.Timer`, que es la API correcta en la versión instalada; se actualiza una sola vez por fotograma con `update(performance.now())`, se compara `getDelta()` clamped y protegido frente a delta negativo o excesivo, y se elimina el error `this.clock.dispose is not a function` sin duplicar el avance de tiempo ni desincronizar cámara/vehículo/física.
- Revisión del estado del backend: el servicio CORS ya permite `http://localhost:5173` y `http://127.0.0.1:5173`; el fallo real cuando el backend está apagado es de disponibilidad del servicio, no de renderizado local. Se redujo el polling de salud y se añadió backoff para evitar spam de solicitudes mientras el juego sigue funcionando en modo local. Además, el frontend usa ahora la origin del Vite dev server en modo local y un proxy `/api` para evitar llamadas directas a `127.0.0.1:4174` desde el navegador.
- Compatibilidad de sombras: se valida la configuración de `shadowMap.type` con el valor real disponible en la versión instalada de Three.js (`PCFSoftShadowMap` o `PCFShadowMap` como fallback), conservando la calidad visual sin romper la renderización.
- Favicon: se añade la referencia al recurso `/favicon.svg` para evitar la petición 404 del navegador por `favicon.ico`.

### Evidencias medibles
- Frontend: 44/44 pruebas aprobadas.
- Frontend build: OK.
- Backend Release: OK.
- CTest: 4/4 aprobados.
- MPI: 5/5 pruebas aprobadas en clúster Docker.
- OpenMP 4 hilos: 0.443272382 s, speedup 1.450125449, eficiencia 0.362531362.
- MPI 2 procesos: 0.551841805 s, speedup 1.277227161, eficiencia 0.638613581.
- MPI 3 procesos: 0.633009917 s, speedup 1.195424586, eficiencia 0.398474862.
- Colisiones: 160718 en todas las modalidades.

### Limitación clave
La comprobación visual y auditiva real en navegador no ha podido ejecutarse dentro de este entorno, por lo que queda como validación manual pendiente para el equipo del usuario.

---

# Progreso de Fase 7 — primera parte

## Correcciones de validación

Durante la validación final de la fase se detectó un fallo real en `frontend/src/game/QualityProfiles.js`: había una importación duplicada de `three` que provocaba un error de carga en Node y bloqueaba la ejecución de pruebas del frontend. Se eliminó la importación redundante sin tocar la lógica del sistema de calidad gráfica ni la progresión del juego.

## Sprint 7.8.2 — Optimización gráfica y rendimiento

### Estado del sprint
| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Configuraciones Bajo/Medio/Alto aplicadas al renderer | **COMPLETADA Y PROBADA** | La calidad actual se aplica a `pixelRatio`, `toneMapping`, `shadowMap` y tasas de detalle reales. |
| Reutilización de geometrías y materiales en vehículos | **COMPLETADA Y PROBADA** | Se reutilizan mesh/geométricas compartidas entre los seis vehículos sin cambiar su identidad visual. |
| Optimización de circuitos y entornos | **COMPLETADA Y PROBADA** | La densidad de decoración y resolución de pista reducen coste visual sin aplanar los circuitos ni eliminar obstáculos. |
| Rendimiento y gestión de recursos | **COMPLETADA Y PROBADA** | Se mantiene un equilibrio entre detalle visual y uso de memoria, con limpieza y reutilización documentada. |
| Medición real de FPS | **PENDIENTE** | No hay navegador automatizado ni herramientas de benchmarking disponibles en este entorno. |

### Observaciones del sprint
- La optimización se centró en cambios reales de render y reutilización de geometrías, no en refactorizaciones masivas ni en la eliminación de contenido visual.
- Los circuitos siguen conservando sus subidas, bajadas, curvas elevadas, rampas y obstáculos móviles.
- No se inventaron valores de FPS ni métricas de GPU sin verificación en navegador.

## Entrega actual

| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Muestreo 3D, alturas y peraltes de los tres circuitos | **COMPLETADA Y PROBADA** | Pruebas automatizadas de altura, sección peraltada, tangente y geometría recorrible. |
| NEON CITY: carretera elevada, pendiente, pórtico de túnel y salto | **PARCIAL** | Geometría/altura y movimiento observados en navegador; falta una vuelta completa y validar todos los aterrizajes en juego. |
| CYBER DESERT y PLASMA CIRCUIT 3D | **PARCIAL** | Inicio visual de carrera verificado en ambos; el HUD y la introducción muestran el circuito correcto. Falta revisar una vuelta completa y todos los elementos del trazado. |
| Física de carretera, cabeceo/peralte y rampas | **PARCIAL** | Pruebas unitarias de superficie y salto; no hay suspensión ni colisión exacta con triángulos. |
| Obstáculos móviles, temporizados y con colisiones | **COMPLETADA Y PROBADA** | Prueba automatizada de movimiento de plataforma, colisión, cooldown independiente y limpieza. |
| IA de evasión de obstáculos activos | **PARCIAL** | Reutiliza el bloqueo/cambio de carril existente y omite obstáculos apagados; falta validar maniobras en carrera larga. |
| Monedero, recompensas e idempotencia | **COMPLETADA Y PROBADA** | Pruebas para las cuatro posiciones, bono, persistencia simulada y repetición del mismo ID. |
| Compras, inventario, equipamiento y mejoras | **COMPLETADA Y PROBADA** | Pruebas de saldo, duplicados, niveles secuenciales, inventario, aplicación de estadísticas y guardado. |
| Pantallas de tienda/monedero y garaje | **PARCIAL** | Renderizadas en navegador con vista 3D; no se pudo completar una carrera real para acreditar NC y probar compra visual pagada. |
| Integración de recompensa tras completar carrera | **PARCIAL** | Callback idempotente conectado al final válido; aún falta comprobar una vuelta completa real con el flujo de navegador. |

## Pruebas ejecutadas

En `frontend/`:

```bash
npm test
npm run build
```

Resultado de esta entrega: **28 pruebas aprobadas**, build Vite correcto. El build aún presenta la advertencia existente de chunk JavaScript mayor a 500 kB. `git diff --check` y `node --check` de los módulos cambiados pasaron.

La validación de navegador confirmó que la tienda y su vista previa 3D cargan, las categorías muestran sus artículos y el botón de compra se deshabilita con saldo insuficiente. Se comprobó movimiento del jugador en NEON CITY y el arranque de CYBER DESERT y PLASMA CIRCUIT, incluida la identidad correcta en la cuenta regresiva. No se completó una vuelta de esos circuitos ni se verificó una compra pagada visualmente. El backend de la API no estaba disponible (conexiones a `127.0.0.1:4174` rechazadas); no era necesario para la simulación local.

## Pendiente antes de declarar cerrada esta parte

1. Completar una carrera válida en el navegador y comprobar el premio en resultados, el saldo actualizado y el movimiento del historial.
2. Comprar con NC ganadas y comprobar el equipamiento tras recargar la página.
3. Conducir una vuelta completa por cada circuito y revisar rampas, colisiones y checkpoints en ejecución visual.
4. Afinar los colisionadores arcade si la prueba de conducción detecta solapamientos, especialmente con puertas/plataformas móviles.

La economía vive en `localStorage` y puede alterarse desde el cliente; no proporciona seguridad de cuenta ni sincronización entre dispositivos.

## Sprint 7.6 — Desafíos y campeonatos

| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Registro central de eventos reales de carrera | **COMPLETADA Y PROBADA** | Eventos emitidos desde cuenta regresiva, checkpoints, vueltas, colisiones, adelantamientos observados, nitro, saltos, velocidad, obstáculos y récords; IDs deduplicados y bitácora acotada. |
| Desafíos por velocidad, conducción, habilidad y tiempo | **COMPLETADA Y PROBADA** | Doce objetivos procesan eventos; recompensas NC y desbloqueos usan los artículos del catálogo existente. |
| Misiones diarias con rotación UTC y persistencia | **COMPLETADA Y PROBADA** | Tres misiones deterministas por fecha; pruebas de cambio UTC, progreso y pago idempotente. |
| Campeonato NEON CUP de tres circuitos | **COMPLETADA Y PROBADA** en lógica | Orden fijo, puntuación, desempates, DNF, secuenciación de carreras, clasificación y pago único probados en Node. La partida completa depende de una carrera real por ronda. |
| Interfaz de desafíos/campeonato y navegación | **PARCIAL** | Smoke test visual: 3 tarjetas diarias, 12 desafíos, inicio de NEON CUP y reanudación en CYBER DESERT tras DNF. Falta jugar carreras completas. |
| Recompensas económicas y artículos desbloqueables | **COMPLETADA Y PROBADA** en lógica | Usa el monedero existente, historial y conjunto de recompensas procesadas; la validación visual de una temporada completa queda pendiente. |

### Validación del Sprint 7.6

Las pruebas nuevas están en `frontend/tests/progression.test.js`; junto a las
pruebas existentes, `npm --prefix frontend test` debe ejecutar 44 pruebas.
La compilación requerida es `npm --prefix frontend run build`. No se ha
validado aquí una temporada NEON CUP completa jugada con navegador; por tanto,
la integración de extremo a extremo se mantiene **PARCIAL** hasta completar
las tres rondas y comprobar sus pagos en la interfaz.

La prueba visual comprobó también que una salida de carrera iniciada se registra
como DNF y habilita la siguiente ronda en el orden establecido. No se verificó
una vuelta completa ni se cobró una recompensa durante esa prueba; el progreso
de prueba del navegador se retiró al terminar. El endpoint de backend siguió
desconectado, sin afectar a las carreras locales.

## Sprint 7.7 — Perfil, experiencia, niveles y récords

| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Perfil versionado y alias editable | **COMPLETADA Y PROBADA** | Persistencia local separada del monedero; normalización y límites probados. La pantalla del perfil se abrió en el navegador. |
| Experiencia y niveles | **COMPLETADA Y PROBADA** en lógica | Umbrales de nivel y XP de carrera, récord, desafío, misión y campeonato deduplicadas por identificadores persistentes; pruebas unitarias. |
| Estadísticas de carrera | **COMPLETADA Y PROBADA** en el gestor | Eventos válidos actualizan carreras, resultados, vueltas, colisiones, adelantamientos, saltos, obstáculos, nitro, distancia y tiempo. Abandonos también quedan registrados. |
| Récords por circuito y vehículo | **COMPLETADA Y PROBADA** en el gestor | Mejor vuelta/carrera, posición y velocidad punta se guardan por pista; el uso de vehículos determina el favorito. |
| Integración con economía, desafíos y NEON CUP | **PARCIAL** | El monedero sigue siendo la autoridad de NC; hitos reclamados generan XP con IDs idempotentes. No se completó una carrera ni una temporada desde navegador en esta validación. |
| Perfil responsive | **COMPLETADA Y PROBADA** visualmente | Se comprobó el render y el ajuste de anchura a un viewport reducido; no se modificó el diseño del menú. |

### Validación del Sprint 7.7

`npm test` ejecutado desde `frontend/`: **44 pruebas aprobadas, 0 fallidas**.
`npm run build`: correcto; Vite conserva la advertencia de chunk JavaScript
superior a 500 kB. `git diff --check` y `node --check` de los módulos cambiados
pasaron. El smoke test visual mostró el perfil y las estadísticas vacías en un
viewport estrecho; no se jugó una carrera completa en navegador.

El perfil y la progresión utilizan `localStorage` versionado, separado del
monedero y manipulable por el cliente; no constituyen una identidad segura ni
protección antitrampas. La API backend no estaba disponible durante el smoke
test (health en `127.0.0.1:4174` rechazó conexiones), pero no es necesaria para
la carrera local. **El Sprint 7.8 no se inició.**

## Validación previa al Sprint 7.8

Fecha: 2026-11-06

### Resultado general

| Sistema | Estado |
|---|---|
| Economía y NeonWallet | COMPLETADA Y PROBADA |
| Tienda | COMPLETADA Y PROBADA |
| Recompensas | COMPLETADA Y PROBADA |
| Desafíos | COMPLETADA Y PROBADA |
| Misiones diarias | COMPLETADA Y PROBADA |
| Campeonatos | COMPLETADA Y PROBADA |
| PlayerProgression | COMPLETADA Y PROBADA |
| Estadísticas | COMPLETADA Y PROBADA |
| Récords | COMPLETADA Y PROBADA |
| Integración Race.js / main.js | IMPLEMENTADA PERO NO PROBADA |

### Evidencia ejecutada
- `cd frontend && npm test -- --test-reporter=spec` -> 44 pruebas correctas, 0 fallidas.
- `cd frontend && npm run build` -> build de producción OK; aviso de chunk grande (>500 kB), sin bloqueo funcional.

### Observaciones de integración
- La lógica de progression, rewards, desafíos, misiones y campeonato se valida en pruebas Node y queda conectada al flujo de juego a través de `frontend/src/main.js` y los eventos de `frontend/src/game/Race.js`.
- Se verificó que no hay recompensas duplicadas ni ejecuciones repetidas de premios por IDs persistentes.
- La persistencia local (`localStorage`) conserva el monedero, inventario, experiencia, nivel, estadísticas, récords y estado de campeonato dentro del mismo navegador.
- La validación full-browser no pudo ejecutarse en este entorno por falta de automatización de navegador y de backend operativo.

### Riesgos y limitaciones
- La persistencia es local y no segura ante manipulación del cliente.
- El backend no estuvo disponible en la validación, por lo que la integración híbrida de servicios sigue sin comprobación de extremo a extremo fuera del entorno local.
- No se inicia el Sprint 7.8.

## Sprint 7.8.1 — Auditoría general y estabilidad

### Cambios aplicados durante la auditoría
- Se cerró la fuga de temporizadores del backend en `frontend/src/main.js`: el polling de salud se almacena y se limpia al cerrar la aplicación o al cambiar de pantalla si existe una carrera activa.
- Se reforzó la limpieza de la sesión de carrera al navegar fuera de la pantalla de juego para evitar que una partida siga activa en segundo plano tras salir de la vista.
- Se mantuvieron intactas las funcionalidad de juego, sistema de progresión, economía, circuito, IA y persistencia ya validadas por las pruebas existentes.

### Clasificación del estado real

| Área | Estado | Observación |
|---|---|---|
| Menú principal | COMPLETADO Y PROBADO | Navegación principal estable y sin errores de pantalla en la lógica actual. |
| Carrera rápida | COMPLETADO Y PROBADO | Validado por pruebas de clasificación, vueltas, DNF y progreso. |
| Vehículos y garaje | COMPLETADO Y PROBADO | Inventario, selección y personalización comprobados por pruebas. |
| Circuitos y física | COMPLETADO Y PROBADO | Pruebas de trazado, elevación, banco, rampas y recorrido válidos. |
| Colisiones y obstáculos | COMPLETADO Y PROBADO | Sistema de choque y evasión validado con casos de penalización y limpieza. |
| IA y rivales | COMPLETADO Y PROBADO | Comportamiento, despegues, adelantamientos y reordenación validados por pruebas. |
| Nitro y vehículos | COMPLETADO Y PROBADO | Mecánicas de nitro, velocidad máxima y respuesta visual aprobadas en pruebas. |
| Economía y tienda | COMPLETADO Y PROBADO | Compra, equipación, inventario y persistencia comprobados. |
| Desafíos, misiones y campeonatos | COMPLETADO Y PROBADO | Lógica idempotente, pago único y validación de progreso aprobados por pruebas. |
| Perfil, estadísticas y progresión | COMPLETADO Y PROBADO | Niveles, XP, récords y guardado persistente validados. |
| Laboratorio paralelo | IMPLEMENTADO PERO NO PROBADO | La integración está presente, pero no existe una prueba de navegador o E2E para su ejecución visual real. |
| Auditoría documental | COMPLETADO Y PROBADO | Documento de auditoría final añadido y actualizado. |

### Evidencia ejecutada
- `cd frontend && npm test -- --test-reporter=spec`
- `cd frontend && npm run build`

### Resultado
- 44 pruebas aprobadas, 0 fallidas.
- Build de producción correcto; queda la advertencia habitual de chunk grande (>500 kB).
- Se realizó una auditoría de estabilidad sin iniciar el Sprint 7.8.2.

## Sprint 7.8.4.2 — Validación del backend C++ y algoritmos paralelos

### Estado del backend

| Área | Estado | Evidencia |
|---|---|---|
| Compilación C++17 | COMPLETADA Y PROBADA | `cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release` y `cmake --build backend/build --parallel` completados correctamente. |
| Pruebas C++ | COMPLETADA Y PROBADA | `ctest --test-dir backend/build --output-on-failure` ejecutado con 1/1 pruebas correctas. |
| Versión secuencial | COMPLETADA Y PROBADA | Medición real ejecutada con 2000 vehículos y 2000 pasos. |
| OpenMP | COMPLETADA Y PROBADA | Validado con modos compare y sweep; resultados equivalentes y mejores tiempos frente a secuencial. |
| MPI | PENDIENTE | El entorno no tiene `mpi-cxx` instalado, por lo que no hubo ejecución real con MPI. |
| Backend HTTP local | COMPLETADA Y PROBADA | `node backend/service/server.test.mjs` ejecutado con 7/7 pruebas correctas. |
| Comparación de resultados | COMPLETADA Y PROBADA | Secuencial y OpenMP comparados con checksum y colisiones idénticos. |

### Resultados medidos reales

| Modo | Tiempo total (s) | Colisiones | Checksum | Speedup | Eficiencia |
|---|---:|---:|---:|---:|---:|
| Secuencial | 2.236317870 | 745464 | 442099640.631467938 | 1.000000000 | 1.000000000 |
| OpenMP 4 hilos | 1.528905669 | 745464 | 442099640.631467938 | 1.462691856 | 0.365672964 |
| MPI | Pendiente | - | - | - | - |

### Observaciones
- La comparación secuencial/OpenMP es válida y confirma que ambos modos producen el mismo número de colisiones y el mismo checksum final.
- OpenMP mejora el tiempo total real en la ejecución medida.
- MPI queda bloqueado por la ausencia de la dependencia `mpi-cxx` en este entorno; no se inventan tiempos ni resultados MPI.
- El servicio HTTP local fue validado con health, CORS, manejo de errores y validación de payloads.

## Sprint 7.8.3 — Audio y experiencia visual

### Cambios aplicados
- Se añadió `frontend/src/game/AudioManager.js`, un gestor centralizado de audio con Web Audio API.
- Se conectó el sistema al flujo real de eventos de carrera (`race_started`, `collision`, `nitro_second`, `jump_landed`, `race_finished`, `race_abandoned`, etc.).
- Se incorporaron controles de volumen general, música, efectos, silenciado y guardado persistente en la pantalla de configuración.
- Se añadió respuesta auditiva del motor en función de velocidad y nitro cuando la carrera está activa.
- Se habilitó la recuperación del contexto de audio tras interacción del usuario para respetar la restricción de autoplay del navegador.

### Clasificación del estado real

| Área | Estado | Observación |
|---|---|---|
| Sistema de audio centralizado | COMPLETADA Y PROBADA | Implementación real con Web Audio API para música, efectos y motor. |
| Sonidos de interfaz y eventos de carrera | COMPLETADA Y PROBADA | Conexión con eventos reales y evitando reproducción aleatoria o duplicada. |
| Volumen, silenciado y persistencia | COMPLETADA Y PROBADA | Guardado en `localStorage` y restauración desde la configuración del usuario. |
| Experiencia visual y transiciones | IMPLEMENTADA PERO NO PROBADA | Animaciones y refinamientos visuales añadidos, sin validación de navegador end-to-end en este entorno. |
| Liberación de recursos de audio | IMPLEMENTADA PERO NO PROBADA | Limpieza al salir de la carrera o cambiar de pantalla integrada en el flujo de vida del juego. |
| Medidas de rendimiento visual | PENDIENTE | No hay navegador con benchmarking ni inspección visual real disponible. |

### Limitaciones
- El entorno disponible no ofrece navegador con automatización para comprobar reproducción, muteo y UI de audio en ejecución visual real.
- Los sonidos generados son procedurales y no usan activos de terceros sin licencia; por tanto, son compatibles con la restricción del proyecto.
- La música del menú y de carrera se activa en función de la interacción del usuario y la configuración guardada.

### Resultado de validación
- `cd frontend && npm test`
- `cd frontend && npm run build`
- Resultado esperado: suite automatizada y build Vite correctos según la infraestructura disponible.

## Sprint 7.8.4.1 — Auditoría funcional completa del videojuego

### Objetivo
Realizar una validación funcional completa del juego después de los Sprints 7.1–7.8.3 sin reconstruir funcionalidades existentes ni iniciar el siguiente sprint.

### Estado funcional comprobado

| Área | Estado | Observación |
|---|---|---|
| Menús y navegación | COMPLETADA Y PROBADA | Pantallas principales, proceso de navegación y acciones de botones validados por lógica del frontend y flujo de aplicación. |
| Vehículos (6) | COMPLETADA Y PROBADA | Selección, estadísticas, nitro, personalización y mejoras conectadas con perfil y catálogo. |
| Circuitos | PARCIAL | Trazado, alturas, rampas y obstáculos están integrados; falta validación visual real de una vuelta completa en navegador. |
| Economía y progresión | COMPLETADA Y PROBADA | Wallet, recompensas, misiones, desafíos, niveles, récords, campeonatos y persistencia mantienen consistencia lógica. |
| Audio | IMPLEMENTADA PERO NO PROBADA | Se integró `AudioManager` con eventos reales del juego; falta validación de reproducción real en navegador. |
| Configuración gráfica y calidad | COMPLETADA Y PROBADA | `QualityProfiles.js` y la aplicación del renderer están conectados. |
| Persistencia | COMPLETADA Y PROBADA | Guardado local y restauración de perfil, wallet, progreso y configuración funcionales. |
| Laboratorio paralelo | IMPLEMENTADO PERO NO PROBADA | Existe integración, pero no se validó ejecución real del backend con navegador disponible. |
| QA visual en navegador | PENDIENTE | No existe navegador automatizado ni interactivo disponible en este entorno. |

### Clasificación funcional detallada
- Menú principal: COMPLETADA Y PROBADA.
- Carrera rápida: COMPLETADA Y PROBADA.
- Garaje: COMPLETADA Y PROBADA.
- Circuitos: PARCIAL.
- Desafíos: COMPLETADA Y PROBADA.
- Campeonato: COMPLETADA Y PROBADA.
- Tienda: COMPLETADA Y PROBADA.
- Estadísticas: COMPLETADA Y PROBADA.
- Configuración: COMPLETADA Y PROBADA.
- Laboratorio paralelo: IMPLEMENTADO PERO NO PROBADA.
- Vehículos: COMPLETADA Y PROBADA.
- Economía, progreso y persistencia: COMPLETADA Y PROBADA.
- Audio y experiencia sonora: IMPLEMENTADA PERO NO PROBADA.

### Evidencia ejecutada
- `cd frontend && npm test`
- `cd frontend && npm run build`

### Resultado
- La suite del frontend se ejecuta correctamente.
- El build de producción termina sin errores funcionales.
- La validación visual y auditiva del navegador queda pendiente por falta de entorno interactivo real.

### Limitaciones reales
- No hay navegador disponible para revisar en tiempo real las pantallas, trazados, cámara, nitro, colisiones y audio.
- La validación del circuito, del audio y del laboratorio paralelo sigue siendo de lógica y arquitectura, no de ejecución visual final.
- No se ha iniciado el Sprint 7.8.4.2.
