#include "Vehicle.hpp"

#include <cmath>
#include <stdexcept>

namespace neon_rush {

std::vector<Vehicle> makeVehicles(const std::size_t count) {
  std::vector<Vehicle> vehicles;
  vehicles.reserve(count);

  constexpr std::size_t columns = 100;
  constexpr double spacing = 4.0;
  constexpr double origin = -198.0;

  for (std::size_t index = 0; index < count; ++index) {
    const auto column = index % columns;
    const auto row = index / columns;

    Vehicle vehicle;
    vehicle.id = index;
    vehicle.x = origin + static_cast<double>(column) * spacing;
    vehicle.z = origin + static_cast<double>(row) * spacing;
    vehicle.speed = 8.0 + static_cast<double>(index % 9) * 0.25;
    vehicle.direction =
        static_cast<double>(index % 32) * 0.017453292519943295;
    vehicle.collisionRadius = 1.0;
    vehicle.active = true;
    vehicles.push_back(vehicle);
  }

  return vehicles;
}

void validateVehicle(const Vehicle& vehicle) {
  if (!std::isfinite(vehicle.x) || !std::isfinite(vehicle.z) ||
      !std::isfinite(vehicle.speed) ||
      !std::isfinite(vehicle.direction) ||
      !std::isfinite(vehicle.collisionRadius)) {
    throw std::invalid_argument("vehicle fields must be finite");
  }

  if (vehicle.speed < 0.0) {
    throw std::invalid_argument("vehicle speed cannot be negative");
  }

  if (vehicle.collisionRadius <= 0.0) {
    throw std::invalid_argument(
        "vehicle collision radius must be positive");
  }
}

}  // namespace neon_rush
