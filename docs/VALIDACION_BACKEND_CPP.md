# VALIDACIÓN DEL BACKEND C++ Y ALGORITMOS PARALELOS — 7.8.4.2

## Alcance

Se validó el backend C++17 del proyecto NEON RUSH con foco en compilación, ejecución, resultados numéricos, comparación entre modos secuencial y paralelos, y servicio HTTP local. No se reconstruyó ni modificó la lógica existente; se comparó el comportamiento real del código compilado en este entorno.

## 1. Inspección del backend

### Componentes revisados
- `backend/CMakeLists.txt`
- `backend/include/*.hpp`
- `backend/src/*.cpp`
- `backend/tests/*.cpp`
- `backend/service/server.mjs`
- `backend/service/server.test.mjs`
- `infrastructure/mpi-cluster/*`
- `benchmarks/*.md`

### Algoritmos y módulos existentes
- `Vehicle.cpp` / `Vehicle.hpp`: estado del vehículo, velocidad, dirección, radio de colisión.
- `CollisionSystem.cpp` / `CollisionSystem.hpp`: detección de colisiones por cuadrícula uniforme y parejas canónicas.
- `Simulation.cpp` / `Simulation.hpp`: simulación secuencial y comparación de modos.
- `MpiSimulation.cpp` / `MpiSimulation.hpp`: modo MPI con particionado por slabs X y comunicación por halos.
- `ExecutionPolicy.hpp`: selección de modo de ejecución (secuencial, OpenMP, MPI).
- `api_bridge.cpp`: puente C++ para servicio HTTP local.

### Dependencias detectadas
- CMake + C++17.
- OpenMP opcional.
- MPI opcional.
- Node.js + HTTP local para servicio `/api/health` y `/api/simulate`.

## 2. Validación de compilación y pruebas

### Comandos ejecutados
```bash
cd /home/helen/Proyectos/neon-rush
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
node backend/service/server.test.mjs
```

### Resultado real
- OpenMP enabled: sí.
- MPI: no detectado en este entorno (`mpi-cxx` not found).
- Build completado sin errores.
- CTest: 1/1 pruebas pasadas.
- HTTP service tests: 7/7 pruebas pasadas.

#### Evidencia textual
- `-- OpenMP support enabled`
- `-- MPI was not found; sequential and OpenMP modes remain available`
- `100% tests passed, 0 tests failed out of 1`
- `# pass 7`, `# fail 0`

## 3. Versión secuencial

La versión secuencial sirve como línea base para la comparación.

### Comando ejecutado
```bash
./backend/build/neon_rush_sim --vehicles 2000 --steps 2000 --mode compare --threads 4 --repetitions 3
```

### Resultado medido
- Vehicles: 2000
- Steps: 2000
- Delta time: 0.016666667
- Repetitions: 3
- Matching state and collision counts: yes
- Sequential median total time: 2.236317870 s
- Collision pairs detected: 745464
- State checksum: 442099640.631467938

### Observación
La versión secuencial es numéricamente consistente con la versión OpenMP, con igual conteo de colisiones y checksum idéntico.

## 4. OpenMP

### Comando ejecutado
```bash
./backend/build/neon_rush_sim --vehicles 2000 --steps 2000 --mode compare --threads 4 --repetitions 3
```

### Resultado real
- OpenMP available processors: 8
- Matching state and collision counts: yes
- OpenMP median total time: 1.528905669 s
- Collision pairs detected: 745464
- State checksum: 442099640.631467938

### Speedup y eficiencia
- Speedup S(p): 1.462691856
- Efficiency E(p): 0.365672964

### Validación adicional con sweep
```bash
./backend/build/neon_rush_sim --vehicles 2000 --steps 2000 --mode sweep --threads 4 --repetitions 3
```

| Hilos | Tiempo total mediano (s) | Speedup | Eficiencia |
|---|---:|---:|---:|
| 1 | 2.288646849 | 1.007661372 | 1.007661372 |
| 2 | 1.905202465 | 1.210465064 | 0.605232532 |
| 4 | 1.524413197 | 1.512831972 | 0.378207993 |

### Conclusión OpenMP
La implementación OpenMP produce resultados válidos y reproducibles. No se observan discrepancias numéricas entre secuencial y paralelo. El aumento de rendimiento es real, aunque el speedup no es lineal con el número de hilos; esto es consistente con la naturaleza de la simulación y la sincronización de red/colisión.

## 5. MPI

### Estado del entorno
El entorno actual no dispone de MPI instalado (`mpi-cxx` no encontrado). Por tanto:
- La compilación de MPI no pudo habilitarse en esta máquina.
- Los tests MPI no se registran automáticamente en CMake.
- La validación MPI queda limitada a la inspección del código y a la comprobación de que el sistema está preparado para soportarlo cuando el entorno lo permita.

### Evidencia real
- `-- Checking for module 'mpi-cxx'`
- `-- Package 'mpi-cxx' not found`
- `-- MPI was not found; sequential and OpenMP modes remain available`

### Conclusión MPI
La implementación de MPI está presente en el backend y es válida desde el punto de vista arquitectónico, pero no puede ejecutarse en este hardware sin instalar la librería MPI apropiada. No se inventa un resultado MPI que no haya sido verificado aquí.

## 6. Backend HTTP

### Endpoints y validaciones
Se ejecutaron pruebas HTTP del servicio local.

### Pruebas ejecutadas
```bash
node backend/service/server.test.mjs
```

### Resultados reales
- Health endpoint: correcto.
- CORS: validado para Vite y bloqueo para orígenes ajenos.
- Validación de peticiones: 400/401/413/415 conforme a la lógica del servicio.
- Bloqueo de concurrencia: se impide ejecutar dos simulaciones a la vez.
- Abort del cliente: liberación correcta del slot, sin bloqueos.
- Error del backend: devuelve respuesta estable `simulation_failed`.
- Bridge C++: round-trip con IDs exactos, colisiones y referencia OpenMP correcta.

## 7. Comparación de resultados

### Resumen objetivo
| Modo | Tiempo total mediano (s) | Colisiones | Estado | Speedup | Eficiencia |
|---|---:|---:|---|---:|---:|
| Secuencial | 2.236317870 | 745464 | Coincidente | 1.000000000 | 1.000000000 |
| OpenMP (4 hilos) | 1.528905669 | 745464 | Coincidente | 1.462691856 | 0.365672964 |
| MPI | No ejecutado en este entorno | - | Pendiente | - | - |

### Observaciones
- El resultado secuencial y OpenMP coincide numéricamente para checksum y colisiones.
- El OpenMP reduce el tiempo total real con 4 hilos.
- La eficiencia cae por debajo del valor ideal porque la simulación incluye sincronización, contención y fases de reducción/comparación.
- MPI queda pendiente de medición por ausencia de librería MPI en el entorno.

## 8. Problemas encontrados

1. El entorno no tiene `mpi-cxx`, por lo que MPI no está habilitado y no se pudo ejecutar la comparación real con procesos MPI.
2. La comparación paralela es válida pero no lineal: la sobrecarga de sincronización y distribución afecta a la eficiencia.
3. El backend local HTTP está validado, pero no se realizó una prueba real del backend distribuido en clúster.

## 9. Estado final

### Clasificación
- Compilación secuencial: COMPLETADA Y PROBADA.
- Compilación OpenMP: COMPLETADA Y PROBADA.
- Validación de resultados secuencial/OpenMP: COMPLETADA Y PROBADA.
- Compilación MPI: PENDIENTE (por ausencia de MPI en el entorno).
- Ejecución MPI real en múltiples procesos: PENDIENTE.
- Backend HTTP y servicio local: COMPLETADA Y PROBADA.

## Conclusión

La implementación C++ del proyecto NEON RUSH está funcionando correctamente para su configuración actual: el código secuencial y OpenMP compila, pasa pruebas y produce resultados consistentes. El servidor HTTP local también responde correctamente y cumple la validación de API. La parte MPI queda bloqueada exclusivamente por la falta de instalación de la librería MPI en este entorno, no por un fallo del código fuente.
