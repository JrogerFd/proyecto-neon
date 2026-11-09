#include "CollisionSystem.hpp"
#include "ExecutionPolicy.hpp"
#include "Simulation.hpp"
#include "Vehicle.hpp"

#include <algorithm>
#include <cmath>
#include <exception>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

void require(const bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

void requireNear(const double actual,
                 const double expected,
                 const double tolerance,
                 const std::string& message) {
  require(std::abs(actual - expected) <= tolerance, message);
}

void testMovement() {
  neon_rush::Vehicle vehicle;
  vehicle.id = 7;
  vehicle.speed = 10.0;
  vehicle.direction = 0.0;
  neon_rush::Simulation simulation({vehicle});

  simulation.step(0.5);

  requireNear(simulation.vehicles()[0].x, 5.0, 1e-12,
              "vehicle should move along X");
  requireNear(simulation.vehicles()[0].z, 0.0, 1e-12,
              "vehicle should not move along Z");
}

void testDeltaTimeScaling() {
  neon_rush::Vehicle vehicle;
  vehicle.speed = 4.0;
  vehicle.direction = 1.5707963267948966;
  neon_rush::Simulation simulation({vehicle});

  simulation.step(0.25);

  requireNear(simulation.vehicles()[0].x, 0.0, 1e-12,
              "quarter turn movement X");
  requireNear(simulation.vehicles()[0].z, 1.0, 1e-12,
              "movement should scale with deltaTime");
}

void testCollisionDetection() {
  neon_rush::Vehicle first;
  first.id = 1;
  first.x = 0.0;
  first.z = 0.0;
  first.collisionRadius = 1.0;

  neon_rush::Vehicle second = first;
  second.id = 2;
  second.x = 2.0;

  neon_rush::Vehicle inactive = first;
  inactive.id = 3;
  inactive.x = 0.5;
  inactive.active = false;

  const neon_rush::CollisionSystem collisionSystem;
  const auto collisions =
      collisionSystem.detect({first, second, inactive});

  require(collisions.size() == 1,
          "touching active circles should collide exactly once");
  require(collisions[0].firstIndex == 0 &&
              collisions[0].secondIndex == 1,
          "collision should reference the active pair");
}

void testRepeatability() {
  auto first = neon_rush::Simulation::create(32);
  auto second = neon_rush::Simulation::create(32);
  first.run(120, 1.0 / 60.0);
  second.run(120, 1.0 / 60.0);

  require(first.state().collisionCount == second.state().collisionCount,
          "collision count should be repeatable");
  for (std::size_t index = 0; index < first.vehicles().size(); ++index) {
    require(first.vehicles()[index].x == second.vehicles()[index].x &&
                first.vehicles()[index].z == second.vehicles()[index].z,
            "identical inputs should produce identical positions");
  }
}

void testConfigurableVehicleCounts() {
  for (const std::size_t count : {1U, 4U, 100U, 1000U, 10000U}) {
    auto simulation = neon_rush::Simulation::create(count);
    simulation.run(2, 1.0 / 60.0);
    require(simulation.vehicles().size() == count,
            "configured vehicle count should be preserved");
    require(simulation.state().vehicleCount == count,
            "race state should report configured vehicle count");
    require(simulation.state().stepsSimulated == 2,
            "step count should be recorded");
  }
}

void testFiniteStateAndInvalidDelta() {
  auto simulation = neon_rush::Simulation::create(64);
  simulation.run(100, 1.0 / 60.0);

  for (const auto& vehicle : simulation.vehicles()) {
    require(std::isfinite(vehicle.x) && std::isfinite(vehicle.z) &&
                std::isfinite(vehicle.speed),
            "vehicle state must remain finite");
  }

  bool rejected = false;
  try {
    simulation.step(-0.1);
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  require(rejected, "negative deltaTime should be rejected");
}

using CanonicalPair = std::pair<std::size_t, std::size_t>;

std::vector<CanonicalPair> canonicalPairs(
    const std::vector<neon_rush::Vehicle>& vehicles,
    const std::vector<neon_rush::CollisionPair>& pairs) {
  std::vector<CanonicalPair> result;
  result.reserve(pairs.size());
  for (const auto& pair : pairs) {
    auto first = vehicles[pair.firstIndex].id;
    auto second = vehicles[pair.secondIndex].id;
    if (second < first) {
      std::swap(first, second);
    }
    result.emplace_back(first, second);
  }
  std::sort(result.begin(), result.end());
  return result;
}

void testSequentialOpenMPStateEquivalence() {
  const auto initialVehicles = neon_rush::makeVehicles(257);
  for (const int threads : {1, 2, 4}) {
    if (threads > neon_rush::availableThreadCount()) {
      continue;
    }

    neon_rush::Simulation sequential(
        initialVehicles, neon_rush::ExecutionMode::Sequential, 1);
    neon_rush::Simulation parallel(
        initialVehicles, neon_rush::ExecutionMode::OpenMP, threads);
    sequential.run(37, 1.0 / 60.0);
    parallel.run(37, 1.0 / 60.0);

    require(sequential.state().collisionCount ==
                parallel.state().collisionCount,
            "sequential and parallel collision totals should match");
    for (std::size_t index = 0;
         index < initialVehicles.size();
         ++index) {
      require(
          sequential.vehicles()[index].x == parallel.vehicles()[index].x &&
              sequential.vehicles()[index].z ==
                  parallel.vehicles()[index].z,
          "independent vehicle updates should match exactly");
    }
  }
}

void testCollisionPairParityAndUniqueness() {
  std::vector<neon_rush::Vehicle> vehicles(6);
  const double positions[][2] = {
      {0.0, 0.0}, {1.0, 0.0}, {0.0, 1.0},
      {10.0, 10.0}, {11.0, 10.0}, {50.0, 50.0}};
  for (std::size_t index = 0; index < vehicles.size(); ++index) {
    vehicles[index].id = 100 + index;
    vehicles[index].x = positions[index][0];
    vehicles[index].z = positions[index][1];
    vehicles[index].collisionRadius = 0.75;
  }

  const neon_rush::CollisionSystem collisionSystem;
  const auto sequential = collisionSystem.detect(
      vehicles, neon_rush::ExecutionMode::Sequential, 1);
  for (const int threads : {1, 2, 4}) {
    if (threads > neon_rush::availableThreadCount()) {
      continue;
    }
    const auto parallel = collisionSystem.detect(
        vehicles, neon_rush::ExecutionMode::OpenMP, threads);
    const auto canonicalSequential =
        canonicalPairs(vehicles, sequential);
    const auto canonicalParallel =
        canonicalPairs(vehicles, parallel);
    require(canonicalSequential == canonicalParallel,
            "OpenMP must find the same collision pairs");
    require(
        std::adjacent_find(
            canonicalParallel.begin(),
            canonicalParallel.end()) == canonicalParallel.end(),
        "OpenMP collision pairs must not be duplicated");
  }

  auto reordered = vehicles;
  std::reverse(reordered.begin(), reordered.end());
  const auto reorderedPairs = collisionSystem.detect(
      reordered, neon_rush::ExecutionMode::OpenMP, 4);
  require(
      canonicalPairs(reordered, reorderedPairs) ==
          canonicalPairs(vehicles, sequential),
      "pair set should be invariant to vehicle insertion order");
}

void testEmptyAndOverlappingCases() {
  const neon_rush::CollisionSystem collisionSystem;
  require(collisionSystem.detect(
              {}, neon_rush::ExecutionMode::OpenMP, 4).empty(),
          "empty vehicle set should have no collisions");

  std::vector<neon_rush::Vehicle> overlapping(12);
  for (std::size_t index = 0; index < overlapping.size(); ++index) {
    overlapping[index].id = index;
    overlapping[index].collisionRadius = 1.0;
  }

  const auto sequential = collisionSystem.detect(
      overlapping, neon_rush::ExecutionMode::Sequential, 1);
  const auto parallel = collisionSystem.detect(
      overlapping, neon_rush::ExecutionMode::OpenMP, 4);
  require(sequential.size() == 66,
          "fully overlapping 12 vehicles have 66 unique pairs");
  require(canonicalPairs(overlapping, sequential) ==
              canonicalPairs(overlapping, parallel),
          "overlap pair set should be identical in both modes");
}

void testOpenMPOneThreadAndConsecutiveRuns() {
  for (int iteration = 0; iteration < 2; ++iteration) {
    auto oneThread = neon_rush::Simulation::create(
        128, neon_rush::ExecutionMode::OpenMP, 1);
    auto fourThreads = neon_rush::Simulation::create(
        128,
        neon_rush::ExecutionMode::OpenMP,
        std::min(4, neon_rush::availableThreadCount()));
    oneThread.run(20, 1.0 / 60.0);
    fourThreads.run(20, 1.0 / 60.0);

    require(oneThread.state().collisionCount ==
                fourThreads.state().collisionCount,
            "one and multiple OpenMP threads should agree");
    for (std::size_t index = 0;
         index < oneThread.vehicles().size();
         ++index) {
      require(oneThread.vehicles()[index].x ==
                  fourThreads.vehicles()[index].x &&
                  oneThread.vehicles()[index].z ==
                      fourThreads.vehicles()[index].z,
              "consecutive runs should be repeatable");
    }
  }
}

}  // namespace

int main() {
  const std::vector<std::pair<std::string, std::function<void()>>> tests = {
      {"movement", testMovement},
      {"delta time", testDeltaTimeScaling},
      {"collision detection", testCollisionDetection},
      {"repeatability", testRepeatability},
      {"configurable vehicle counts", testConfigurableVehicleCounts},
      {"finite state and invalid delta", testFiniteStateAndInvalidDelta},
      {"sequential/OpenMP state equivalence",
       testSequentialOpenMPStateEquivalence},
      {"collision pair parity and uniqueness",
       testCollisionPairParityAndUniqueness},
      {"empty and overlapping cases", testEmptyAndOverlappingCases},
      {"OpenMP single-thread and consecutive runs",
       testOpenMPOneThreadAndConsecutiveRuns},
  };

  std::size_t failures = 0;
  for (const auto& [name, test] : tests) {
    try {
      test();
      std::cout << "[PASS] " << name << '\n';
    } catch (const std::exception& error) {
      ++failures;
      std::cerr << "[FAIL] " << name << ": " << error.what() << '\n';
    }
  }

  std::cout << tests.size() - failures << '/' << tests.size()
            << " tests passed\n";
  return failures == 0 ? 0 : 1;
}
