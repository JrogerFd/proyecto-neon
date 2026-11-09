# Neon Rush

Neon Rush es un juego de carreras arcade 3D para navegador, con estética
neón. Incluye selección de vehículos y circuitos, garaje, carreras, rivales,
obstáculos, vueltas, clasificaciones, mejoras, economía, misiones, desafíos,
campeonatos y audio. El estado del jugador se guarda localmente en el
navegador.

El repositorio también contiene un motor de simulación C++17 independiente.
Puede ejecutar simulaciones secuenciales, con OpenMP o distribuidas con MPI.
Un servicio HTTP local en Node.js permite enviarle estados de vehículos; la
infraestructura Docker Compose proporciona un clúster MPI de tres
contenedores para desarrollo y validación.

## Arquitectura

```text
Navegador
  └── Frontend JavaScript + Three.js (Vite)
        ├── Escena 3D, carreras, UI, audio y progresión local
        └── Cliente HTTP opcional ── /api ──► Servicio Node.js (127.0.0.1:4174)
                                                └── Puente C++ ──► Motor C++17
                                                                    ├── Secuencial
                                                                    ├── OpenMP
                                                                    └── MPI (clúster Docker opcional)
```

- **Frontend:** Vite sirve la aplicación y Three.js renderiza la escena 3D. La
  lógica de carrera y presentación está organizada en módulos de juego; los
  perfiles, la cartera y la progresión del jugador se persisten en el
  navegador.
- **Servicio local:** el servicio HTTP de Node.js valida solicitudes JSON y
  ejecuta el puente nativo `neon_rush_api`. El frontend de desarrollo reenvía
  `/api` al servicio local mediante el proxy de Vite.
- **Motor:** la biblioteca C++ mantiene el modelo de vehículos, movimiento y
  detección de colisiones. OpenMP y MPI son opciones de compilación; CMake
  detecta las bibliotecas disponibles.
- **Clúster:** Docker Compose crea `node1`, `node2` y `node3` en una red
  interna. El coordinador distribuye procesos MPI por SSH. Es un clúster de
  contenedores sobre el mismo host, no un conjunto de máquinas físicas.

El motor C++ es una herramienta de simulación y validación; no sustituye al
motor gráfico del navegador. La experiencia de juego se ejecuta en el
frontend. El endpoint de simulación es una integración local opcional.

## Tecnologías

| Área | Tecnologías |
|---|---|
| Juego web | JavaScript ES modules, Three.js |
| Herramientas frontend | Node.js, npm, Vite 8 |
| API local | Node.js HTTP nativo, JSON |
| Simulación | C++17, CMake, OpenMP opcional, OpenMPI opcional |
| Clúster de desarrollo | Docker Engine, Docker Compose, Ubuntu 24.04, OpenMPI y SSH |
| Pruebas | Node.js test runner, CTest |

## Estructura del repositorio

```text
.
├── backend/
│   ├── include/              # Interfaces y modelos C++
│   ├── src/                  # Motor, ejecutables, puente HTTP y MPI
│   ├── service/              # Servicio Node.js y sus pruebas
│   ├── tests/                # Pruebas C++ secuenciales/MPI
│   └── CMakeLists.txt        # Configuración y targets de CMake
├── frontend/
│   ├── public/               # Recursos estáticos
│   ├── src/
│   │   ├── components/       # Pantallas y componentes de interfaz
│   │   ├── game/             # Render, carreras, circuitos, audio y reglas
│   │   └── storage/          # Perfil, cartera y progresión local
│   └── tests/                # Pruebas del frontend
├── infrastructure/
│   └── mpi-cluster/          # Compose, imagen, hostfile y scripts del clúster
├── benchmarks/               # Comparaciones y mediciones registradas
├── docs/                     # Arquitectura, sistemas y validación
└── README.md
```

## Requisitos

### Desarrollo local

- Node.js y npm compatibles con Vite 8.
- CMake 3.16 o posterior y un compilador C++17 (por ejemplo, GCC).
- OpenMP es opcional; GCC normalmente lo proporciona mediante `libgomp`.
- OpenMPI es opcional para construir y ejecutar el modo MPI en el host.

En Ubuntu, las herramientas base se pueden instalar con:

```bash
sudo apt update
sudo apt install build-essential cmake
```

Para habilitar MPI en el host:

```bash
sudo apt install openmpi-bin libopenmpi-dev
```

### Docker

Para el clúster MPI se necesitan Docker Engine, el plugin Docker Compose y
acceso al daemon. La primera construcción descarga Ubuntu 24.04 e instala las
dependencias del clúster. La imagen compila y prueba el motor; no empaqueta ni
sirve el frontend web.

## Ejecución en desarrollo local

Ejecuta los comandos desde la raíz del repositorio.

### 1. Instalar dependencias del frontend

```bash
cd frontend
npm ci
npm test
npm run dev
```

Abre la URL que Vite muestra en la terminal (por defecto
`http://localhost:5173`). Para generar una versión estática:

```bash
npm run build
```

Los archivos de producción se generan en `frontend/dist/`.

### 2. Compilar y probar el motor C++

En otra terminal, desde la raíz del repositorio:

```bash
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

CMake informa si OpenMP y MPI están disponibles. Si MPI se instala después de
configurar, vuelve a ejecutar el comando `cmake -S ...` para que se detecte.
Sin MPI, siguen disponibles los modos secuencial y OpenMP.

Ejemplos de simulación:

```bash
./backend/build/neon_rush_sim --help
./backend/build/neon_rush_sim --mode sequential --vehicles 1000 --steps 1000
./backend/build/neon_rush_sim --mode openmp --threads 4 --vehicles 1000 --steps 1000
```

Con OpenMPI instalado y detectado:

```bash
mpirun -np 3 ./backend/build/neon_rush_sim \
  --mode mpi --vehicles 1000 --steps 1000
```

### 3. Iniciar la API local (opcional)

Después de compilar el target del puente:

```bash
cmake --build backend/build --target neon_rush_api --parallel
node backend/service/server.mjs
```

El servicio escucha en `127.0.0.1:4174`. El proxy de Vite reenvía las
solicitudes `/api` a este servicio. Comprueba su estado con:

```bash
curl http://127.0.0.1:4174/api/health
```

La API acepta `POST /api/simulate` con `Content-Type: application/json`.
Admite `sequential`, `openmp` y `mpi`; el modo MPI requiere que el clúster
Docker esté iniciado. Para ejecutar sus pruebas:

```bash
node --test backend/service/server.test.mjs
```

## Ejecución del clúster MPI con Docker

El clúster es independiente del servidor web. Desde la raíz:

```bash
docker --version
docker compose version
./infrastructure/mpi-cluster/scripts/cluster.sh up
```

Verifica servicios, conectividad y distribución MPI:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh status
./infrastructure/mpi-cluster/scripts/cluster.sh verify
./infrastructure/mpi-cluster/scripts/cluster.sh test
```

Ejecuta una simulación distribuida (`procesos vehículos pasos`):

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh run 3 1000 1000
```

Mide secuencial, OpenMP y MPI (`vehículos pasos repeticiones hilos-máximos`):

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh benchmark 1000 1000 5 4
```

Si quieres usar la API en modo MPI, inicia el clúster primero y luego arranca
el servicio Node.js en el host:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh up
node backend/service/server.mjs
```

Detén los contenedores cuando termines:

```bash
./infrastructure/mpi-cluster/scripts/cluster.sh down
```

`down` conserva deliberadamente los volúmenes de claves SSH y claves de host
para permitir reinicios verificables. La red del Compose es interna; no se
publican puertos ni se monta el socket Docker. Consulta
[`infrastructure/mpi-cluster/README.md`](./infrastructure/mpi-cluster/README.md)
antes de retirar esos volúmenes.

## Modos y pruebas

- `sequential`: ejecución de referencia del motor.
- `openmp`: paraleliza actualización y detección de colisiones cuando OpenMP
  está disponible.
- `mpi`: distribuye trabajo entre procesos MPI y requiere MPI en la
  configuración de compilación.
- `compare`, `sweep` y `mpi-compare`: comparan resultados y rendimiento con
  una referencia secuencial.

Comandos de validación principales:

```bash
(cd frontend && npm test)
node --test backend/service/server.test.mjs
cmake --build backend/build --parallel
ctest --test-dir backend/build --output-on-failure
```

Los resultados medidos y las limitaciones de las comparaciones están
documentados en [`benchmarks/`](./benchmarks/) y [`docs/`](./docs/).
