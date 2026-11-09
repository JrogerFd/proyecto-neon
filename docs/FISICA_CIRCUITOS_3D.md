# Física arcade de circuitos 3D

## Superficie compartida

`Track.js` calcula para un progreso y una posición lateral un punto de carretera, tangente y peralte. La malla de carretera usa esa superficie para ambos bordes; los obstáculos y los rivales consultan el mismo sistema. Así se mantiene consistente la altura entre representación y movimiento.

El jugador conserva aceleración, fricción, giro y nitro arcade. El grado de inclinación afecta moderadamente la velocidad. Mientras está en tierra, su altura sigue la carretera y su orientación toma cabeceo de la tangente y balanceo del peralte. Los rivales siguen la altura, pendiente y peralte al actualizar su posición de carril.

## Rampas y aterrizaje

`RampSystem` detecta el cruce hacia delante de las zonas de rampa, lanza el vehículo con velocidad vertical y aplica gravedad con delta acotado. La altura del salto se suma a la altura de la carretera y el aterrizaje vuelve a la superficie actual; los checkpoints y la meta no aceptan cruces durante el salto.

## Límites y colisiones

- La carretera usa una sección transversal 3D, pero la proyección de progreso y el límite de ancho se calculan principalmente en XZ.
- Fuera del corredor el vehículo pierde velocidad; al cruzar el borde arcade se le devuelve hacia la carretera.
- Los obstáculos dinámicos usan radios aproximados en XZ, tolerancia vertical y separación; no son colisionadores de triángulos.
- Los contactos repetidos usan cooldown por vehículo y obstáculo.

Esto proporciona pendientes, peraltes, saltos y colisiones coherentes con el estilo arcade, pero no equivale a una simulación rígida de suspensión, neumáticos o colisión de malla. La estabilidad se recupera mediante la orientación sobre la superficie y el retorno al suelo; no existe un modelo físico completo de vuelco.

## Validación

La suite comprueba variación de altura, peralte, tangentes, salto/aterrizaje y colisiones con obstáculos. La carrera se abrió en navegador y se observó movimiento del jugador en NEON CITY. No se completó manualmente una vuelta entera ni se verificó visualmente cada salto en los tres circuitos.
