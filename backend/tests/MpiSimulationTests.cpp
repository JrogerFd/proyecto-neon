#include "CollisionSystem.hpp"
#include "MpiSimulation.hpp"
#include "Simulation.hpp"
#include "Vehicle.hpp"

#include <mpi.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
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

using Pair = std::pair<std::size_t, std::size_t>;

std::vector<Pair> canonicalPairs(
    const std::vector<neon_rush::GlobalCollisionPair>& pairs) {
  std::vector<Pair> result;
  result.reserve(pairs.size());
  for (const auto& pair : pairs) {
    result.emplace_back(
        static_cast<std::size_t>(pair.firstId),
        static_cast<std::size_t>(pair.secondId));
  }
  std::sort(result.begin(), result.end());
  return result;
}

std::vector<Pair> expectedPairs(
    const std::vector<neon_rush::Vehicle>& vehicles) {
  const neon_rush::CollisionSystem collisionSystem;
  const auto detected = collisionSystem.detect(vehicles);
  std::vector<Pair> result;
  result.reserve(detected.size());
  for (const auto& pair : detected) {
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

void requireRoot(const bool condition,
                 const std::string& message,
                 const int rank) {
  int passed = rank == 0 && !condition ? 0 : 1;
  MPI_Bcast(&passed, 1, MPI_INT, 0, MPI_COMM_WORLD);
  require(passed != 0, message);
}

void testDistributedMovementMatchesSequential(const int rank) {
  const auto initial = neon_rush::makeVehicles(173);
  std::vector<neon_rush::Vehicle> rootVehicles =
      rank == 0 ? initial : std::vector<neon_rush::Vehicle>{};
  neon_rush::MpiSimulation distributed(
      std::move(rootVehicles), initial.size(), MPI_COMM_WORLD);
  distributed.run(29, 1.0 / 60.0);
  const auto gathered = distributed.gatherVehicles();

  bool matches = true;
  if (rank == 0) {
    neon_rush::Simulation sequential(initial);
    sequential.run(29, 1.0 / 60.0);
    matches = gathered.size() == sequential.vehicles().size();
    for (std::size_t index = 0;
         matches && index < gathered.size();
         ++index) {
      matches =
          gathered[index].id == sequential.vehicles()[index].id &&
          gathered[index].x == sequential.vehicles()[index].x &&
          gathered[index].z == sequential.vehicles()[index].z;
    }
  }
  requireRoot(
      matches,
      "MPI positions and global IDs must match sequential execution",
      rank);
  require(
      distributed.state().collisionCount > 0,
      "distributed run should preserve accumulated collision semantics");
}

void testCrossPartitionBoundaryCollision(const int rank,
                                         const int processCount) {
  std::vector<neon_rush::Vehicle> initial;
  if (rank == 0) {
    for (const auto [id, x] :
         {std::pair<std::size_t, double>{7, 0.0},
          std::pair<std::size_t, double>{19, 2.0},
          std::pair<std::size_t, double>{42, 4.0}}) {
      neon_rush::Vehicle vehicle;
      vehicle.id = id;
      vehicle.x = x;
      vehicle.z = 0.0;
      vehicle.speed = 0.0;
      vehicle.collisionRadius = 1.0;
      initial.push_back(vehicle);
    }
  }

  neon_rush::MpiSimulation distributed(
      initial, 3, MPI_COMM_WORLD);
  distributed.run(1, 0.0);
  const auto actual = distributed.gatherLastCollisionPairs();

  bool matches = true;
  if (rank == 0) {
    const auto actualPairs = canonicalPairs(actual);
    matches =
        actualPairs == expectedPairs(initial) &&
        std::adjacent_find(
            actualPairs.begin(), actualPairs.end()) == actualPairs.end();
  }
  requireRoot(
      matches,
      "collision across spatial process partitions was lost or duplicated",
      rank);

  if (processCount > 1) {
    require(
        distributed.state().collisionCount == 2,
        "the three boundary vehicles should form two collision pairs");
  }
}

void testOverlappingVehiclesAndRepeatability(const int rank) {
  std::vector<neon_rush::Vehicle> initial;
  if (rank == 0) {
    initial.resize(9);
    for (std::size_t index = 0; index < initial.size(); ++index) {
      initial[index].id = 100 + index;
      initial[index].x = 0.0;
      initial[index].z = 0.0;
      initial[index].speed = 0.0;
      initial[index].collisionRadius = 1.0;
    }
  }

  neon_rush::MpiSimulation first(initial, 9, MPI_COMM_WORLD);
  neon_rush::MpiSimulation second(initial, 9, MPI_COMM_WORLD);
  first.run(3, 0.0);
  second.run(3, 0.0);
  const auto firstPairs = first.gatherLastCollisionPairs();
  const auto secondPairs = second.gatherLastCollisionPairs();

  bool matches = true;
  if (rank == 0) {
    matches =
        firstPairs.size() == 36 &&
        canonicalPairs(firstPairs) == canonicalPairs(secondPairs) &&
        canonicalPairs(firstPairs) == expectedPairs(initial);
  }
  requireRoot(
      matches,
      "overlapping MPI vehicles must yield 36 stable unique pairs",
      rank);
  require(
      first.state().collisionCount == 108,
      "collision count should accumulate each pair on each step");
}

void testEmptyPartitionAndEmptySimulation(const int rank) {
  constexpr std::size_t vehicleCount = 1;
  std::vector<neon_rush::Vehicle> initial;
  if (rank == 0) {
    initial = neon_rush::makeVehicles(vehicleCount);
  }

  neon_rush::MpiSimulation oneVehicle(
      initial, vehicleCount, MPI_COMM_WORLD);
  oneVehicle.run(2, 0.01);
  const auto gatheredOne = oneVehicle.gatherVehicles();
  requireRoot(
      rank != 0 || gatheredOne.size() == 1,
      "simulation must work when some processes own no vehicles",
      rank);

  auto empty = neon_rush::MpiSimulation::create(0, MPI_COMM_WORLD);
  empty.run(2, 0.01);
  const auto gatheredEmpty = empty.gatherVehicles();
  const auto emptyPairs = empty.gatherLastCollisionPairs();
  requireRoot(
      rank != 0 ||
          (gatheredEmpty.empty() && emptyPairs.empty() &&
           empty.state().collisionCount == 0 &&
           empty.state().stepsSimulated == 2),
      "empty distributed simulation should complete with no collisions",
      rank);
}

void testInputOrderDoesNotChangeCollisionPairs(const int rank) {
  std::vector<neon_rush::Vehicle> initial;
  if (rank == 0) {
    initial.resize(6);
    const double locations[][2] = {
        {0.0, 0.0}, {1.0, 0.0}, {0.0, 1.0},
        {10.0, 10.0}, {11.0, 10.0}, {40.0, 40.0}};
    for (std::size_t index = 0; index < initial.size(); ++index) {
      initial[index].id = 900 - index * 7;
      initial[index].x = locations[index][0];
      initial[index].z = locations[index][1];
      initial[index].speed = 0.0;
      initial[index].collisionRadius = 0.75;
    }
    std::reverse(initial.begin(), initial.end());
  }

  neon_rush::MpiSimulation distributed(
      initial, 6, MPI_COMM_WORLD);
  distributed.run(1, 0.0);
  const auto actual = distributed.gatherLastCollisionPairs();

  bool matches = true;
  if (rank == 0) {
    matches = canonicalPairs(actual) == expectedPairs(initial);
  }
  requireRoot(
      matches,
      "stable global IDs must preserve pair results across input ordering",
      rank);
}

}  // namespace

int main(int argc, char** argv) {
  MPI_Init(&argc, &argv);
  int rank = 0;
  int processCount = 1;
  MPI_Comm_rank(MPI_COMM_WORLD, &rank);
  MPI_Comm_size(MPI_COMM_WORLD, &processCount);

  const std::vector<std::pair<std::string, std::function<void()>>> tests = {
      {"distributed movement parity", [&] {
         testDistributedMovementMatchesSequential(rank);
       }},
      {"cross-partition collision", [&] {
         testCrossPartitionBoundaryCollision(rank, processCount);
       }},
      {"overlap and repeatability", [&] {
         testOverlappingVehiclesAndRepeatability(rank);
       }},
      {"empty ranks and empty simulation", [&] {
         testEmptyPartitionAndEmptySimulation(rank);
       }},
      {"stable IDs and insertion ordering", [&] {
         testInputOrderDoesNotChangeCollisionPairs(rank);
       }},
  };

  int failedTests = 0;
  for (const auto& [name, test] : tests) {
    std::string failure;
    try {
      test();
    } catch (const std::exception& error) {
      failure = error.what();
    }

    int localFailed = failure.empty() ? 0 : 1;
    int globalFailed = 0;
    MPI_Allreduce(
        &localFailed, &globalFailed, 1, MPI_INT, MPI_MAX,
        MPI_COMM_WORLD);
    if (globalFailed != 0) {
      ++failedTests;
      if (rank == 0) {
        std::cerr << "[FAIL] " << name << ": "
                  << (failure.empty()
                          ? "failed on another MPI process"
                          : failure)
                  << '\n';
      }
    } else if (rank == 0) {
      std::cout << "[PASS] " << name << '\n';
    }
  }

  if (rank == 0) {
    std::cout << tests.size() - static_cast<std::size_t>(failedTests)
              << '/' << tests.size() << " MPI tests passed with "
              << processCount << " process(es)\n";
  }

  MPI_Finalize();
  return failedTests == 0 ? 0 : 1;
}
