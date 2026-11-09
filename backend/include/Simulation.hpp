#pragma once

#include "CollisionSystem.hpp"
#include "ExecutionPolicy.hpp"
#include "RaceState.hpp"
#include "Vehicle.hpp"

#include <cstddef>
#include <vector>

namespace neon_rush {

class Simulation {
 public:
  explicit Simulation(
      std::vector<Vehicle> vehicles,
      ExecutionMode mode = ExecutionMode::Sequential,
      int threadCount = 1);

  static Simulation create(
      std::size_t vehicleCount,
      ExecutionMode mode = ExecutionMode::Sequential,
      int threadCount = 1);

  void step(double deltaTime);
  void run(std::size_t steps, double deltaTime);

  const std::vector<Vehicle>& vehicles() const noexcept;
  const std::vector<GlobalCollisionPair>& lastCollisionPairs() const noexcept;
  const RaceState& state() const noexcept;

 private:
  void updateVehicles(double deltaTime);

  std::vector<Vehicle> vehicles_;
  ExecutionMode mode_;
  int threadCount_;
  CollisionSystem collisionSystem_;
  RaceState state_;
  std::vector<GlobalCollisionPair> lastCollisionPairs_;
};

}  // namespace neon_rush
