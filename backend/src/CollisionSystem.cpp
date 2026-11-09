#include "CollisionSystem.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iterator>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace neon_rush {
namespace {

struct Cell {
  std::int64_t x;
  std::int64_t z;

  bool operator==(const Cell& other) const noexcept {
    return x == other.x && z == other.z;
  }
};

struct CellHash {
  std::size_t operator()(const Cell& cell) const noexcept {
    const std::size_t hashX = std::hash<std::int64_t>{}(cell.x);
    const std::size_t hashZ = std::hash<std::int64_t>{}(cell.z);
    return hashX ^
           (hashZ + static_cast<std::size_t>(0x9e3779b9U) +
            (hashX << 6U) + (hashX >> 2U));
  }
};

Cell cellFor(const Vehicle& vehicle, const double cellSize) {
  return {
      static_cast<std::int64_t>(std::floor(vehicle.x / cellSize)),
      static_cast<std::int64_t>(std::floor(vehicle.z / cellSize))};
}

}  // namespace

std::vector<CollisionPair> CollisionSystem::detect(
    const std::vector<Vehicle>& vehicles,
    const ExecutionMode mode,
    const int threadCount) const {
  if (threadCount < 1) {
    throw std::invalid_argument("thread count must be at least one");
  }

  double maximumDiameter = 0.0;
  for (const auto& vehicle : vehicles) {
    validateVehicle(vehicle);
    if (vehicle.active) {
      maximumDiameter =
          std::max(maximumDiameter, 2.0 * vehicle.collisionRadius);
    }
  }

  if (maximumDiameter == 0.0) {
    return {};
  }

  std::unordered_map<Cell, std::vector<std::size_t>, CellHash> cells;
  for (std::size_t index = 0; index < vehicles.size(); ++index) {
    if (vehicles[index].active) {
      cells[cellFor(vehicles[index], maximumDiameter)].push_back(index);
    }
  }

  const auto detectForFirstIndex =
      [&vehicles, &cells, maximumDiameter](
          const std::size_t firstIndex,
          std::vector<CollisionPair>& output) {
        const auto& first = vehicles[firstIndex];
        if (!first.active) {
          return;
        }

        const Cell firstCell = cellFor(first, maximumDiameter);
        const auto& immutableCells = cells;
        for (std::int64_t offsetX = -1; offsetX <= 1; ++offsetX) {
          for (std::int64_t offsetZ = -1; offsetZ <= 1; ++offsetZ) {
            const Cell neighbor{
                firstCell.x + offsetX,
                firstCell.z + offsetZ};
            const auto bucket = immutableCells.find(neighbor);
            if (bucket == immutableCells.end()) {
              continue;
            }

            for (const std::size_t secondIndex : bucket->second) {
              if (secondIndex <= firstIndex) {
                continue;
              }

              const auto& second = vehicles[secondIndex];
              const double dx = second.x - first.x;
              const double dz = second.z - first.z;
              const double radiusSum =
                  first.collisionRadius + second.collisionRadius;

              if (dx * dx + dz * dz <= radiusSum * radiusSum) {
                output.push_back({firstIndex, secondIndex});
              }
            }
          }
        }
      };

  std::vector<CollisionPair> collisions;
#ifdef _OPENMP
  if (mode == ExecutionMode::OpenMP && threadCount > 1 &&
      vehicles.size() > 1) {
    std::vector<std::vector<CollisionPair>> threadCollisions(
        static_cast<std::size_t>(threadCount));
    const auto vehicleCount =
        static_cast<std::ptrdiff_t>(vehicles.size());

#pragma omp parallel num_threads(threadCount)
    {
      const int threadIndex = omp_get_thread_num();
      auto& local = threadCollisions[
          static_cast<std::size_t>(threadIndex)];

#pragma omp for schedule(static)
      for (std::ptrdiff_t rawIndex = 0;
           rawIndex < vehicleCount;
           ++rawIndex) {
        detectForFirstIndex(
            static_cast<std::size_t>(rawIndex), local);
      }
    }

    std::size_t totalPairs = 0;
    for (const auto& local : threadCollisions) {
      totalPairs += local.size();
    }
    collisions.reserve(totalPairs);
    for (auto& local : threadCollisions) {
      collisions.insert(
          collisions.end(),
          std::make_move_iterator(local.begin()),
          std::make_move_iterator(local.end()));
    }
  } else
#else
  (void)mode;
  (void)threadCount;
#endif
  {
    for (std::size_t firstIndex = 0;
         firstIndex < vehicles.size();
         ++firstIndex) {
      detectForFirstIndex(firstIndex, collisions);
    }
  }

  std::sort(
      collisions.begin(),
      collisions.end(),
      [](const CollisionPair& first, const CollisionPair& second) {
        return first.firstIndex < second.firstIndex ||
               (first.firstIndex == second.firstIndex &&
                first.secondIndex < second.secondIndex);
      });

  return collisions;
}

std::vector<GlobalCollisionPair> CollisionSystem::detectOwnedPairs(
    const std::vector<Vehicle>& ownedVehicles,
    const std::vector<Vehicle>& candidates) const {
  double cellSize = 0.0;
  for (const auto& vehicle : candidates) {
    validateVehicle(vehicle);
    if (vehicle.active) {
      cellSize = std::max(cellSize, 2.0 * vehicle.collisionRadius);
    }
  }

  if (cellSize == 0.0) {
    return {};
  }

  std::unordered_map<Cell, std::vector<const Vehicle*>, CellHash> cells;
  for (const auto& vehicle : candidates) {
    if (vehicle.active) {
      cells[cellFor(vehicle, cellSize)].push_back(&vehicle);
    }
  }

  std::vector<GlobalCollisionPair> pairs;
  for (const auto& first : ownedVehicles) {
    if (!first.active) {
      continue;
    }

    const Cell firstCell = cellFor(first, cellSize);
    for (std::int64_t offsetX = -1; offsetX <= 1; ++offsetX) {
      for (std::int64_t offsetZ = -1; offsetZ <= 1; ++offsetZ) {
        const auto bucket = cells.find(
            {firstCell.x + offsetX, firstCell.z + offsetZ});
        if (bucket == cells.end()) {
          continue;
        }

        for (const Vehicle* second : bucket->second) {
          if (second->id <= first.id) {
            continue;
          }

          const double dx = second->x - first.x;
          const double dz = second->z - first.z;
          const double radiusSum =
              first.collisionRadius + second->collisionRadius;
          if (dx * dx + dz * dz <= radiusSum * radiusSum) {
            pairs.push_back({first.id, second->id});
          }
        }
      }
    }
  }

  std::sort(
      pairs.begin(),
      pairs.end(),
      [](const GlobalCollisionPair& first,
         const GlobalCollisionPair& second) {
        return first.firstId < second.firstId ||
               (first.firstId == second.firstId &&
                first.secondId < second.secondId);
      });
  pairs.erase(std::unique(pairs.begin(), pairs.end()), pairs.end());
  return pairs;
}

}  // namespace neon_rush
