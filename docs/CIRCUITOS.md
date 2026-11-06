# Circuitos NEON RUSH: trazado plano fijo

## Geometría

`neonrush/track.py` contiene una lista estática y cerrada de waypoints en XY.
Una interpolación Catmull–Rom suaviza el centro de pista entre ellos. Los
waypoints describen una recta principal, chicanes y horquillas; los estilos
(`neon_city`, `cyber_desert`, `plasma_circuit` y los anteriores) solo cambian
el nombre y la paleta. No hay generación procedural ni deformación en tiempo
real. Z no forma parte del modelo de pista y se considera siempre 0.

El ancho de pista es fijo (168 unidades). Los bordes visuales se calculan con
normales a la línea central; física, IA y renderer comparten el mismo `Track`.
El cálculo de progreso proyecta la posición sobre una muestra densa de la curva
y refina el punto más cercano. Conserva el progreso anterior como referencia
para evitar saltos entre segmentos próximos.

## Física y colisiones

La integración mueve vehículos exclusivamente en X/Y. El límite lateral
transitable descuenta el semiancho del vehículo; al cruzarlo se marca fuera de
pista, se aplica arrastre y se corrige la posición sobre la normal local de la
curva. No existen desniveles, puentes, peraltes, rampas, saltos ni colisionadores
de obstáculos.

## Representación

`neonrush/render/pygame_renderer.py` dibuja el asfalto plano, sus bordes, la
línea de salida, vehículos y HUD mediante Pygame. La cámara es top-down
ortográfica y sigue al piloto en XY. OpenGL, sus mallas y el cargador OBJ/glTF
se eliminaron del runtime.

## Validación

La geometría plana y la colisión lateral se cubren con `tests/test_core.py`.
Los smoke tests Pygame usan `SDL_VIDEODRIVER=dummy`; no constituyen una medición
de FPS ni una prueba visual de hardware. El objetivo del bucle de aplicación es
60 FPS, pero no se afirma un resultado de rendimiento sin benchmark medido.
