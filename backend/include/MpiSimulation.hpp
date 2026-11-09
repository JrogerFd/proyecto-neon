#pragma once

#include "CollisionSystem.hpp"
#include "RaceState.hpp"
#include "Vehicle.hpp"

#include <mpi.h>

#include <cstddef>
#include <cstdint>
#include <vector>

namespace neon_rush {

class MpiSimulation {
 public:
  static MpiSimulation create(std::size_t vehicleCount,
                              MPI_Comm communicator);

  MpiSimulation(std::vector<Vehicle> rootVehicles,
                std::size_t vehicleCount,
                MPI_Comm communicator);
  ~MpiSimulation();

  MpiSimulation(const MpiSimulation&) = delete;
  MpiSimulation& operator=(const MpiSimulation&) = delete;
  MpiSimulation(MpiSimulation&&) = delete;
  MpiSimulation& operator=(MpiSimulation&&) = delete;

  void run(std::size_t steps, double deltaTime);

  int rank() const noexcept;
  int processCount() const noexcept;
  const std::vector<Vehicle>& localVehicles() const noexcept;
  const RaceState& state() const noexcept;
  double globalChecksum() const;

  std::vector<Vehicle> gatherVehicles(int root = 0) const;
  std::vector<GlobalCollisionPair> gatherLastCollisionPairs(
      int root = 0) const;

 private:
  void step(double deltaTime);
  void updateLocalVehicles(double deltaTime);
  void redistributeBySpatialCell();
  void exchangeCollisionHalos();
  int ownerForCell(std::int64_t cellX) const;

  MPI_Comm communicator_;
  MPI_Datatype vehicleType_ = MPI_DATATYPE_NULL;
  int rank_ = 0;
  int processCount_ = 1;
  std::size_t vehicleCount_ = 0;
  double collisionCellSize_ = 2.0;
  std::int64_t minimumCellX_ = 0;
  std::int64_t maximumCellX_ = 0;
  std::vector<Vehicle> localVehicles_;
  std::vector<Vehicle> haloVehicles_;
  std::vector<GlobalCollisionPair> lastCollisionPairs_;
  CollisionSystem collisionSystem_;
  RaceState state_;
  double localVehicleUpdateSeconds_ = 0.0;
  double localCollisionDetectionSeconds_ = 0.0;
  double localCommunicationSeconds_ = 0.0;
  std::uint64_t localCollisionCount_ = 0;
};

}  // namespace neon_rush
