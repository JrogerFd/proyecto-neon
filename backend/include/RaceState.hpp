#pragma once

#include <cstddef>

namespace neon_rush {

struct RaceState {
  std::size_t vehicleCount = 0;
  std::size_t stepsSimulated = 0;
  std::size_t collisionCount = 0;
  double vehicleUpdateSeconds = 0.0;
  double collisionDetectionSeconds = 0.0;
  double communicationSeconds = 0.0;
  double totalSeconds = 0.0;
};

}  // namespace neon_rush
