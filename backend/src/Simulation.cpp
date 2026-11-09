#include "Simulation.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <utility>

namespace neon_rush {
namespace {

using Clock = std::chrono::steady_clock;

double secondsBetween(const Clock::time_point start,
                      const Clock::time_point end) {
  return std::chrono::duration<double>(end - start).count();
}

}  // namespace

Simulation::Simulation(
    std::vector<Vehicle> vehicles,
    const ExecutionMode mode,
    const int threadCount)
    : vehicles_(std::move(vehicles)),
      mode_(mode),
      threadCount_(threadCount) {
  if (threadCount_ < 1) {
    throw std::invalid_argument("thread count must be at least one");
  }
  for (const auto& vehicle : vehicles_) {
    validateVehicle(vehicle);
  }
  state_.vehicleCount = vehicles_.size();
}

Simulation Simulation::create(
    const std::size_t vehicleCount,
    const ExecutionMode mode,
    const int threadCount) {
  return Simulation(makeVehicles(vehicleCount), mode, threadCount);
}

void Simulation::updateVehicles(const double deltaTime) {
#ifdef _OPENMP
  if (mode_ == ExecutionMode::OpenMP && threadCount_ > 1 &&
      vehicles_.size() > 1) {
    const auto vehicleCount =
        static_cast<std::ptrdiff_t>(vehicles_.size());

#pragma omp parallel for schedule(static) num_threads(threadCount_)
    for (std::ptrdiff_t rawIndex = 0;
         rawIndex < vehicleCount;
         ++rawIndex) {
      auto& vehicle = vehicles_[static_cast<std::size_t>(rawIndex)];
      if (!vehicle.active) {
        continue;
      }

      vehicle.x +=
          std::cos(vehicle.direction) * vehicle.speed * deltaTime;
      vehicle.z +=
          std::sin(vehicle.direction) * vehicle.speed * deltaTime;
    }
    return;
  }
#endif

  for (auto& vehicle : vehicles_) {
    if (!vehicle.active) {
      continue;
    }

    vehicle.x += std::cos(vehicle.direction) * vehicle.speed * deltaTime;
    vehicle.z += std::sin(vehicle.direction) * vehicle.speed * deltaTime;
  }
}

void Simulation::step(const double deltaTime) {
  if (!std::isfinite(deltaTime) || deltaTime < 0.0) {
    throw std::invalid_argument(
        "deltaTime must be finite and non-negative");
  }

  const auto totalStart = Clock::now();

  const auto updateStart = Clock::now();
  updateVehicles(deltaTime);
  const auto updateEnd = Clock::now();

  const auto collisionStart = Clock::now();
  const auto collisions =
      collisionSystem_.detect(vehicles_, mode_, threadCount_);
  const auto collisionEnd = Clock::now();

  lastCollisionPairs_.clear();
  lastCollisionPairs_.reserve(collisions.size());
  for (const auto& pair : collisions) {
    const auto firstId =
        static_cast<std::uint64_t>(vehicles_[pair.firstIndex].id);
    const auto secondId =
        static_cast<std::uint64_t>(vehicles_[pair.secondIndex].id);
    lastCollisionPairs_.push_back({
        std::min(firstId, secondId), std::max(firstId, secondId)});
  }
  std::sort(
      lastCollisionPairs_.begin(), lastCollisionPairs_.end(),
      [](const GlobalCollisionPair& first,
         const GlobalCollisionPair& second) {
        return first.firstId < second.firstId ||
               (first.firstId == second.firstId &&
                first.secondId < second.secondId);
      });

  for (const auto& vehicle : vehicles_) {
    validateVehicle(vehicle);
  }

  const auto totalEnd = Clock::now();

  state_.vehicleUpdateSeconds +=
      secondsBetween(updateStart, updateEnd);
  state_.collisionDetectionSeconds +=
      secondsBetween(collisionStart, collisionEnd);
  state_.totalSeconds += secondsBetween(totalStart, totalEnd);
  state_.collisionCount += collisions.size();
  ++state_.stepsSimulated;
}

void Simulation::run(const std::size_t steps, const double deltaTime) {
  for (std::size_t stepIndex = 0; stepIndex < steps; ++stepIndex) {
    step(deltaTime);
  }
}

const std::vector<Vehicle>& Simulation::vehicles() const noexcept {
  return vehicles_;
}

const std::vector<GlobalCollisionPair>&
Simulation::lastCollisionPairs() const noexcept {
  return lastCollisionPairs_;
}

const RaceState& Simulation::state() const noexcept {
  return state_;
}

}  // namespace neon_rush
