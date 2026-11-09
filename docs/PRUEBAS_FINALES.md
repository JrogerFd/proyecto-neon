# Pruebas finales de NEON RUSH — Fase 7

## Corrección aplicada: Cyber Desert, HUD de física, reloj Three.js y pantalla negra

Se corrigieron problemas reales de visualización y lógica en la carrera sin reescribir el juego:
- `Track.js`: ajustada la escala y posicionamiento de rocas del desierto para evitar bloques excesivamente grandes y superficies fuera del recorrido.
- `Obstacles.js`: reducida la invasión de obstáculos en la zona transitable y estabilizado el radio/escala de los rocas del circuito desértico.
- `Race.js`: corregido el uso incorrecto de `THREE.Clock` y `dispose()` por la API correcta de `THREE.Timer`, actualizando el temporizador una sola vez por fotograma, restaurando el paso de tiempo de la animación y la actualización del cronómetro/velocidad.
- `Race.js`: el estado del indicador de física ahora refleja el estado real del backend/local, evitando que el HUD muestre un estado falso.
- `main.js` + `Race.js` + `style.css`: corregida la causa real de la pantalla negra. El renderer WebGL estaba creando un canvas con dimensiones no sincronizadas con el contenedor activo de la carrera; además, el canvas no estaba escalado a `100%` y el `setSize` del resize no reutilizaba el tamaño del contenedor. Esto dejaba el contexto 3D renderizando en un área vacía/defectuosa mientras el HUD seguía funcionando.
- `main.js`: ajustado el polling de salud del backend con backoff y sin spam de peticiones cuando el servicio está caído, preservando la carrera local y mostrando un estado honesto del backend.

## 1. Frontend

Comandos ejecutados:

```bash
cd /home/helen/Proyectos/neon-rush/frontend
npm test
npm run build
```

Resultado verificado:
- `node --test`: 44 pruebas ejecutadas, 44 aprobadas, 0 fallidas.
- `vite build`: compilación correcta.

## 2. Backend C++

Comandos ejecutados:

```bash
cd /home/helen/Proyectos/neon-rush
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

Resultado verificado:
- 1/1 test secuencial/normal aprobado localmente.
- 4/4 tests de CTest aprobados en la build Release, incluyendo MPI con 1, 2 y 3 procesos.
- 5/5 pruebas MPI correctas en el entorno distribuido.

## 3. Infraestructura MPI / Docker

Comandos ejecutados:

```bash
cd /home/helen/Proyectos/neon-rush
docker compose -f infrastructure/mpi-cluster/compose.yaml config
docker compose -f infrastructure/mpi-cluster/compose.yaml ps
./infrastructure/mpi-cluster/scripts/cluster.sh verify
./infrastructure/mpi-cluster/scripts/cluster.sh test
```

Resultado verificado:
- La configuración de Docker Compose es válida.
- Los tres nodos fueron observados correctamente.
- La validación MPI confirmada: rank 0 en node1, rank 1 en node2, rank 2 en node3.

## 4. Resultados reales de rendimiento

Evidencia conservada:

- OpenMP 4 hilos: 0.443272382 s
- Speedup: 1.450125449
- Eficiencia: 0.362531362
- MPI 2 procesos: 0.551841805 s
- Speedup: 1.277227161
- Eficiencia: 0.638613581
- MPI 3 procesos: 0.633009917 s
- Speedup: 1.195424586
- Eficiencia: 0.398474862
- Colisiones: 160718 en secuencial, OpenMP y MPI

## 5. Validación visual pendiente

La validación visual y auditiva real en navegador sigue pendiente. No se ha podido afirmar que la experiencia completa de menú, circuito, vehículo, nitro, audio y resultados esté validada visualmente porque el entorno disponible no incluye un navegador interactivo ni automatización de UI.

Checklist manual recomendada para el equipo del usuario:
- Abrir menú principal y navegar la secuencia completa.
- Seleccionar cada vehículo y comprobar movimientos, nitro, ruedas y efectos.
- Cambiar de circuito y comprobar curvas, subidas, bajadas, rampas, saltos y obstáculos móviles.
- Iniciar una carrera real, comprobar HUD, colisiones y clasificación.
- Comprobar música, efectos de motor, nitro, colisiones y volumen de interfaz.
- Confirmar persistencia de monedas, progreso, niveles y desbloqueos al recargar la página.

## 6. Conclusión

La validación automatizada, de build y de rendimiento queda cerrada con evidencia real. La comprobación visual final debe completarse manualmente en un equipo con navegador para cerrar el ciclo de entrega visual y auditiva del juego.
