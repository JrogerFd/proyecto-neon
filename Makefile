PYTHON ?= python3
PORT ?= 50505
ROOM ?= NEON

.PHONY: play demo local master worker test docker

play:
	$(PYTHON) run.py play

demo:
	$(PYTHON) run.py demo --players 2 --laps 2

local:
	$(PYTHON) run.py local --laps 2

master:
	$(PYTHON) run.py master --host 0.0.0.0 --port $(PORT) --room $(ROOM) --players 2

worker:
	$(PYTHON) run.py worker --host 127.0.0.1 --port $(PORT) --room $(ROOM) --name Worker

test:
	$(PYTHON) -m unittest discover -s tests -v

docker:
	docker compose up --build
