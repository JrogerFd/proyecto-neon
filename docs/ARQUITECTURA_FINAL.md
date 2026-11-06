# Arquitectura actual de NEON RUSH

## Proyecto

El proyecto ubicado en `/home/roger/proyecto` es una aplicación Python/Pygame,
no un repositorio JavaScript/Three.js: no contiene `package.json`, frontend Vite
ni `.git`. Esta refactorización conserva la arquitectura existente y cambia la
carrera a geometría 2D plana; no crea un proyecto paralelo.

## Flujo de juego

- `neonrush/track.py`: waypoints XY fijos, spline cerrada, ancho y proyección.
- `neonrush/physics.py`: movimiento arcade en plano y corrección contra bordes.
- `neonrush/world.py`: autoridad de carrera, pickups, snapshots y resultados.
- `neonrush/ai.py`: seguimiento de la misma línea fija.
- `neonrush/render/pygame_renderer.py`: escena top-down de pista/vehículos y HUD.
- `neonrush/content.py`: perfil, persistencia, transacciones, recompensas,
  misiones y NEON CUP.
- `neonrush/app.py`: navegación, garaje, tienda, resultados y pantalla de
  desafíos.
- `neonrush/mpi_cluster.py`: ruta opcional de cálculo MPI Python existente.

OpenGL y el cargador de mallas OBJ/glTF ya no forman parte del runtime ni de
las dependencias gráficas. La superficie de pista no tiene componente Z; la
posición vertical se considera constante en 0.
El protocolo de red subió a la versión 2 para evitar que clientes antiguos
simulen una geometría distinta con la misma versión de mensajes.

El perfil del jugador usa un JSON local. No se afirma que la persistencia local
tenga garantías de servidor. No hay código C++17/OpenMP en esta carpeta.
