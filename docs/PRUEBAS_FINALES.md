# Pruebas finales

## Comandos

```bash
NEONRUSH_PROFILE=/tmp/neonrush-validation-profile.json \
  /home/roger/proyecto/venv/bin/python -m unittest discover -s tests -v
/home/roger/proyecto/venv/bin/python -m compileall -q neonrush tests run.py
```

El repo usa `unittest`; no contiene `package.json`, por lo que `npm test` y
`npm run build` no aplican. El Makefile ofrece `make test`, pero requiere
configurar `PYTHON` al intérprete del proyecto.

Resultado: **59 pruebas aprobadas** (`Ran 59 tests in 25.721s`, `OK`) y
`compileall` completado sin errores para `neonrush`, `tests` y `run.py`.
Las pruebas dirigidas también confirman que el autopiloto completa una vuelta
en cada estilo de pista y que el renderer conserva la vista superior fija.

Como comprobación de rendimiento no representativa de hardware, 120 frames de
la carrera top-down con tres vehículos en SDL dummy/software se dibujaron a
343.2 FPS en el entorno de desarrollo. Esto valida que el renderer simplificado
supera 60 FPS en ese escenario sintético; no garantiza el mismo resultado en
pantallas/controladores de otras máquinas.

## Alcance de las pruebas

La suite cubre waypoints planos estáticos, proyección de progreso, colisiones
laterales, física arcade, IA completando las tres pistas, recompensas NC,
resultados idempotentes, compra, misiones UTC, copa, migración de perfil,
integración Master/Worker y smoke tests Pygame top-down.

La medición se hizo en renderizado sintético sin ventana; no certifica el
rendimiento de una máquina concreta ni sustituye un benchmark en hardware real.
