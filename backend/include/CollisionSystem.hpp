#pragma once

#include "ExecutionPolicy.hpp"
#include "Vehicle.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace neon_rush {

struct CollisionPair {
  std::size_t firstIndex = 0;
  std::size_t secondIndex = 0;
};

struct GlobalCollisionPair {
  std::uint64_t firstId = 0;
  std::uint64_t secondId = 0;

  bool operator==(const GlobalCollisionPair& other) const noexcept {
    return firstId == other.firstId && secondId == other.secondId;
  }
};

class CollisionSystem {
 public:
  std::vector<CollisionPair> detect(
      const std::vector<Vehicle>& vehicles,
      ExecutionMode mode = ExecutionMode::Sequential,
      int threadCount = 1) const;

  std::vector<GlobalCollisionPair> detectOwnedPairs(
      const std::vector<Vehicle>& ownedVehicles,
      const std::vector<Vehicle>& candidates) const;
};

}  // namespace neon_rush
