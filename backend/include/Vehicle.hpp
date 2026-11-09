#pragma once

#include <cstddef>
#include <vector>

namespace neon_rush {

struct Vehicle {
  std::size_t id = 0;
  double x = 0.0;
  double z = 0.0;
  double speed = 0.0;
  double direction = 0.0;
  double collisionRadius = 1.0;
  bool active = true;
};

std::vector<Vehicle> makeVehicles(std::size_t count);
void validateVehicle(const Vehicle& vehicle);

}  // namespace neon_rush
